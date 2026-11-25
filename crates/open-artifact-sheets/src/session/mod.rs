//! A session: one workbook, and the requests the page's worker makes about it.
//!
//! A session starts out direct: `load` and `apply` change its workbook outright (the local server and tests use
//! these). The first request of syncing (`answerBeforeCalculating`, `receiveServerRevision`, `queueEdit`, …) turns it
//! into a copy kept in step with the server, after which `load` and `apply` are refused (`syncInUse`).
//!
//! In step with the server, the session keeps two workbooks: the confirmed one, as the server has it at the
//! confirmed revision, and the one the page shows, which is the confirmed one with the page's own queued edits
//! applied on top. Every answer to a request of syncing is a sync state (`syncState`): the confirmed revision, what
//! changed for the page to show again, and the next step the worker is to take: stop, send the first edit the server
//! has not acknowledged, fetch a page of the workbook, or nothing.
//!
//! - An edit the page makes (`queueEdit`) is worked out into operations on the workbook as it is shown, applied, and
//!   recorded with the version of the format it is written in and the revision it was made on (`base`).
//! - The server's outcome for the edit sent (`receiveSendOutcome`): saved at the revision after the confirmed one,
//!   the edit is confirmed; saved further on, it waits, acknowledged, for the edits of others before it; saved at a
//!   revision already confirmed, it came back as another's edit and is confirmed as that one. Refused, it is dropped.
//! - Another's edit streamed from the server (`receiveStreamedEdit`) at the revision after the confirmed one is
//!   applied to the confirmed workbook, and the page's own edits on top of it again; any other revision ahead means
//!   edits were missed, and the workbook is loaded afresh (`fetchLoadPage`, `receiveLoadPage`).
//! - Streams ahead of the confirmed revision are kept and taken in order once it reaches them (`catch_up`): another's
//!   edit applies, a stream of the page's own edit confirms it as the stream has it. When no stream is next, the
//!   edits saved next are confirmed by their outcomes alone, one after another, and the streams kept for their
//!   revisions are passed over.

mod changes;
mod edits;
mod history;
mod history_reads;
mod interactive;
mod new_ids;
mod packed;
mod parts;
mod place;
pub(crate) mod reads;
mod undo;

use hashbrown::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::{json, Map, Value as Json};

use crate::calculate::calculate;
use crate::evaluate::Place;
use crate::ids::LineId;
use crate::value::Value;
use crate::workbook::load::{Op, Refusal};
use crate::workbook::{snapshot, version, Workbook};
use crate::Clock;
use changes::Changes;

/// An edit as recorded for the server: the version of the format of its operations, the revision it was made on, and
/// the operations.
#[derive(Clone, Debug, serde::Serialize)]
struct Recorded {
    v: u32,
    base: u64,
    ops: Vec<Op>,
}

/// What the page is to do next: an edit to send (by its place in the queue), or another step.
enum Next {
    Send(usize),
    Json(Json),
}

/// One of the page's own edits the server has not confirmed.
#[derive(Clone, Debug)]
struct Queued {
    op_id: String,
    /// The request that queued these parts stays reserved until all parts are confirmed.
    group_id: Option<String>,
    /// The action the edit takes back, for an edit that takes back others (`queueEditsThatTakeBack`).
    action_id: Option<String>,
    recorded: Recorded,
    /// The revision the server saved it at, ahead of the confirmed one.
    acknowledged: Option<u64>,
    /// The operations that undo it on the workbook shown, when it applied there.
    reverse: Option<Vec<Op>>,
    /// Whether an answer told the page to send it: what becomes of an edit never sent is not heard.
    is_handed_out: bool,
}

/// What the operations of a workbook loaded deleted: sheets, and rows and columns by id (an id is the workbook's
/// alone, whatever sheet an operation names), undeleted later or not. A load does not bring what deleting them took
/// away, so nothing undeletes them: a direct request that would is refused (`deletedCellsNotLoaded`); in a synced
/// session another's edit that does loads the workbook again, and the page's own is queued without being made on the
/// workbook shown.
#[derive(Debug, Default)]
struct Forgotten {
    sheets: HashSet<String>,
    /// Row ids, by base.
    rows: HashMap<String, HashSet<u32>>,
    /// Column ids, by base.
    columns: HashMap<String, HashSet<u32>>,
}

impl Forgotten {
    fn of(ops: &[Op]) -> Forgotten {
        let mut forgotten = Forgotten::default();
        forgotten.add(ops);
        forgotten
    }

    fn from_snapshot(workbook: &Workbook) -> Self {
        let mut forgotten = Self::default();
        forgotten.sheets.extend(workbook.deleted_sheets.iter().map(|sheet| sheet.id.clone()));
        for sheet in workbook.sheets.iter().chain(&workbook.deleted_sheets) {
            for (axis, forgotten) in [(&sheet.rows, &mut forgotten.rows), (&sheet.columns, &mut forgotten.columns)] {
                for id in axis.deleted() {
                    let base = workbook.bases.name(id.base);
                    forgotten.entry_ref(base).or_default().insert(id.n);
                }
            }
        }
        forgotten
    }

    /// Adds what the operations delete.
    fn add(&mut self, ops: &[Op]) {
        let add = |lines: &mut HashMap<String, HashSet<u32>>, runs: &[crate::ids::IdRun]| {
            for r in runs {
                lines.entry(r.base.clone()).or_default().extend(r.first..r.first.saturating_add(r.count));
            }
        };
        for op in ops {
            match op {
                Op::DeleteSheet { sheet_id } => {
                    self.sheets.insert(sheet_id.clone());
                }
                Op::DeleteRows { rows, .. } => add(&mut self.rows, rows),
                Op::DeleteColumns { columns, .. } => add(&mut self.columns, columns),
                _ => {}
            }
        }
    }

    /// Whether the operation undeletes something forgotten.
    fn is_undeleted_by(&self, op: &Op) -> bool {
        let any = |lines: &HashMap<String, HashSet<u32>>, runs: &[crate::ids::IdRun]| {
            runs.iter().any(|r| {
                let Some(ns) = lines.get(&r.base) else { return false };
                let mut run = r.first..r.first.saturating_add(r.count);
                if run.len() <= ns.len() { run.any(|n| ns.contains(&n)) } else { ns.iter().any(|n| run.contains(n)) }
            })
        };
        match op {
            Op::UndeleteSheet { sheet_id } => self.sheets.contains(sheet_id),
            Op::UndeleteRows { rows, .. } => any(&self.rows, rows),
            Op::UndeleteColumns { columns, .. } => any(&self.columns, columns),
            _ => false,
        }
    }
}

/// The pages of a workbook being loaded.
#[derive(Debug, Default)]
struct Loading {
    /// Where the next page starts.
    from: u64,
    /// The revision the pages are of, after the first one: a page of another revision starts the load over.
    revision: Option<u64>,
    ops: Vec<Op>,
    snapshot: Option<snapshot::Snapshot>,
    is_repeat: bool,
    /// Whether the load is needed whatever revision is confirmed: an edit of others could not be applied.
    is_needed: bool,
}

#[derive(Clone, Copy, Debug)]
struct ClockReading {
    unix_milliseconds: i64,
    utc_offset_in_minutes: i32,
}

/// A clock reading's milliseconds: a whole number from the first day of year 1 to the last of year 9999; any other
/// makes the request unreadable.
fn reading_milliseconds<'de, D: serde::Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    use crate::time_zone::{FIRST_UNIX_MILLISECOND, LAST_UNIX_MILLISECOND};
    let ms = i64::deserialize(d)?;
    if !(FIRST_UNIX_MILLISECOND..=LAST_UNIX_MILLISECOND).contains(&ms) {
        return Err(serde::de::Error::custom("a reading out of the years 1 to 9999"));
    }
    Ok(ms)
}

/// A clock reading's offset from UTC: whole minutes, 18 hours at most either way.
fn reading_offset<'de, D: serde::Deserializer<'de>>(d: D) -> Result<i32, D::Error> {
    let minutes = i32::deserialize(d)?;
    if !(-1080..=1080).contains(&minutes) {
        return Err(serde::de::Error::custom("an offset of more than 18 hours"));
    }
    Ok(minutes)
}

/// What one answer reports besides the state: gathered while the request is answered.
#[derive(Default)]
struct Report {
    changes: Changes,
    dropped: Vec<String>,
    confirmed: Vec<String>,
    fault: Option<&'static str>,
    /// Others' edits: their revisions and the places they changed.
    others: Vec<(u64, OthersPlace)>,
    /// Whether operations applied leave formulas to be worked out again: they set formulas or cells formulas read,
    /// changed the locale every formula reads by, or the seed random numbers come from.
    touched: bool,
    /// Whether operations applied changed the workbook's shape (sheets, rows, columns): every formula is worked out
    /// again at once.
    reshaped: bool,
    /// A pivot edit calculates its new spill before the answer is sent.
    works_out_pivot: bool,
    /// Formulas whose text rows or columns inserted after every cell changed (a range the lines went into, a cell
    /// past them): when formulas wait to be worked out, they are told at once.
    texts_to_check: Vec<(String, String, String)>,
}

pub struct WorkbookSession {
    /// The workbook as the page shows it.
    workbook: Workbook,
    #[allow(dead_code)]
    clock: Box<dyn Clock>,
    /// Whether the session keeps the page in sync with the server.
    syncing: bool,
    confirmed: Workbook,
    confirmed_revision: u64,
    /// The newest revision the server has told of.
    newest_revision: u64,
    is_loaded: bool,
    queue: Vec<Queued>,
    loading: Option<Loading>,
    /// Others' edits streamed ahead of the revision after the confirmed one, kept until the confirmed revision
    /// reaches them.
    ahead: std::collections::BTreeMap<u64, Applied>,
    /// What was deleted when the confirmed workbook was loaded.
    forgotten: Forgotten,
    /// The locale the page was last told of formulas in.
    told_locale: String,
    /// Why the session stopped, when it has.
    stop: Option<&'static str>,
    answer_before_calculating: bool,
    reading: Option<(ClockReading, Option<String>)>,
    /// The page's own edits it can take back, and those it took back to make again.
    steps: history::Steps,
    /// The values of the formulas' cells (and the cells they spill into) as the page was last told them, with the
    /// number format each brings, by sheet, row and column id: line ids are interned per workbook, and the workbook is
    /// built anew on a load or a rebuild.
    told: HashMap<(String, String, String), Told>,
    /// Whether the page is yet to ask for the formulas to be worked out (`calculate`).
    is_calculation_due: bool,
    /// The cells changed since the formulas were last worked out (`formulas_wait`). None when something else changed
    /// that formulas read (the clock, the locale, rows inserted), which only working them out settles.
    changed: Option<Changed>,
    /// Whether operations were applied directly (`load`, `apply`, `undo`, `replay`) since the formulas were last worked
    /// out: a clock reading then tells the page everything changed.
    is_changed_directly: bool,
    report: Report,
    /// The operations of edits refused once tried (applied and then taken back): what they touched is
    /// told in the next answer that tells changes.
    untold: Vec<Op>,
    /// Values a sort worked out before it was answered, and everything after a refusal that rebuilt the calculation:
    /// told with the next state the page is given.
    untold_changes: Changes,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Load {
        ops: Vec<Op>,
    },
    Apply {
        ops: Vec<Op>,
    },
    Undo {
        ops: Vec<Op>,
        reverse: Vec<Op>,
    },
    Replay {
        edit: Json,
    },
    ReadWorkbook,
    ReadWorkbookWithCellsPacked,
    #[serde(rename_all = "camelCase")]
    ReadRowsWithCellsPacked {
        sheet_id: String,
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        rows: Option<Vec<String>>,
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        columns: Option<packed::Columns>,
    },
    AnswerBeforeCalculating,
    Calculate,
    ReceiveServerRevision {
        revision: u64,
    },
    #[serde(rename_all = "camelCase")]
    ReceiveClockReading {
        #[serde(deserialize_with = "reading_milliseconds")]
        unix_milliseconds: i64,
        #[serde(deserialize_with = "reading_offset")]
        utc_offset_in_minutes: i32,
        time_zone: Option<String>,
    },
    ReceiveLoadPage {
        from: u64,
        revision: u64,
        v: u32,
        ops: Vec<Json>,
        next: Option<u64>,
    },
    LinesOfLoad {
        ops: Vec<Op>,
    },
    ReceiveLinesOfLoad {
        from: u64,
        revision: u64,
        #[serde(rename = "v")]
        _v: u32,
        lines: String,
        next: Option<u64>,
    },
    ReceiveStreamedEdit {
        revision: u64,
        applied: Applied,
    },
    #[serde(rename_all = "camelCase")]
    ReceiveSendOutcome {
        op_id: String,
        outcome: Outcome,
    },
    #[serde(rename_all = "camelCase")]
    QueueEdit {
        op_id: String,
        new_id_code: String,
        edit: Json,
        /// Read strictly with the request: anything but texts no cell shows makes it unreadable. Null or left out,
        /// nothing is shown first.
        #[serde(default)]
        shown_to_the_person: Option<Vec<crate::typing::TextThatNoCellShows>>,
        #[serde(default)]
        time_zone_of_the_browser: Option<String>,
        /// Edits made first, in order, as part of it (left out, none; null is unreadable).
        #[serde(default)]
        edits_before: Vec<EditBefore>,
        /// Edits made after it, each when it can be (left out, none; null is unreadable).
        #[serde(default)]
        edits_that_go_along: Vec<EditAlong>,
        /// The sheet whose columns are made wider for the numbers the edit gives a pattern (`formatCells` with a
        /// number format); null or left out, none.
        #[serde(default)]
        makes_room_for_numbers_in: Option<String>,
        /// The order the person sees a sheet's rows in, when they put them in an order of their own (read
        /// strictly, its sheet and runs of rows): fills, pastes and borders of the sheet are made in it
        /// (`edits/seen.rs`).
        #[serde(default)]
        own_row_order: Option<OwnRowOrder>,
    },
    #[serde(rename_all = "camelCase")]
    QueueNextUndo {
        op_id: String,
    },
    #[serde(rename_all = "camelCase")]
    QueueNextRedo {
        op_id: String,
    },
    #[serde(rename_all = "camelCase")]
    QueueEditsThatTakeBack {
        op_id: String,
        built_on_revision: u64,
        edits: Vec<Json>,
    },
    EditsThatTakeBackAllSince {
        edits: Vec<history_reads::Kept>,
    },
    EditsThatUndo {
        edits: Vec<history_reads::Kept>,
    },
    #[serde(rename_all = "camelCase")]
    HistoryOfACell {
        sheet_id: String,
        cell: crate::workbook::layout::CellIds,
        edits: Vec<Json>,
    },
    #[serde(rename_all = "camelCase")]
    HistoryOfARow {
        sheet_id: String,
        r: String,
        edits: Vec<Json>,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Applied {
    #[allow(dead_code)]
    node: Json,
    v: u32,
    #[allow(dead_code)]
    base: u64,
    ops: Vec<Json>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Outcome {
    Saved { revision: u64 },
    Refused,
}

/// The most cells a workbook holds (`limits.mostCells` of the shared description).
const MOST_CELLS: usize = 500_000;

/// The cells the workbook keeps, those of deleted sheets, rows and columns among them.
fn cells_kept(workbook: &Workbook) -> usize {
    workbook.sheets.iter().chain(&workbook.deleted_sheets).map(|sheet| sheet.cells.len()).sum()
}

fn refused(refusal: impl serde::Serialize) -> String {
    json!({"kind": "refused", "refusal": refusal}).to_string()
}

/// An edit made before the one queued, as part of it (`editsBefore`): whether the place it changes is pointed at
/// (`placesChangedBefore`), and the code of its new ids.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditBefore {
    edit: Json,
    is_pointed_at: bool,
    new_id_code: String,
}

/// An edit made after the one queued, when it can be (`editsThatGoAlong`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditAlong {
    edit: Json,
    new_id_code: String,
}

/// What became of an edit that goes along (`editsThatWentAlong`).
enum WentAlong {
    Made(place::Told),
    NothingToChange,
    LeftOut(Json),
}

/// An edit applied to the workbook shown: its operations, the parts they are sent in (each with what reverses it after
/// the parts before it), and the place it changed.
struct Unit {
    ops: Vec<Op>,
    works_out_pivot: bool,
    /// Each with whether it is one of the parts of operations too large to send whole.
    parts: Vec<(Vec<Op>, Vec<Op>, bool)>,
    place: place::Place,
    /// How many of the last parts are the widths making room for numbers (`makesRoomForNumbersIn`).
    room: usize,
}

/// A code of new ids as they are made: 8 to 16 small letters and digits.
fn is_code_of_new_ids(code: &str) -> bool {
    (8..=16).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// Why an edit before or along another was refused, as the page reads it.
fn refusal_of(refused: edits::Refused) -> Json {
    match refused {
        edits::Refused::Unreadable => json!(Refusal::UnreadableRequest),
        edits::Refused::Because(why) | edits::Refused::Tried(why, _) => json!(why),
        edits::Refused::Answer(answer) => answer.get("refusal").cloned().unwrap_or(Json::Null),
    }
}

/// Operations applied to a workbook, as the parts they are sent in: whole, or too large for that, in parts, each
/// taken back by what reverses it after the parts before it.
/// The rows and columns of the cells an edit's operations give a number format in sheet `sheet_id`.
fn numbers_given_patterns(workbook: &Workbook, ops: &[Op], sheet_id: &str) -> Vec<(HashSet<LineId>, HashSet<LineId>)> {
    let lines = |runs: &[crate::ids::IdRun]| -> HashSet<LineId> {
        runs.iter().flat_map(|run| (run.first..run.first + run.count).map(move |n| (run.base.as_str(), n))).filter_map(|(b, n)| Some(LineId { base: workbook.bases.find(b)?, n })).collect()
    };
    ops.iter()
        .filter_map(|op| match op {
            Op::SetCellFormats { sheet_id: id, formats } if id == sheet_id => Some(formats),
            _ => None,
        })
        .flatten()
        .filter(|f| f.format.get("numberFormat").is_some())
        .map(|f| (lines(&f.rows), lines(&f.columns)))
        .collect()
}

/// The order a person sees a sheet's rows in (`queueEdit`'s `ownRowOrder`), read in `edits/seen.rs`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnRowOrder {
    sheet_id: String,
    #[serde(deserialize_with = "nonempty_runs")]
    rows: Vec<crate::ids::IdRun>,
}

fn nonempty_runs<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<crate::ids::IdRun>, D::Error> {
    let runs = Vec::<crate::ids::IdRun>::deserialize(d)?;
    // None, or a run of none, is not read.
    if runs.is_empty() || runs.iter().any(|run| run.count == 0) {
        return Err(serde::de::Error::custom("no rows"));
    }
    Ok(runs)
}

fn parts_to_send(before: &Workbook, ops: &[Op], reverse: Vec<Op>) -> Result<Vec<(Vec<Op>, Vec<Op>, bool)>, Json> {
    match parts::of(ops, &reverse) {
        Ok(None) => Ok(vec![(ops.to_vec(), reverse, false)]),
        Ok(Some(parts)) => {
            let is_split = parts.len() > 1;
            let mut shown = before.clone();
            parts
                .into_iter()
                .map(|ops| shown.apply_in_place(&ops).map(|reverse| (ops, reverse, is_split)).map_err(|r| json!(r)))
                .collect()
        }
        Err(parts::TooLarge) => Err(json!(Refusal::EditTooLarge)),
    }
}

/// Operations as the server sent them, when every one is readable.
fn read_ops(ops: &[Json]) -> Option<Vec<Op>> {
    ops.iter().map(|op| serde_json::from_value(op.clone()).ok()).collect()
}

/// What the formulas of the workbook shown last came to, into the workbook shown anew: of the cells that hold what
/// they held.
fn carry_outcomes(old: &Workbook, new: &mut Workbook) {
    let mut outcomes = HashMap::with_capacity(old.outcomes.len());
    for ((sheet_id, r, c), outcome) in &old.outcomes {
        let (Some(i), Some(j)) = (old.sheet_index(sheet_id), new.sheet_index(sheet_id)) else { continue };
        let (Some(nr), Some(nc)) = (new.bases.parse(&old.bases.text(*r)), new.bases.parse(&old.bases.text(*c))) else {
            continue;
        };
        let (Some(was), Some(is)) = (old.sheets[i].cells.get(&(*r, *c)), new.sheets[j].cells.get(&(nr, nc))) else { continue };
        if was.input == is.input {
            outcomes.insert((sheet_id.clone(), nr, nc), outcome.clone());
        }
    }
    new.outcomes = outcomes;
}

/// What the page is told of a formula or of a cell it spills into.
struct Told {
    value: Value,
    brought: Option<crate::brought::Brought>,
    cycle_entry: Option<(String, String, String)>,
    spill: Option<Json>,
    spilled: bool,
    /// A formula's anchor is told again when any value of its spill changes.
    array: Option<std::rc::Rc<crate::value::Array>>,
    formula_text: Option<String>,
}

impl Told {
    fn changed_from(&self, before: &Self, reshaped: bool) -> bool {
        self.value != before.value
            || self.brought != before.brought
            || self.spill != before.spill
            || self.spilled != before.spilled
            || self.array != before.array
            || self.formula_text != before.formula_text
            // After a shape change, a new cycle entry on its own does not trigger a cell notification.
            || (!reshaped && self.cycle_entry != before.cycle_entry)
    }
}

fn formula_values(workbook: &Workbook) -> HashMap<(String, String, String), Told> {
    let mut values = HashMap::with_capacity(workbook.outcomes.len());
    let text = |line: LineId| workbook.bases.text(line);
    let cell = |(s, r, c): crate::calculate::CellKey| {
        let sheet = workbook.sheets.get(s)?;
        Some((sheet.id.clone(), text(sheet.rows.line(r)?), text(sheet.columns.line(c)?)))
    };
    for ((sheet_id, r, c), outcome) in &workbook.outcomes {
        let entry = outcome.cycle_entry.and_then(cell);
        let sheet = workbook.sheet_index(sheet_id).map(|i| &workbook.sheets[i]);
        let spill = sheet.zip(outcome.spill.as_ref()).map(|(sheet, spill)| {
            serde_json::to_value(workbook.spill_contents(sheet, spill)).unwrap_or_default()
        });
        let array = match &outcome.spill {
            Some(crate::calculate::SpillOutcome::Fills { array, .. }) => Some(array.clone()),
            _ => None,
        };
        let formula_text = sheet.zip(workbook.sheet_index(sheet_id)).and_then(|(sheet, i)| match &sheet.cells.get(&(*r, *c))?.input {
            crate::workbook::Input::Formula { formula } => Some(workbook.formula_text(i, formula)),
            _ => None,
        });
        let told = Told {
            value: outcome.value.clone(),
            brought: outcome.brought.clone(),
            cycle_entry: entry,
            spill,
            spilled: false,
            array,
            formula_text,
        };
        values.insert((sheet_id.clone(), text(*r), text(*c)), told);
        let (Some(sheet), Some(crate::calculate::SpillOutcome::Fills { array, .. })) = (sheet, &outcome.spill) else {
            continue;
        };
        let (Some(top), Some(left)) = (sheet.rows.position(*r), sheet.columns.position(*c)) else { continue };
        for ((i, j), value) in array.entries() {
            if (i, j) == (0, 0) {
                continue;
            }
            let (Some(row), Some(column)) = (sheet.rows.line(top + i), sheet.columns.line(left + j)) else {
                continue;
            };
            let told = Told {
                value: value.clone(),
                brought: None,
                cycle_entry: None,
                spill: None,
                spilled: true,
                array: None,
                formula_text: None,
            };
            values.insert((sheet_id.clone(), text(row), text(column)), told);
        }
    }
    values
}

/// Whether a formula is the one a cell had before: both unreadable, or the same text with references to the same
/// cells (however they are written).
fn is_same_formula(before: &Workbook, old: Option<&crate::workbook::Cell>, after: &Workbook, new: &crate::formula::StoredFormula) -> bool {
    let Some(old) = old else { return false };
    let (crate::workbook::Input::Formula { formula: was }, Some(parsed)) = (&old.input, &old.parsed) else { return false };
    if parsed.is_err() && crate::formula::parse(&new.text_between_references).is_err() {
        return true;
    }
    let place = |workbook: &Workbook, reference| {
        workbook.locate(reference).map(|l| (workbook.sheets[l.sheet].id.clone(), l.top.0, l.bottom.0, l.left.0, l.right.0))
    };
    was.text_between_references == new.text_between_references
        && was.references.len() == new.references.len()
        && was.references.iter().zip(&new.references).all(|(a, b)| place(before, a) == place(after, b))
}

/// The cells changed since the formulas were last worked out, by sheet, row and column id.
#[derive(Default)]
struct Changed {
    /// Cells given another value (or a number or formula another number format): the formulas that read them wait.
    read: HashSet<(String, String, String)>,
    /// Cells given another formula, a formula that draws its random numbers anew, or one reading past rows or columns
    /// the page's edit inserted after every cell: it waits.
    formulas: HashSet<(String, String, String)>,
    /// Cells made blank or filled: an array that could fill one (not kept out by an earlier one's) waits.
    filled: HashSet<(String, String, String)>,
    /// The cells the array of a formula taken out could fill (by sheet id, and row and column positions): a formula
    /// after it whose array could fill one of them waits, and one that reads one.
    arrays_gone: Vec<(String, Place)>,
}

/// What operations (applied: `after` is the workbook after them) leave formulas to work out again: whether any are
/// (a formula set, or a cell one reads), the cells set to another formula than they had, whose values are told
/// again once worked out, and the cells they changed.
fn touches_formulas(before: &Workbook, after: &Workbook, ops: &[Op]) -> (bool, Vec<(String, String, String)>, Changed) {
    use crate::calculate::spill_area;
    use crate::workbook::Input;
    let workbook = after;
    let formulas = || {
        workbook.sheets.iter().flat_map(|s| s.cells.values()).filter_map(|cell| match &cell.input {
            crate::workbook::Input::Formula { formula } => Some(formula),
            _ => None,
        })
    };
    let mut touched = false;
    let mut retold = Vec::new();
    let mut changed = Changed::default();
    let mut set: HashMap<usize, Vec<(usize, usize)>> = HashMap::new();
    let draws = |f: &crate::formula::StoredFormula| {
        f.text_between_references.iter().any(|t| t.to_ascii_uppercase().contains("RAND"))
    };
    for op in ops {
        match op {
            Op::Reseed { .. } if formulas().any(draws) => {
                touched = true;
                for sheet in &workbook.sheets {
                    for (&(r, c), cell) in &sheet.cells {
                        if matches!(&cell.input, crate::workbook::Input::Formula { formula } if draws(formula)) {
                            let at = (sheet.id.clone(), workbook.bases.text(r), workbook.bases.text(c));
                            changed.formulas.insert(at);
                        }
                    }
                }
            }
            Op::SetCells { sheet_id, cells, .. } => {
                let Some(s) = workbook.sheet_index(sheet_id) else { continue };
                let sheet = &workbook.sheets[s];
                for cell in cells {
                    let was_at = before.sheet_index(sheet_id).and_then(|i| {
                        Some((i, (before.bases.parse(&cell.r)?, before.bases.parse(&cell.c)?)))
                    });
                    let old = was_at.and_then(|(i, at)| before.sheets[i].cells.get(&at));
                    let is_same = match &cell.input {
                        Some(Input::Formula { formula }) => is_same_formula(before, old, after, formula),
                        _ => false,
                    };
                    // A cell made blank or filled, or a formula taken out whose array could fill cells, changes the
                    // arrays that could fill them.
                    let now = workbook.bases.parse(&cell.r).zip(workbook.bases.parse(&cell.c));
                    if old.is_some() != now.is_some_and(|at| sheet.cells.contains_key(&at)) {
                        changed.filled.insert((sheet_id.clone(), cell.r.clone(), cell.c.clone()));
                    }
                    let gone = was_at.filter(|_| !is_same).and_then(|(i, at)| spill_area(before, i, at));
                    if let Some(area) = gone {
                        changed.arrays_gone.push((sheet_id.clone(), area));
                    }
                    if let Some(Input::Formula { .. }) = &cell.input {
                        if !is_same {
                            touched = true;
                            retold.push((sheet_id.clone(), cell.r.clone(), cell.c.clone()));
                            changed.formulas.insert((sheet_id.clone(), cell.r.clone(), cell.c.clone()));
                        }
                        continue;
                    }
                    // A formula's cell given something else: the edit told of it, so what it was told is forgotten.
                    retold.push((sheet_id.clone(), cell.r.clone(), cell.c.clone()));
                    let (Some(r), Some(c)) = (workbook.bases.parse(&cell.r), workbook.bases.parse(&cell.c)) else {
                        continue;
                    };
                    // A cell set to the value it held (an option for the same text, say) changes nothing read.
                    let same = match held_value(before, sheet_id, &cell.r, &cell.c) {
                        None => false,
                        Some(Value::Blank) => !sheet.cells.contains_key(&(r, c)),
                        held => held == held_value(after, sheet_id, &cell.r, &cell.c),
                    };
                    if same {
                        continue;
                    }
                    changed.read.insert((sheet_id.clone(), cell.r.clone(), cell.c.clone()));
                    if let (Some(r), Some(c)) = (sheet.rows.position(r), sheet.columns.position(c)) {
                        set.entry(s).or_default().push((r, c));
                    }
                }
            }
            // A number or a formula given another number format: the formulas that read it bring another.
            Op::SetCellFormats { sheet_id, .. } => {
                let (Some(s), Some(b)) = (workbook.sheet_index(sheet_id), before.sheet_index(sheet_id)) else { continue };
                let (sheet, was) = (&workbook.sheets[s], &before.sheets[b]);
                // What it brings, rather than the pattern: `General` and `@` alike bring nothing.
                let pattern = |sheet: &crate::workbook::Sheet, at| {
                    let format = sheet.formats.get(crate::workbook::formats::Leaf::NumberFormat, at)?;
                    crate::brought::Brought::of_pattern(format.get("pattern")?.as_str()?)
                };
                for (&(r, c), cell) in &sheet.cells {
                    if !matches!(cell.input, crate::workbook::Input::Number { .. } | crate::workbook::Input::Formula { .. }) {
                        continue;
                    }
                    let then = (before.bases.parse(&workbook.bases.text(r)), before.bases.parse(&workbook.bases.text(c)));
                    let then = match then {
                        (Some(r), Some(c)) => pattern(was, (r, c)),
                        _ => None,
                    };
                    if pattern(sheet, (r, c)) != then {
                        changed.read.insert((sheet_id.clone(), workbook.bases.text(r), workbook.bases.text(c)));
                        if let (Some(r), Some(c)) = (sheet.rows.position(r), sheet.columns.position(c)) {
                            set.entry(s).or_default().push((r, c));
                        }
                    }
                }
            }
            // Options given other labels: the cells holding them read other texts.
            Op::SetDropdowns { sheet_id, .. } => {
                let Some(s) = workbook.sheet_index(sheet_id) else { continue };
                let sheet = &workbook.sheets[s];
                for (&(r, c), cell) in &sheet.cells {
                    if !matches!(cell.input, Input::DropdownOption { .. }) {
                        continue;
                    }
                    let (row, column) = (workbook.bases.text(r), workbook.bases.text(c));
                    if held_value(before, sheet_id, &row, &column) == held_value(after, sheet_id, &row, &column) {
                        continue;
                    }
                    changed.read.insert((sheet_id.clone(), row, column));
                    if let (Some(r), Some(c)) = (sheet.rows.position(r), sheet.columns.position(c)) {
                        set.entry(s).or_default().push((r, c));
                    }
                }
            }
            _ => {}
        }
    }
    let touched = touched || (!set.is_empty() && formulas_read(workbook, reads_one_of(&set), |_, _| false));
    let touched = touched || spills_wait(workbook, &changed);
    (touched, retold, changed)
}

/// Whether a place holds one of the cells `set` (by sheet, and row and column position).
fn reads_one_of(set: &HashMap<usize, Vec<(usize, usize)>>) -> impl Fn(&Place) -> bool + '_ {
    |at| {
        let Some(cells) = set.get(&at.sheet) else { return false };
        cells.iter().any(|(r, c)| (at.top..=at.bottom).contains(r) && (at.left..=at.right).contains(c))
    }
}

/// Whether arrays wait to be worked out for cells made blank or filled since (one that could fill such a cell, not
/// kept out by an earlier one's), or for formulas taken out whose arrays could fill cells (a formula after one whose
/// array could fill one of them, and one that reads one).
fn spills_wait(workbook: &Workbook, changed: &Changed) -> bool {
    if changed.filled.is_empty() && changed.arrays_gone.is_empty() {
        return false;
    }
    let at = |(sheet_id, r, c): &(String, String, String)| -> Option<(usize, usize, usize)> {
        let s = workbook.sheet_index(sheet_id)?;
        let sheet = &workbook.sheets[s];
        let (r, c) = (workbook.bases.parse(r)?, workbook.bases.parse(c)?);
        Some((s, sheet.rows.position(r)?, sheet.columns.position(c)?))
    };
    let filled: Vec<(usize, usize, usize)> = changed.filled.iter().filter_map(at).collect();
    let gone: Vec<Place> = changed
        .arrays_gone
        .iter()
        .filter_map(|(sheet_id, area)| Some(Place { sheet: workbook.sheet_index(sheet_id)?, ..*area }))
        .collect();
    let meet = crate::calculate::meet;
    let spill_waits = crate::calculate::spill_areas(workbook).into_iter().any(|(area, kept_out)| {
        let own = (area.top, area.left);
        let fills = |&(s, r, c): &(usize, usize, usize)| {
            let inside = (area.top..=area.bottom).contains(&r) && (area.left..=area.right).contains(&c);
            s == area.sheet && (r, c) != own && inside
        };
        (!kept_out && filled.iter().any(fills)) || gone.iter().any(|g| (g.top, g.left) < own && meet(g, &area))
    });
    spill_waits || (!gone.is_empty() && formulas_read(workbook, |at| gone.iter().any(|g| meet(g, at)), |_, _| false))
}

/// Whether a formula still there (not in a deleted row or column) is `own`, or reads a place `reads` is true of.
fn formulas_read(
    workbook: &Workbook,
    reads: impl Fn(&Place) -> bool,
    own: impl Fn(&crate::workbook::Sheet, (crate::ids::LineId, crate::ids::LineId)) -> bool,
) -> bool {
    workbook.sheets.iter().any(|sheet| {
        sheet.cells.iter().any(|(&(r, c), cell)| {
            let crate::workbook::Input::Formula { formula } = &cell.input else { return false };
            // A formula in a deleted row or column is not there to read anything.
            if sheet.rows.position(r).is_none() || sheet.columns.position(c).is_none() {
                return false;
            }
            if own(sheet, (r, c)) {
                return true;
            }
            // The references whose cells it reads: not those written where a function takes only the place.
            let read: Vec<usize> = match cell.parsed.as_deref() {
                Some(Ok(expr)) => {
                    let mut read = Vec::new();
                    crate::calculate::read_references(expr, &mut read);
                    read
                }
                Some(Err(_)) => Vec::new(),
                None => (0..formula.references.len()).collect(),
            };
            read.into_iter().filter_map(|i| formula.references.get(i)).any(|reference| {
                let Some(at) = workbook.locate(reference) else { return false };
                let (top, left, bottom, right) = (at.top.0, at.left.0, at.bottom.0, at.right.0);
                reads(&Place { sheet: at.sheet, top, left, bottom, right })
            })
        })
    })
}

/// Whether formulas wait to be worked out for what changed since they last were: a formula set since, one that
/// reads a cell given another value since, or an array whose cells changed (`spills_wait`). Cleared, the formulas
/// set since and those reading what changed wait no more.
fn formulas_wait(workbook: &Workbook, changed: &Changed) -> bool {
    let mut set: HashMap<usize, Vec<(usize, usize)>> = HashMap::new();
    for (sheet_id, r, c) in &changed.read {
        let Some(s) = workbook.sheet_index(sheet_id) else { continue };
        let sheet = &workbook.sheets[s];
        let (Some(r), Some(c)) = (workbook.bases.parse(r), workbook.bases.parse(c)) else { continue };
        if let (Some(r), Some(c)) = (sheet.rows.position(r), sheet.columns.position(c)) {
            set.entry(s).or_default().push((r, c));
        }
    }
    formulas_read(workbook, reads_one_of(&set), |sheet, (r, c)| {
        changed.formulas.contains(&(sheet.id.clone(), workbook.bases.text(r), workbook.bases.text(c)))
    }) || spills_wait(workbook, changed)
}

/// Cells an edit set to the formula they had (as `is_same_formula` sees it) keep what it came to:
/// waiting for `calculate`, they read it still.
fn keep_outcomes(before: &Workbook, after: &mut Workbook, ops: &[Op]) {
    for op in ops {
        let Op::SetCells { sheet_id, cells, .. } = op else { continue };
        let Some(i) = before.sheet_index(sheet_id) else { continue };
        for cell in cells {
            let Some(crate::workbook::Input::Formula { formula }) = &cell.input else { continue };
            let (Some(r), Some(c)) = (before.bases.parse(&cell.r), before.bases.parse(&cell.c)) else { continue };
            let key = (sheet_id.clone(), r, c);
            let Some(outcome) = before.outcomes.get(&key) else { continue };
            if is_same_formula(before, before.sheets[i].cells.get(&(r, c)), after, formula) {
                after.outcomes.insert(key, outcome.clone());
            }
        }
    }
}

/// Whether a formula in a cell still there calls NOW, and whether one calls TODAY.
fn clock_calls(workbook: &Workbook) -> (bool, bool) {
    use crate::formula::parse::Expr;
    fn calls(expr: &Expr, called: &mut (bool, bool)) {
        match expr {
            Expr::Call { name, arguments, .. } => {
                match &**name {
                    "NOW" => called.0 = true,
                    "TODAY" => called.1 = true,
                    _ => {}
                }
                arguments.iter().for_each(|a| calls(a, called));
            }
            Expr::Unary(_, operand) => calls(operand, called),
            Expr::Binary(_, a, b) => {
                calls(a, called);
                calls(b, called);
            }
            _ => {}
        }
    }
    let mut called = (false, false);
    for s in &workbook.sheets {
        for (&(r, c), cell) in &s.cells {
            if let Some(Ok(expr)) = cell.parsed.as_deref() {
                if s.rows.position(r).is_some() && s.columns.position(c).is_some() {
                    calls(expr, &mut called);
                }
            }
        }
    }
    called
}

/// The value a cell holds of its own: blank, a number, a text (an option's label) or a truth value; none for a
/// formula, or a cell not in the workbook.
fn held_value(workbook: &Workbook, sheet_id: &str, r: &str, c: &str) -> Option<Value> {
    use crate::workbook::Input;
    let sheet = &workbook.sheets[workbook.sheet_index(sheet_id)?];
    let at = (workbook.bases.parse(r)?, workbook.bases.parse(c)?);
    Some(match sheet.cells.get(&at).map(|cell| &cell.input) {
        None => Value::Blank,
        Some(Input::Number { value }) => Value::Number(*value),
        Some(Input::Text { value }) => Value::text(value.as_str()),
        Some(Input::Boolean { value }) => Value::Boolean(*value),
        Some(Input::DropdownOption { option_id, label }) => {
            Value::text(sheet.dropdown_option(option_id).map_or(label, |o| &o.label).as_str())
        }
        Some(Input::Formula { .. }) => return None,
        Some(input @ (Input::User { .. } | Input::Users { .. } | Input::RichText { .. })) => {
            Value::text(input.reads_as_text().unwrap_or_default().as_str())
        }
    })
}

/// Whether a cell holds something of its own other than a formula.
fn holds_own_value(workbook: &Workbook, (sheet_id, r, c): &(String, String, String)) -> bool {
    let Some(i) = workbook.sheet_index(sheet_id) else { return false };
    let Some(at) = workbook.bases.parse(r).zip(workbook.bases.parse(c)) else { return false };
    workbook.sheets[i].cells.get(&at).is_some_and(|cell| !matches!(cell.input, crate::workbook::Input::Formula { .. }))
}

/// The cells the array worked out in a cell fills, but its own.
fn cells_filled_from(workbook: &Workbook, sheet_id: &str, r: &str, c: &str) -> Vec<(String, String, String)> {
    let Some(sheet) = workbook.sheet_index(sheet_id).map(|i| &workbook.sheets[i]) else { return Vec::new() };
    let Some((r, c)) = workbook.bases.parse(r).zip(workbook.bases.parse(c)) else { return Vec::new() };
    let outcome = workbook.outcome(sheet_id, r, c).and_then(|o| o.spill.as_ref());
    let Some(crate::calculate::SpillOutcome::Fills { array, .. }) = outcome else { return Vec::new() };
    let Some((top, left)) = sheet.rows.position(r).zip(sheet.columns.position(c)) else { return Vec::new() };
    array.entries()
        .filter(|(at, _)| *at != (0, 0))
        .filter_map(|((row, column), _)| {
            let (r, c) = sheet.rows.line(top + row).zip(sheet.columns.line(left + column))?;
            Some((sheet_id.to_string(), workbook.bases.text(r), workbook.bases.text(c)))
        })
        .collect()
}

/// Whether any formula is left in a sheet, in a row and column not deleted.
fn has_live_formulas(workbook: &Workbook) -> bool {
    workbook.sheets.iter().any(|s| {
        s.cells.iter().any(|(&(r, c), cell)| {
            matches!(cell.input, crate::workbook::Input::Formula { .. })
                && s.rows.position(r).is_some()
                && s.columns.position(c).is_some()
        })
    })
}

/// The place another's edit changed, as the page is told it.
enum OthersPlace {
    Now(Json),
    Later(place::Place),
    Insertion(Op),
}

/// Whether a workbook is one the page's edits may leave: a sheet at least, and no two sheets of one name, whatever
/// its case.
fn is_whole(workbook: &Workbook) -> bool {
    let mut names = HashSet::new();
    !workbook.sheets.is_empty() && workbook.sheets.iter().all(|s| names.insert(s.name.to_lowercase()))
}

fn same_ops(a: &[Op], b: &[Op]) -> bool {
    serde_json::to_value(a).ok() == serde_json::to_value(b).ok()
}

/// What operations (applied: the workbook is as it is after them) leave to work out of the workbook's shape:
/// whether every formula is worked out again at once (`reshaped`), and the formulas that are to be (`touched`, by
/// sheet, row and column id). Sheets, deleted, undeleted and moved rows and columns change it all. Rows or columns
/// inserted change it all only when cells move to make room; inserted after every cell, they change what formulas
/// whose references reach the insertion read: a range or a whole row or column over it, or a cell past it.
fn shape_change(before: &Workbook, after: &Workbook, ops: &[Op]) -> (bool, Vec<(String, String, String)>) {
    let mut touched = Vec::new();
    for op in ops {
        let (sheet_id, run, is_rows) = match op {
            Op::InsertRows { sheet_id, rows, .. } => (sheet_id, rows, true),
            Op::InsertColumns { sheet_id, columns, .. } => (sheet_id, columns, false),
            op if reshapes(std::slice::from_ref(op)) => return (true, Vec::new()),
            _ => continue,
        };
        let Some(s) = after.sheet_index(sheet_id) else { return (true, Vec::new()) };
        let sheet = &after.sheets[s];
        let axis = if is_rows { &sheet.rows } else { &sheet.columns };
        let first = after.bases.find(&run.base).and_then(|base| axis.position(crate::ids::LineId { base, n: run.first }));
        let Some(at) = first else { return (true, Vec::new()) };
        let past = at + run.count as usize;
        // An insertion moves cells that were present before the edit. A grouped paste
        // may create values farther down an otherwise empty sheet in the same request.
        let moves = before.sheet_index(sheet_id).is_some_and(|i| {
            before.sheets[i].cells.keys().any(|&(r, c)| match (sheet.rows.position(r), sheet.columns.position(c)) {
                (Some(row), Some(column)) => (if is_rows { row } else { column }) >= past,
                _ => false,
            })
        });
        if moves {
            return (true, Vec::new());
        }
        // Formulas in deleted rows or columns are not worked out, nor those that do not read (#ERROR!).
        for sheet in &after.sheets {
            for (&(r, c), cell) in &sheet.cells {
                if !sheet.rows.contains(r) || !sheet.columns.contains(c) {
                    continue;
                }
                let crate::workbook::Input::Formula { formula } = &cell.input else { continue };
                if matches!(cell.parsed.as_deref(), Some(Err(_))) {
                    continue;
                }
                let reaches = formula.references.iter().any(|reference| {
                    let Some(l) = after.locate(reference) else { return false };
                    l.sheet == s && if is_rows { l.bottom.0 } else { l.right.0 } >= at
                });
                if reaches {
                    touched.push((sheet.id.clone(), after.bases.text(r), after.bases.text(c)));
                }
            }
        }
    }
    (false, touched)
}

/// The formulas whose text rows or columns inserted after every cell change (operations applied: the workbook is as
/// it is after them): a reference of theirs ends, or is, past the lines inserted, or ends on a deleted line that now
/// gives way to one of them. Formulas that do not read (#ERROR!) too; not those in deleted rows or columns.
fn texts_moved(after: &Workbook, ops: &[Op]) -> Vec<(String, String, String)> {
    use crate::formula::Reference;
    let mut moved = Vec::new();
    for op in ops {
        let (sheet_id, run, is_rows) = match op {
            Op::InsertRows { sheet_id, rows, .. } => (sheet_id, rows, true),
            Op::InsertColumns { sheet_id, columns, .. } => (sheet_id, columns, false),
            _ => continue,
        };
        let Some(s) = after.sheet_index(sheet_id) else { continue };
        let axis = if is_rows { &after.sheets[s].rows } else { &after.sheets[s].columns };
        let first = after.bases.find(&run.base).and_then(|base| axis.position(crate::ids::LineId { base, n: run.first }));
        let Some(at) = first else { continue };
        // An end where it was is before the lines; one past them, or a deleted one that gives way to one of them
        // (toward the other end), is not.
        let moved_end = |p: usize| p >= at;
        let ends = |reference: &Reference| -> bool {
            let Some(l) = after.locate(reference).filter(|l| l.sheet == s) else { return false };
            match (reference, is_rows) {
                (Reference::Cell { .. } | Reference::Range { .. } | Reference::Rows { .. }, true) => {
                    moved_end(l.top.0) || moved_end(l.bottom.0)
                }
                (Reference::Cell { .. } | Reference::Range { .. } | Reference::Columns { .. }, false) => {
                    moved_end(l.left.0) || moved_end(l.right.0)
                }
                (Reference::Columns { top, .. }, true) => top.is_some() && moved_end(l.top.0),
                (Reference::Rows { left, .. }, false) => left.is_some() && moved_end(l.left.0),
            }
        };
        for sheet in &after.sheets {
            for (&(r, c), cell) in &sheet.cells {
                if !sheet.rows.contains(r) || !sheet.columns.contains(c) {
                    continue;
                }
                let crate::workbook::Input::Formula { formula } = &cell.input else { continue };
                if formula.references.iter().any(ends) {
                    moved.push((sheet.id.clone(), after.bases.text(r), after.bases.text(c)));
                }
            }
        }
    }
    moved
}

/// Whether operations change the workbook's shape: its sheets, or the rows and columns in them.
fn reshapes(ops: &[Op]) -> bool {
    ops.iter().any(|op| {
        matches!(
            op,
            Op::InsertSheet { .. }
                | Op::DeleteSheet { .. }
                | Op::UndeleteSheet { .. }
                | Op::MoveSheets { .. }
                | Op::InsertRows { .. }
                | Op::InsertColumns { .. }
                | Op::DeleteRows { .. }
                | Op::DeleteColumns { .. }
                | Op::UndeleteRows { .. }
                | Op::UndeleteColumns { .. }
                | Op::MoveRows { .. }
                | Op::ReorderRows { .. }
                | Op::MoveColumns { .. }
        )
    })
}

impl WorkbookSession {
    pub fn new(clock: Box<dyn Clock>) -> WorkbookSession {
        WorkbookSession {
            workbook: Workbook::default(),
            clock,
            syncing: false,
            confirmed: Workbook::default(),
            confirmed_revision: 0,
            newest_revision: 0,
            is_loaded: false,
            queue: Vec::new(),
            loading: None,
            ahead: Default::default(),
            forgotten: Forgotten::default(),
            told_locale: String::new(),
            stop: None,
            answer_before_calculating: false,
            reading: None,
            steps: history::Steps::default(),
            told: HashMap::new(),
            is_calculation_due: false,
            changed: Some(Changed::default()),
            is_changed_directly: false,
            report: Report::default(),
            untold: Vec::new(),
            untold_changes: Changes::default(),
        }
    }

    pub fn answer_json(&mut self, request: &str) -> String {
        self.answer_with_cells(request, |_, _| {})
    }

    /// A request answered as JSON. Packed reads send each associated block through `take` in index order.
    pub fn answer_with_cells(&mut self, request: &str, mut take: impl FnMut(&[u8], &str)) -> String {
        let Ok(json) = serde_json::from_str::<Json>(request) else {
            return refused(Refusal::UnreadableRequest);
        };
        if json.get("kind").and_then(Json::as_str).is_some_and(reads::is_read) {
            // A read that works the formulas out first does what `calculate` does (the page is told of the values
            // changed in the next answer).
            if reads::works_formulas_out(&self.workbook, &json) {
                self.is_calculation_due = false;
                for (sheet_id, r, c) in self.values_changed() {
                    self.untold_changes.cell(&sheet_id, &r, &c);
                }
            }
            // Formulas waiting for `calculate` are read as they last came to.
            if !(self.answer_before_calculating && self.is_calculation_due) {
                self.calculate_now();
            }
            // The formats given and the suggestions count days from the clock reading the session has now.
            if reads::reads_the_clock(&json) {
                return reads::answer_at(&self.workbook, &json, self.now());
            }
            // Sorted rows are read as the formulas last came to, refused where a key may still change.
            if json.get("kind").and_then(Json::as_str) == Some("readRowsInSortedOrder") {
                return reads::tables::answer_while(&self.workbook, &json, self.is_calculation_due);
            }
            return reads::answer(&self.workbook, &json);
        }
        let Ok(request) = serde_json::from_value::<Request>(json) else {
            return refused(Refusal::UnreadableRequest);
        };
        self.report = Report::default();
        match request {
            Request::Load { .. } | Request::Apply { .. } | Request::Undo { .. } | Request::Replay { .. } if self.syncing => {
                refused(Refusal::SyncInUse)
            }
            // What a load deleted is not kept: nothing undeletes it.
            Request::Load { ops } | Request::Apply { ops } if ops.iter().all(Op::is_well_formed) && self.forgets(&ops) => {
                refused(Refusal::DeletedCellsNotLoaded)
            }
            Request::Undo { ops, reverse } if ops.iter().chain(&reverse).all(Op::is_well_formed) && self.forgets(&reverse) => {
                let _ = ops;
                refused(Refusal::DeletedCellsNotLoaded)
            }
            Request::Load { ops } => match self.workbook.apply(&ops) {
                Err(refusal) => refused(refusal),
                Ok(_) => {
                    self.workbook.revision += 1;
                    self.is_changed_directly |= !ops.is_empty();
                    self.forgotten.add(&ops);
                    json!({"kind": "loaded"}).to_string()
                }
            },
            Request::Apply { ops } => match self.workbook.apply(&ops) {
                Err(refusal) => refused(refusal),
                Ok(reverse) => {
                    self.workbook.revision += 1;
                    self.is_changed_directly |= !reverse.is_empty();
                    json!({"kind": "applied", "reverse": reverse}).to_string()
                }
            },
            Request::Undo { ops, reverse } if !ops.iter().chain(&reverse).all(Op::is_well_formed) => {
                let _ = (ops, reverse);
                refused(Refusal::UnreadableRequest)
            }
            Request::Undo { ops, reverse } => match history::take_back(&mut self.workbook, &ops, &reverse) {
                // A sheet's name taken since is a change like any other here.
                Err(history::NotTaken::SheetNameTaken(_)) => refused("changedSince"),
                Err(why) => refused(why.refusal()),
                Ok(reverse) => {
                    self.workbook.revision += 1;
                    self.is_changed_directly |= !reverse.is_empty();
                    json!({"kind": "applied", "reverse": reverse}).to_string()
                }
            },
            Request::Replay { edit } => match history::replayed(&edit) {
                Err(why) => refused(why),
                Ok(ops) if ops.iter().all(Op::is_well_formed) && self.forgets(&ops) => refused(Refusal::DeletedCellsNotLoaded),
                Ok(ops) => match self.workbook.apply(&ops) {
                    Err(refusal) => refused(refusal),
                    Ok(reverse) => {
                        self.workbook.revision += 1;
                        self.is_changed_directly |= !reverse.is_empty();
                        json!({"kind": "applied", "reverse": reverse}).to_string()
                    }
                },
            },
            Request::ReadWorkbook => {
                // Formulas waiting for `calculate` show what they last came to.
                if !(self.answer_before_calculating && self.is_calculation_due) {
                    self.calculate_now();
                }
                serde_json::to_string(&self.workbook.contents_written()).expect("contents serialize")
            }
            Request::ReadWorkbookWithCellsPacked => {
                if !(self.answer_before_calculating && self.is_calculation_due) {
                    self.calculate_now();
                }
                let mut next = 0;
                self.workbook.contents_written().pack(|cells| packed::send(cells, &mut next, &mut take)).to_string()
            }
            Request::ReadRowsWithCellsPacked { sheet_id, rows, columns } => {
                if !(self.answer_before_calculating && self.is_calculation_due) {
                    self.calculate_now();
                }
                packed::read_rows(&self.workbook, &sheet_id, rows, columns, take)
            }
            Request::AnswerBeforeCalculating => {
                self.start_syncing();
                self.answer_before_calculating = true;
                self.sync_state()
            }
            Request::Calculate => {
                self.start_syncing();
                self.is_calculation_due = false;
                self.sync_state()
            }
            Request::ReceiveServerRevision { revision } => {
                self.start_syncing();
                if self.stop.is_some() {
                    return self.sync_state();
                }
                self.hear_of(revision);
                if !self.is_loaded && self.loading.is_none() && self.newest_revision <= self.confirmed_revision {
                    self.is_loaded = true;
                }
                self.sync_state()
            }
            Request::ReceiveClockReading { unix_milliseconds, utc_offset_in_minutes, time_zone } => {
                // Operations applied directly and not yet worked out: the page is told everything changed.
                if !self.syncing && self.is_changed_directly {
                    self.report.changes.everything();
                }
                self.start_syncing();
                let before = self.now();
                self.reading = Some((ClockReading { unix_milliseconds, utc_offset_in_minutes }, time_zone));
                let now = self.now();
                let another_day = now.map(f64::floor) != before.map(f64::floor);
                // Another day: conditional formats that count days from today give other formats.
                if another_day {
                    for sheet in &self.workbook.sheets {
                        if reads::formats::reads_today(sheet) {
                            self.report.changes.formats_given(&sheet.id);
                        }
                    }
                }
                self.workbook.needs_calculation = true;
                // The formulas that read the clock are to be worked out again, after `calculate` when the page asked
                // to be answered first: those calling NOW when the hour NOW tells is another (or the reading stops or
                // starts counting for the workbook), those calling TODAY when the day is.
                let (calls_now, calls_today) = clock_calls(&self.workbook);
                let due = (calls_now && now != before) || (calls_today && another_day);
                self.report.touched |= due;
                self.anything_changed(due);
                self.settle_formulas();
                self.sync_state()
            }
            Request::ReceiveLoadPage { from, revision, v, ops, next } => {
                self.start_syncing();
                if self.stop.is_some() {
                    return self.sync_state();
                }
                self.receive_load_page(from, revision, v, &ops, next);
                self.catch_up();
                self.sync_state()
            }
            Request::LinesOfLoad { ops } => match snapshot::lines_of_load(&ops) {
                Ok(lines) => json!({"kind": "linesOfLoad", "lines": lines}).to_string(),
                Err(why) => refused(why),
            },
            Request::ReceiveLinesOfLoad { from, revision, lines, next, .. } => {
                self.start_syncing();
                if self.stop.is_none() {
                    self.receive_lines_of_load(from, revision, &lines, next);
                    self.catch_up();
                }
                self.sync_state()
            }
            Request::ReceiveStreamedEdit { revision, applied } => {
                self.start_syncing();
                if self.stop.is_some() {
                    return self.sync_state();
                }
                self.receive_streamed_edit(revision, applied);
                self.catch_up();
                self.sync_state()
            }
            Request::ReceiveSendOutcome { op_id, outcome } => {
                self.start_syncing();
                // A stopped session still hears what became of the edits it sent.
                self.receive_send_outcome(&op_id, outcome);
                if self.stop.is_none() {
                    self.catch_up();
                }
                self.sync_state()
            }
            Request::QueueEdit {
                op_id,
                new_id_code,
                edit,
                shown_to_the_person,
                time_zone_of_the_browser,
                edits_before,
                edits_that_go_along,
                makes_room_for_numbers_in,
                own_row_order,
            } => {
                self.start_syncing();
                let context = edits::Context {
                    is_among_several: !edits_before.is_empty() || !edits_that_go_along.is_empty(),
                    code: &new_id_code,
                    browser_zone: time_zone_of_the_browser.as_deref(),
                    shown_to_the_person: shown_to_the_person.as_deref(),
                    own_row_order: own_row_order.as_ref(),
                    seen: None,
                };
                self.queue_edit(op_id, edit, &context, edits_before, edits_that_go_along, makes_room_for_numbers_in.as_deref())
            }
            Request::QueueNextUndo { op_id } => {
                self.start_syncing();
                self.queue_next_reverse(op_id, history::Stack::Undo)
            }
            Request::QueueNextRedo { op_id } => {
                self.start_syncing();
                self.queue_next_reverse(op_id, history::Stack::Redo)
            }
            Request::QueueEditsThatTakeBack { op_id, built_on_revision, edits } => {
                self.start_syncing();
                self.queue_edits_that_take_back(op_id, built_on_revision, &edits)
            }
            Request::EditsThatTakeBackAllSince { edits } | Request::EditsThatUndo { edits }
                if !edits.iter().all(history_reads::Kept::is_well_formed) =>
            {
                refused(Refusal::UnreadableRequest)
            }
            Request::EditsThatTakeBackAllSince { edits } => {
                history_reads::edits_that_take_back(&self.workbook, &edits, history_reads::Taking::AllSince)
            }
            Request::EditsThatUndo { edits } => {
                history_reads::edits_that_take_back(&self.workbook, &edits, history_reads::Taking::Undo)
            }
            Request::HistoryOfACell { sheet_id, cell, edits } => {
                history_reads::history_of(&self.workbook, &sheet_id, history_reads::Of::Cell(cell), &edits)
            }
            Request::HistoryOfARow { sheet_id, r, edits } => {
                history_reads::history_of(&self.workbook, &sheet_id, history_reads::Of::Row(r), &edits)
            }
        }
    }

    fn start_syncing(&mut self) {
        if !self.syncing {
            self.syncing = true;
            self.confirmed = self.workbook.clone();
            self.confirmed_revision = self.workbook.revision;
            self.told_locale = self.workbook.locale.clone();
            self.newest_revision = self.confirmed_revision;
            // What the formulas come to now is what the page starts from: nothing to tell of yet.
            self.calculate_now();
            self.told = formula_values(&self.workbook);
        }
    }

    /// The server has a revision: when it is ahead of the confirmed one, the workbook is to be loaded afresh.
    fn hear_of(&mut self, revision: u64) {
        self.newest_revision = self.newest_revision.max(revision);
        if self.newest_revision > self.confirmed_revision && self.loading.is_none() {
            self.loading = Some(Loading::default());
        }
    }

    fn queue_edit(&mut self, op_id: String, edit: Json, context: &edits::Context, befores: Vec<EditBefore>,
        along: Vec<EditAlong>, makes_room_for_numbers_in: Option<&str>) -> String {
        // Every code of new ids is well formed, and every edit readable, or none is.
        let codes = std::iter::once(context.code)
            .chain(befores.iter().map(|b| b.new_id_code.as_str()))
            .chain(along.iter().map(|a| a.new_id_code.as_str()));
        if !codes.into_iter().all(is_code_of_new_ids) {
            return refused(Refusal::UnreadableRequest);
        }
        let Some(edit) = edits::read(edit) else { return refused(Refusal::UnreadableRequest) };
        let Some(befores) = befores
            .into_iter()
            .map(|b| Some((edits::read(b.edit)?, b.is_pointed_at, b.new_id_code)))
            .collect::<Option<Vec<_>>>()
        else {
            return refused(Refusal::UnreadableRequest);
        };
        let Some(along) =
            along.into_iter().map(|a| Some((edits::read(a.edit)?, a.new_id_code))).collect::<Option<Vec<_>>>()
        else {
            return refused(Refusal::UnreadableRequest);
        };
        if self.stop.is_some() {
            return refused("syncStopped");
        }
        if self.is_op_id_in_use(&op_id) {
            return refused("opIdInUse");
        }
        let all = || befores.iter().map(|b| &b.0).chain(std::iter::once(&edit)).chain(along.iter().map(|a| &a.0));
        // A sort works out what waits for `calculate` first, whatever comes of it; the values that changed are told
        // with the next state the page is given.
        if all().any(edits::calculates_first) {
            self.is_calculation_due = false;
            let mut report = std::mem::take(&mut self.report);
            self.settle_formulas();
            std::mem::swap(&mut self.report, &mut report);
            self.report.touched |= report.touched;
            self.untold_changes.extend(report.changes);
        }
        // An edit measuring what cells show works out the formulas waiting for `calculate` first, and tells of them
        // with the next state the page is given (this answer's, or when it is refused or changes nothing, the next).
        if all().any(edits::Edit::measures_values) && self.is_calculation_due {
            self.is_calculation_due = false;
            for (sheet_id, r, c) in self.values_changed() {
                self.untold_changes.cell(&sheet_id, &r, &c);
            }
        }
        // Rows, columns or sheets moved (by a move or a sort) are made alone: among other edits, refused.
        let is_among_several = !befores.is_empty() || !along.is_empty();
        let moves_among_several =
            |made: &edits::Made| is_among_several && made.ops.iter().any(|op| matches!(op, Op::MoveRows { .. } | Op::ReorderRows { .. } | Op::MoveColumns { .. } | Op::MoveSheets { .. }));
        let (start, was_due) = (self.workbook.clone(), self.is_calculation_due);
        let mut made_units: Vec<Unit> = Vec::new();
        // Which edit each unit made is (`history::Role`), by its index among the edits made.
        let mut roles: Vec<history::Role> = Vec::new();
        // Where the formulas were last worked out among the edits made (none: before them).
        let mut worked_out: Option<(Workbook, usize)> = None;

        // The edits made before it, each on the workbook the ones before it leave: one refused, none is made.
        let (mut places_before, mut place_of_befores, mut any_pointed) = (Vec::new(), place::Place::Nowhere, false);
        for (index, (before, is_pointed_at, code)) in befores.into_iter().enumerate() {
            let limits = before.limits();
            let follow_up = before.follow_up(&code);
            self.work_out_between(&before, &made_units, &start, &mut worked_out);
            let refusal = match edits::make(&self.workbook, before, &edits::Context { code: &code, ..*context }) {
                Ok(made) if made.ops.is_empty() => continue,
                Ok(made) if moves_among_several(&made) => json!("moveAmongSeveralEdits"),
                Ok(made) => match self.apply_unit(made, limits, follow_up) {
                    Ok(unit) => {
                        // Only an edit before made counts as pointed at.
                        any_pointed |= is_pointed_at;
                        if is_pointed_at {
                            places_before.push(place::Told::of(&unit.place, &self.workbook));
                        }
                        place_of_befores = place_of_befores.and(unit.place.clone());
                        roles.push(history::Role::Before { index: made_units.len(), is_pointed_at });
                        made_units.push(unit);
                        continue;
                    }
                    Err(refusal) => refusal,
                },
                Err(edits::Refused::Answer(answer)) => {
                    self.take_back(start, was_due, worked_out.is_some(), made_units);
                    return answer.to_string();
                }
                Err(refused) => refusal_of(refused),
            };
            self.take_back(start, was_due, worked_out.is_some(), made_units);
            return json!({"kind": "editBeforeRefused", "index": index, "refusal": refusal}).to_string();
        }

        let told_befores = place::Told::of(&place_of_befores, &self.workbook);

        // The edit itself.
        let redrawn = edits::refusals_that_redraw(&edit);
        let limits = edit.limits();
        let follow_up = edit.follow_up(context.code);
        self.work_out_between(&edit, &made_units, &start, &mut worked_out);
        let made = match edits::make(&self.workbook, edit, context) {
            Ok(made) if moves_among_several(&made) => {
                self.take_back(start, was_due, worked_out.is_some(), made_units);
                return refused("moveAmongSeveralEdits");
            }
            Ok(made) => made,
            Err(refusal) => {
                self.take_back(start, was_due, worked_out.is_some(), made_units);
                return self.refused_edit(refusal, redrawn);
            }
        };
        let mut place_changed = None;
        let others = made_units.len();
        if !made.ops.is_empty() {
            let room = makes_room_for_numbers_in.map(|sheet_id| (sheet_id, numbers_given_patterns(&self.workbook, &made.ops, sheet_id), self.workbook.clone()));
            match self.apply_unit(made, limits, follow_up).and_then(|unit| match room {
                Some((sheet_id, given, before)) => self.make_room_for_numbers(unit, &before, sheet_id, &given),
                None => Ok(unit),
            }) {
                Ok(units) => {
                    place_changed = Some(place::Told::of(&units.place, &self.workbook));
                    roles.push(history::Role::Asked);
                    made_units.push(units);
                }
                Err(refusal) => {
                    self.take_back(start, was_due, worked_out.is_some(), made_units);
                    return refused(refusal);
                }
            }
        }
        if made_units.is_empty() {
            return json!({"kind": "nothingToChange"}).to_string();
        }
        let place_changed = place_changed.unwrap_or(if any_pointed { place::Told::nowhere() } else { told_befores });

        // The edits that go along with it, each made if it can be and left out if not.
        let mut went_along = Vec::with_capacity(along.len());
        for (edit, code) in along {
            let limits = edit.limits();
            let follow_up = edit.follow_up(&code);
            self.work_out_between(&edit, &made_units, &start, &mut worked_out);
            let refusal = match edits::make(&self.workbook, edit, &edits::Context { code: &code, ..*context }) {
                Ok(made) if made.ops.is_empty() => {
                    went_along.push(WentAlong::NothingToChange);
                    continue;
                }
                Ok(made) if moves_among_several(&made) => json!("moveAmongSeveralEdits"),
                Ok(made) => match self.apply_unit(made, limits, follow_up) {
                    Ok(unit) => {
                        went_along.push(WentAlong::Made(place::Told::of(&unit.place, &self.workbook)));
                        roles.push(history::Role::Along(made_units.len()));
                        made_units.push(unit);
                        continue;
                    }
                    Err(refusal) => refusal,
                },
                Err(refused) => refusal_of(refused),
            };
            went_along.push(WentAlong::LeftOut(refusal));
        }

        // Every part of every edit made, as one step, each with the edit it is of.
        let part_roles: Vec<history::Role> = made_units
            .iter()
            .zip(&roles)
            .flat_map(|(u, &role)| {
                std::iter::repeat_n(role, u.parts.len() - u.room).chain(std::iter::repeat_n(history::Role::Room, u.room))
            })
            .collect();
        let parts: Vec<(Vec<Op>, Vec<Op>, bool)> = made_units.iter_mut().flat_map(|u| std::mem::take(&mut u.parts)).collect();
        let several = parts.len() > 1;
        self.workbook.revision += parts.len() as u64;
        // A step of the edit alone tells its place as its operations change it when taken back; one of several edits
        // tells each edit's (`history::Role`).
        let is_alone = others == 0
            && made_units.len() == 1
            && made_units[0].room == 0
            && went_along.iter().all(|w| !matches!(w, WentAlong::Made(_)));
        let roles = (!is_alone).then_some(part_roles);
        let is_one_action = parts.iter().any(|p| p.2);
        let mut step =
            history::Step { parts: Vec::with_capacity(parts.len()), name: op_id.clone(), roles, is_one_action };
        for (k, (ops, reverse, is_split)) in parts.into_iter().enumerate() {
            let id = if several { format!("{op_id}.{k}") } else { op_id.clone() };
            step.parts.push(history::Part { op_id: id.clone(), ops: ops.clone(), reverse: Some(reverse.clone()) });
            self.queue.push(Queued {
                op_id: id,
                group_id: several.then(|| op_id.clone()),
                // Parts of one edit too large to send whole are one action; the edits of a step are not.
                action_id: is_split.then(|| op_id.clone()),
                recorded: Recorded { v: version::of_ops(&ops), base: self.confirmed_revision, ops },
                acknowledged: None,
                reverse: Some(reverse),
                is_handed_out: false,
            });
        }
        self.steps.made(step);
        // What is left to note is what the edits did since the formulas were last worked out.
        let (from, worked_out_after) = match &worked_out {
            Some((workbook, units)) => (workbook, made_units[..*units].iter().map(|u| u.ops.len()).sum()),
            None => (&start, 0),
        };
        self.report.works_out_pivot |= made_units.iter().any(|unit| unit.works_out_pivot);
        let ops: Vec<Op> = made_units.into_iter().flat_map(|u| u.ops).collect();
        for op in &ops {
            self.report.changes.of_op(op, &self.workbook);
        }
        self.applied(&from, &ops[worked_out_after..]);
        // The answer's keys in this order.
        let mut answer = format!("{{\"kind\":\"editQueued\",\"placeChanged\":{}", place_changed.to_json(&self.workbook));
        // A place on a sheet gone by the end (an edit after deleted it) is left out.
        let shown_before: Vec<Json> =
            places_before.iter().filter(|p| p.is_shown(&self.workbook)).map(|p| p.to_json(&self.workbook)).collect();
        if !shown_before.is_empty() {
            answer += &format!(",\"placesChangedBefore\":{}", Json::from(shown_before));
        }
        if !went_along.is_empty() {
            let went: Vec<Json> = went_along
                .iter()
                .map(|w| match w {
                    WentAlong::Made(place) => json!({"kind": "made", "placeChanged": place.to_json(&self.workbook)}),
                    WentAlong::NothingToChange => json!({"kind": "nothingToChange"}),
                    WentAlong::LeftOut(refusal) => json!({"kind": "leftOut", "refusal": refusal}),
                })
                .collect();
            answer += &format!(",\"editsThatWentAlong\":{}", Json::from(went));
        }
        let state = self.sync_state_text(None);
        format!("{answer},\"syncState\":{state}}}")
    }

    /// The answer to an edit refused, with what the refusal leaves to tell.
    fn refused_edit(&mut self, refusal: edits::Refused, redrawn: &[&str]) -> String {
        match refusal {
            edits::Refused::Unreadable => refused(Refusal::UnreadableRequest),
            edits::Refused::Because(why) => {
                if redrawn.contains(&why) {
                    // What is calculated from is rebuilt, working out every formula (whether or not the page
                    // asked to be answered before calculating).
                    self.is_calculation_due = false;
                    self.calculate_now();
                    self.told = formula_values(&self.workbook);
                    self.untold_changes.everything();
                }
                refused(why)
            }
            edits::Refused::Answer(answer) => answer.to_string(),
            edits::Refused::Tried(why, ops) => {
                // Taking back rows or columns the edit inserted changes the workbook's shape: every formula is worked
                // out again at once, those waiting for `calculate` among them.
                if reshapes(&ops) && self.is_calculation_due {
                    self.is_calculation_due = false;
                    for (sheet_id, r, c) in self.values_changed() {
                        self.untold_changes.cell(&sheet_id, &r, &c);
                    }
                }
                self.untold.extend(ops);
                refused(why)
            }
        }
    }

    /// Before an edit measuring what cells show (or sorting by their values) that comes after other edits of the same
    /// request: the formulas those edits leave waiting are worked out first, as they would be worked out when each edit
    /// is made, and the cells whose values changed are told with this answer.
    fn work_out_between(&mut self, edit: &edits::Edit, made_units: &[Unit], start: &Workbook,
        worked_out: &mut Option<(Workbook, usize)>) {
        let from = worked_out.as_ref().map_or(0, |w| w.1);
        if made_units.len() == from || !(edit.measures_values() || edits::calculates_first(edit)) {
            return;
        }
        let ops: Vec<Op> = made_units[from..].iter().flat_map(|u| u.ops.iter().cloned()).collect();
        let before = worked_out.as_ref().map_or(start, |w| &w.0).clone();
        self.applied(&before, &ops);
        if self.report.touched || self.is_calculation_due {
            self.is_calculation_due = false;
            self.report.touched = false;
            for (sheet_id, r, c) in self.values_changed() {
                self.report.changes.cell(&sheet_id, &r, &c);
            }
        }
        *worked_out = Some((self.workbook.clone(), made_units.len()));
    }

    /// Takes back the edits made before one refused: the workbook is as it was, and what they touched is told with
    /// the next changes all the same (as if they had been applied and taken back). Formulas worked out
    /// between the edits are worked out again on it, no longer waiting for `calculate` (their values stay as
    /// worked out); else they wait as they did.
    fn take_back(&mut self, start: Workbook, was_due: bool, is_worked_out: bool, made_units: Vec<Unit>) {
        self.workbook = start;
        self.is_calculation_due = was_due && !is_worked_out;
        if !made_units.is_empty() {
            self.calculate_now();
        }
        for unit in made_units {
            self.untold.extend(unit.ops);
        }
    }

    /// Applies an edit made, and what it adds once made as a part of its own, to the workbook shown. Refused, the
    /// workbook is left as it was.
    fn apply_unit(&mut self, made: edits::Made, limits: edits::EditLimits, follow_up: Option<edits::FollowUp>)
        -> Result<Unit, Json> {
        if !new_ids::are_well_formed(&made.ops) {
            return Err(json!("idNotWellFormed"));
        }
        let before = self.workbook.clone();
        let reverse = match self.workbook.apply_in_place(&made.ops) {
            Ok(reverse) => reverse,
            Err(refusal) => {
                self.workbook = before;
                return Err(json!(refusal));
            }
        };
        // An edit that leaves the workbook holding more cells than it did, and more than the most it may hold, is
        // refused. The cells of deleted sheets, rows and columns count (they are kept to be undeleted); cleared ones
        // do not.
        if limits.check_cell_count {
            let held = cells_kept(&self.workbook);
            if held > MOST_CELLS && held > cells_kept(&before) {
                self.workbook = before;
                return Err(json!("tooManyCells"));
            }
        }
        let split = if limits.send_whole {
            Ok(vec![(made.ops.clone(), reverse, false)])
        } else {
            parts_to_send(&before, &made.ops, reverse)
        };
        let mut parts = match split {
            Ok(parts) => parts,
            Err(refusal) => {
                self.workbook = before;
                return Err(refusal);
            }
        };
        let place = made.place.unwrap_or_else(|| place::of_ops(&before, &self.workbook, &made.ops));
        let mut ops = made.ops;
        let works_out_pivot = matches!(follow_up, Some(edits::FollowUp::Pivot(_)));
        if let Some(follow_up) = follow_up {
            let more = edits::follow_up_ops(&self.workbook, follow_up);
            if !more.is_empty() {
                let shown = self.workbook.clone();
                let sent = self.workbook.apply_in_place(&more).map_err(|r| json!(r));
                match sent.and_then(|reverse| parts_to_send(&shown, &more, reverse)) {
                    Ok(more_parts) => parts.extend(more_parts),
                    Err(refusal) => {
                        self.workbook = before;
                        return Err(refusal);
                    }
                }
                ops.extend(more);
            }
        }
        Ok(Unit { ops, parts, place, works_out_pivot, room: 0 })
    }

    /// The columns of the cells given a number format made wider to show their numbers (`makesRoomForNumbersIn`):
    /// the widths set after the edit, in a part of their own.
    fn make_room_for_numbers(&mut self, mut unit: Unit, before: &Workbook, sheet_id: &str,
        given: &[(HashSet<LineId>, HashSet<LineId>)]) -> Result<Unit, Json> {
        if given.is_empty() {
            return Ok(unit);
        }
        let is_given = |(r, c): (LineId, LineId)| given.iter().any(|(rows, columns)| rows.contains(&r) && columns.contains(&c));
        let widths = edits::lines::fit::widths_making_room_for_numbers(before, &self.workbook, sheet_id, is_given);
        if widths.is_empty() {
            return Ok(unit);
        }
        // Next columns of one base given the same width go in one run.
        let mut runs: Vec<(LineId, u32, u32)> = Vec::new();
        for (column, width) in widths {
            match runs.last_mut() {
                Some((first, count, w)) if *w == width && first.base == column.base && first.n + *count == column.n => *count += 1,
                _ => runs.push((column, 1, width)),
            }
        }
        let widths = runs
            .into_iter()
            .map(|(first, count, width)| {
                json!({"columns": {"base": self.workbook.bases.name(first.base), "first": first.n, "count": count}, "widthInPixels": width})
            })
            .collect::<Vec<_>>();
        let op: Op = serde_json::from_value(json!({"kind": "setColumnWidths", "sheetId": sheet_id, "widths": widths}))
            .expect("widths read");
        let shown = self.workbook.clone();
        let more = vec![op];
        let reverse = self.workbook.apply_in_place(&more).map_err(|r| json!(r))?;
        let parts = parts_to_send(&shown, &more, reverse)?;
        unit.room += parts.len();
        unit.parts.extend(parts);
        unit.ops.extend(more);
        Ok(unit)
    }

    fn receive_send_outcome(&mut self, op_id: &str, outcome: Outcome) {
        let Some(head) = self.queue.iter().position(|q| q.acknowledged.is_none()) else { return };
        if self.queue[head].op_id != op_id || !self.queue[head].is_handed_out {
            return;
        }
        match outcome {
            Outcome::Refused => {
                let dropped = self.queue.remove(head);
                let op_id = dropped.op_id.clone();
                self.take_out(dropped);
                self.report.dropped.push(op_id);
                self.steps.clear();
            }
            Outcome::Saved { revision } if revision > self.confirmed_revision => {
                self.queue[head].acknowledged = Some(revision);
                // Saved undeleting what the load forgot: the workbook is loaded again.
                if self.forgets(&self.queue[head].recorded.ops) {
                    self.loading.get_or_insert_with(Loading::default).is_needed = true;
                }
                self.confirm_acknowledged();
            }
            Outcome::Saved { .. } => {
                // Already confirmed: it came back as another's edit (how to take it back is not known).
                let edit = self.queue.remove(head);
                self.steps.reverse_now(&edit.op_id, None);
                self.report.confirmed.push(edit.op_id.clone());
                self.take_out(edit);
            }
        }
    }

    /// The workbook shown without an edit taken out of the queue: as it is, when the edit did not apply to it.
    fn take_out(&mut self, edit: Queued) {
        if edit.reverse.is_some() {
            self.rebuild(&[], Some(&edit));
        }
    }

    /// The first queued edit is confirmed at the revision after the confirmed one: by the server's stream of that
    /// revision, when it is what the revision holds, or by its outcome alone, the edit as recorded. An edit that no
    /// longer applies (another's edit before it took away what it changes) is not confirmed by its outcome alone: it
    /// waits for the stream. Streamed back as it was made, it is confirmed, refused by the workbook, and the workbook
    /// loaded again.
    fn confirm_head(&mut self, streamed: Option<Applied>) -> bool {
        let revision = self.confirmed_revision + 1;
        let is_streamed = streamed.is_some();
        // Streamed in a version the session does not know: it stops, the edit unconfirmed.
        if streamed.as_ref().is_some_and(|applied| !version::is_known(applied.v) && applied.v >= version::OLDEST) {
            self.stop = Some("unknownFormatVersion");
            return false;
        }
        let ops = streamed.and_then(|applied| self.streamed_ops(&applied));
        // Undeleting what the load forgot: not confirmed, the workbook is loaded again.
        if self.forgets(ops.as_deref().unwrap_or(&self.queue[0].recorded.ops)) {
            self.loading.get_or_insert_with(Loading::default).is_needed = true;
            return false;
        }
        // Not made on the workbook shown (it undid what the load forgot, with others): confirmed by its stream alone,
        // and shown then.
        let is_made = self.queue[0].reverse.is_some();
        if !is_streamed && !is_made {
            return false;
        }
        if let Some(ops) = ops.filter(|ops| !same_ops(ops, &self.queue[0].recorded.ops)) {
            if let Ok(reverse) = self.confirmed.apply(&ops) {
                // Not the edit as the page made it: the workbook shown is the server's, and the edits after it.
                let edit = self.queue.remove(0);
                self.steps.reverse_now(&edit.op_id, Some(&reverse));
                self.confirmed_revision = revision;
                self.confirmed.revision = revision;
                self.report.confirmed.push(edit.op_id);
                self.rebuild(&ops, None);
                return true;
            }
        }
        let Ok(reverse) = self.confirmed.apply(&self.queue[0].recorded.ops) else {
            if !is_streamed {
                return false;
            }
            let edit = self.queue.remove(0);
            self.steps.reverse_now(&edit.op_id, None);
            self.report.confirmed.push(edit.op_id.clone());
            self.take_out(edit);
            self.report.fault = Some("streamedEditRefused");
            self.report.changes.everything();
            self.report.reshaped = true;
            self.loading.get_or_insert_with(Loading::default).is_needed = true;
            return true;
        };
        let edit = self.queue.remove(0);
        self.steps.reverse_now(&edit.op_id, Some(&reverse));
        self.confirmed_revision = revision;
        self.confirmed.revision = revision;
        self.report.confirmed.push(edit.op_id);
        if !is_made {
            let ops = edit.recorded.ops;
            self.rebuild(&ops, None);
        }
        true
    }

    /// Edits the server saved next are confirmed by their outcomes, one after another, without the streams kept
    /// ahead of them: whether any was.
    fn confirm_saved(&mut self) -> bool {
        let mut any = false;
        while self.is_own(self.confirmed_revision + 1) {
            if !self.confirm_head(None) {
                break;
            }
            any = true;
        }
        any
    }

    /// Caught up by the page's own edits: the workbook is as the server has it, loaded.
    fn check_caught_up(&mut self) {
        if self.newest_revision <= self.confirmed_revision && !self.loading.as_ref().is_some_and(|l| l.is_needed) {
            if self.loading.take().is_some() {
                self.is_loaded = true;
            }
        }
    }

    fn confirm_acknowledged(&mut self) {
        self.confirm_saved();
        self.check_caught_up();
    }

    /// A place as the page shows it: none in a sheet the page's own edits deleted.
    fn as_shown(&self, place: Json) -> Json {
        let shown = place.get("sheetId").and_then(Json::as_str).is_none_or(|id| self.workbook.sheet_index(id).is_some());
        if shown { place } else { Json::Null }
    }

    /// Whether the server saved the page's next edit to confirm at a revision.
    fn is_own(&self, revision: u64) -> bool {
        self.queue.first().is_some_and(|q| q.acknowledged == Some(revision))
    }

    /// Whether operations undelete what a load forgot.
    fn forgets(&self, ops: &[Op]) -> bool {
        ops.iter().any(|op| self.forgotten.is_undeleted_by(op))
    }

    fn receive_streamed_edit(&mut self, revision: u64, applied: Applied) {
        self.hear_of(revision);
        if revision <= self.confirmed_revision {
            return;
        }
        // Ahead, or the page's own edit, saved there, waiting for it.
        if revision > self.confirmed_revision + 1 || self.is_own(revision) {
            self.ahead.entry(revision).or_insert(applied);
            return;
        }
        self.apply_streamed(revision, applied);
    }

    /// Streams kept ahead are taken in revision order once the confirmed revision is the one before them: another's
    /// edit applies, the page's own confirms it. When none is next, the edits saved next are confirmed by their
    /// outcomes, and the streams kept ahead of them are not looked at (they are past); then the streams after.
    fn catch_up(&mut self) {
        let mut progressed = false;
        loop {
            while self.stop.is_none() && self.report.fault.is_none() {
                let next = self.confirmed_revision + 1;
                self.ahead = self.ahead.split_off(&next);
                let Some(applied) = self.ahead.remove(&next) else { break };
                if self.is_own(next) {
                    if !self.confirm_head(Some(applied)) {
                        break;
                    }
                } else {
                    self.apply_streamed(next, applied);
                }
                progressed = true;
            }
            if self.stop.is_some() || !self.confirm_saved() {
                break;
            }
            progressed = true;
            if self.stop.is_some() || self.report.fault.is_some() {
                break;
            }
        }
        self.ahead = self.ahead.split_off(&(self.confirmed_revision + 1));
        if progressed {
            self.check_caught_up();
        }
    }

    /// Another's edit at the revision after the confirmed one.
    /// The operations of another's edit, when the session reads them: a version it does not know stops it, and
    /// operations it cannot read are a fault that loads the workbook again.
    fn streamed_ops(&mut self, applied: &Applied) -> Option<Vec<Op>> {
        if !version::is_known(applied.v) && applied.v >= version::OLDEST {
            self.stop = Some("unknownFormatVersion");
            return None;
        }
        let ops = read_ops(&applied.ops)
            .filter(|ops| !ops.is_empty() && applied.v >= version::OLDEST && version::of_wire_ops(ops, &applied.ops) == applied.v)
            .filter(|ops| ops.iter().all(Op::is_well_formed));
        if ops.is_none() {
            self.report.fault = Some("streamedEditUnreadable");
            self.loading.get_or_insert_with(Loading::default).is_needed = true;
        }
        ops
    }

    fn apply_streamed(&mut self, revision: u64, applied: Applied) {
        let Some(ops) = self.streamed_ops(&applied) else { return };
        // An undelete of what was deleted before the workbook was loaded: loaded again instead, without a fault.
        if self.forgets(&ops) {
            self.loading.get_or_insert_with(Loading::default).is_needed = true;
            return;
        }
        let before = self.confirmed.clone();
        if let Err(refusal) = self.confirmed.apply(&ops) {
            if refusal == Refusal::UnreadableRequest {
                self.report.fault = Some("streamedEditUnreadable");
            } else {
                self.report.fault = Some("streamedEditRefused");
                // Everything shows again, worked out at once.
                self.report.changes.everything();
                self.report.reshaped = true;
            }
            self.loading.get_or_insert_with(Loading::default).is_needed = true;
            return;
        }
        self.confirmed_revision += 1;
        self.confirmed.revision = self.confirmed_revision;
        let place = if let [op @ (Op::InsertRows { .. } | Op::InsertColumns { .. })] = ops.as_slice() {
            // Resolve the whole rows or columns against the workbook shown after buffered edits have applied.
            OthersPlace::Insertion(op.clone())
        } else {
            let place = place::of_ops(&before, &self.confirmed, &ops);
            // Deletions are reported by position. Other edits here are reported by the cells they changed.
            let deletes_lines = ops.iter().any(|op| matches!(op, Op::DeleteRows { .. } | Op::DeleteColumns { .. }));
            if deletes_lines { OthersPlace::Later(place) } else { OthersPlace::Now(place.to_json(&self.confirmed)) }
        };
        let (touched, retold, changed) = touches_formulas(&before, &self.confirmed, &ops);
        self.report.touched |= touched;
        self.forget_told(retold);
        self.retext_unread(&ops);
        self.cells_changed(changed);
        let (reshaped, touched) = shape_change(&before, &self.confirmed, &ops);
        self.report.reshaped |= reshaped;
        self.report.touched |= !touched.is_empty();
        if !reshaped && !touched.is_empty() {
            self.report.texts_to_check.extend(texts_moved(&self.confirmed, &ops));
        }
        self.anything_changed(!touched.is_empty());
        if self.queue.is_empty() {
            let mut shown = self.confirmed.clone();
            carry_outcomes(&self.workbook, &mut shown);
            self.workbook = shown;
            for op in &ops {
                self.report.changes.of_op(op, &self.workbook);
            }
        } else {
            self.rebuild(&ops, None);
        }
        self.report.others.push((revision, place));
        self.check_caught_up();
    }

    fn start_load_page(&mut self, from: u64, revision: u64) -> Option<&mut Loading> {
        self.hear_of(revision);
        let loading = self.loading.as_mut()?;
        if from != loading.from {
            return None;
        }
        if loading.revision.is_some_and(|r| r != revision) {
            // The workbook changed between pages: start over.
            *loading = Loading { is_repeat: true, is_needed: loading.is_needed, ..Loading::default() };
            return None;
        }
        Some(loading)
    }

    fn receive_load_page(&mut self, from: u64, revision: u64, v: u32, ops: &[Json], next: Option<u64>) {
        let Some(loading) = self.start_load_page(from, revision) else { return };
        if loading.snapshot.is_some() {
            self.stop = Some("unreadableLoad");
            return;
        }
        if v < version::OLDEST {
            self.stop = Some("formatVersionNoLongerTaken");
            return;
        }
        if !version::is_known(v) {
            self.stop = Some("unknownFormatVersion");
            return;
        }
        let Some(ops) = read_ops(ops) else {
            self.stop = Some("unreadableLoad");
            return;
        };
        loading.revision = Some(revision);
        loading.is_repeat = false;
        loading.ops.extend(ops);
        if let Some(next) = next {
            loading.from = next;
            return;
        }
        let loading = self.loading.take().expect("loading");
        let mut loaded = Workbook::default();
        if loaded.apply(&loading.ops).is_err() {
            self.stop = Some("unreadableLoad");
            return;
        }
        self.finish_load(revision, loaded, Forgotten::of(&loading.ops));
    }

    fn receive_lines_of_load(&mut self, from: u64, revision: u64, lines: &str, next: Option<u64>) {
        let Some(loading) = self.start_load_page(from, revision) else { return };
        if !loading.ops.is_empty() {
            self.stop = Some("unreadableLoad");
            return;
        }
        let snapshot = loading.snapshot.get_or_insert_with(snapshot::Snapshot::new);
        if snapshot.append(lines, next.is_none()).is_none() {
            self.stop = Some("unreadableLoad");
            return;
        }
        loading.revision = Some(revision);
        loading.is_repeat = false;
        if let Some(next) = next {
            loading.from = next;
            return;
        }
        let Some(loaded) = self.loading.take().and_then(|loading| loading.snapshot?.finish()) else {
            self.stop = Some("unreadableLoad");
            return;
        };
        let forgotten = Forgotten::from_snapshot(&loaded);
        self.finish_load(revision, loaded, forgotten);
    }

    fn finish_load(&mut self, revision: u64, mut loaded: Workbook, forgotten: Forgotten) {
        self.newest_revision = self.newest_revision.max(revision);
        loaded.revision = revision;
        self.forgotten = forgotten;
        self.confirmed = loaded;
        self.confirmed_revision = revision;
        // The page's edits the server saved by this revision are in it.
        let mut kept = Vec::new();
        for edit in std::mem::take(&mut self.queue) {
            match edit.acknowledged {
                Some(at) if at <= revision => {
                    self.steps.reverse_now(&edit.op_id, edit.reverse.as_ref());
                    self.report.confirmed.push(edit.op_id);
                }
                _ => kept.push(edit),
            }
        }
        self.queue = kept;
        self.rebuild(&[], None);
        self.report.changes.everything();
        self.report.reshaped = true;
        self.confirm_acknowledged();
        // Others' edits that came while it loaded, on top. A load older than the server has told of, after them, is
        // repeated before the workbook counts as loaded.
        self.catch_up();
        let is_stale = self.newest_revision > self.confirmed_revision;
        self.is_loaded |= !is_stale;
        if is_stale {
            self.loading.get_or_insert_with(Loading::default).is_repeat = true;
        }
    }

    /// Cells set to another formula: what they were told is forgotten, so their values are told again once worked out.
    /// Notes the cells operations changed, whose formulas (or those that read them) wait to be worked out.
    fn cells_changed(&mut self, changed: Changed) {
        if let Some(cells) = &mut self.changed {
            cells.read.extend(changed.read);
            cells.formulas.extend(changed.formulas);
            cells.filled.extend(changed.filled);
            cells.arrays_gone.extend(changed.arrays_gone);
        }
    }

    /// Notes, when `so`, that formulas wait to be worked out for something else than cells: only working them out
    /// settles it.
    fn anything_changed(&mut self, so: bool) {
        if so {
            self.changed = None;
        }
    }

    fn forget_told(&mut self, cells: Vec<(String, String, String)>) {
        if self.told.is_empty() {
            return;
        }
        for key in cells {
            // But a cell an array filled, given a value of its own: told again once worked out.
            if self.told.get(&key).is_some_and(|told| told.spilled) && holds_own_value(&self.workbook, &key) {
                continue;
            }
            self.told.remove(&key);
        }
    }

    /// The text of the formula in a cell when it does not read (as a formula, `=Nope!A1` or `=IF(A1;2)`, say).
    fn unread_formula_text(&self, (sheet_id, r, c): &(String, String, String)) -> Option<String> {
        let wb = &self.workbook;
        let i = wb.sheet_index(sheet_id)?;
        let cell = wb.sheets[i].cells.get(&(wb.bases.parse(r)?, wb.bases.parse(c)?))?;
        let crate::workbook::Input::Formula { formula } = &cell.input else { return None };
        cell.parsed.as_ref().filter(|parsed| parsed.is_err())?;
        Some(wb.formula_text(i, formula))
    }

    /// Cells set from a formula that does not read to another (`=Nope!A1` to `=Nope!A3`, say) keep what they come
    /// to, and the page, told of them at the edit, is told of them again only when that changes: what it was told of
    /// them takes their new text.
    fn retext_unread(&mut self, ops: &[Op]) {
        if self.told.is_empty() {
            return;
        }
        for op in ops {
            let Op::SetCells { sheet_id, cells, .. } = op else { continue };
            for cell in cells {
                let key = (sheet_id.clone(), cell.r.clone(), cell.c.clone());
                if let Some(text) = self.unread_formula_text(&key) {
                    if let Some(told) = self.told.get_mut(&key).filter(|told| !told.spilled) {
                        told.formula_text = Some(text);
                    }
                }
            }
        }
    }

    /// An edit taken out of the workbook shown: what it changed changes back.
    fn undone(&mut self, edit: &Queued) {
        if let Some(reverse) = &edit.reverse {
            for op in reverse {
                self.report.changes.of_op(op, &self.workbook);
            }
            let (touched, retold, changed) = touches_formulas(&self.workbook, &self.workbook, reverse);
            self.report.touched |= touched;
            self.forget_told(retold);
            self.retext_unread(reverse);
            self.cells_changed(changed);
            self.report.reshaped |= reshapes(reverse);
        }
    }

    /// Notes what operations applied to the workbook shown leave to work out.
    fn applied(&mut self, before: &Workbook, ops: &[Op]) {
        // A pending formula can already be visible in the formula bar before its
        // first value exists. Moving its references must redraw that text too.
        if self.answer_before_calculating && reshapes(ops) {
            for (index, sheet) in before.sheets.iter().enumerate() {
                let Some(next) = self.workbook.sheet_index(&sheet.id) else { continue };
                let after = &self.workbook.sheets[next];
                for (&(r, c), cell) in &sheet.cells {
                    let crate::workbook::Input::Formula { formula } = &cell.input else { continue };
                    if !after.rows.contains(r) || !after.columns.contains(c) || before.outcome(&sheet.id, r, c).is_some() {
                        continue;
                    }
                    if after.cells.get(&(r, c)).is_some_and(|now| now.input == cell.input)
                        && before.formula_text(index, formula) != self.workbook.formula_text(next, formula) {
                        self.report.changes.cell(&sheet.id, &before.bases.text(r), &before.bases.text(c));
                    }
                }
            }
        }
        // An array worked out whose formula is taken out: the cells the page was told it fills are told with the edit,
        // emptied before the formulas are worked out (when the page was told of any cell an array fills).
        let told_filled = self.told.values().any(|told| told.spilled);
        for op in ops.iter().filter(|_| told_filled) {
            let Op::SetCells { sheet_id, cells, .. } = op else { continue };
            for cell in cells {
                let old = before.sheet_index(sheet_id).and_then(|i| {
                    before.sheets[i].cells.get(&(before.bases.parse(&cell.r)?, before.bases.parse(&cell.c)?))
                });
                if let Some(crate::workbook::Input::Formula { formula }) = &cell.input {
                    if is_same_formula(before, old, &self.workbook, formula) {
                        continue;
                    }
                }
                for key in cells_filled_from(before, sheet_id, &cell.r, &cell.c) {
                    if self.told.get(&key).is_some_and(|told| told.spilled) {
                        self.report.changes.cell(&key.0, &key.1, &key.2);
                        self.told.remove(&key);
                    }
                }
            }
        }
        keep_outcomes(before, &mut self.workbook, ops);
        let (touched, retold, changed) = touches_formulas(before, &self.workbook, ops);
        self.report.touched |= touched;
        self.forget_told(retold);
        self.retext_unread(ops);
        self.cells_changed(changed);
        // Cells the edit set to no formula were told of with it: nothing of theirs waits to be told again.
        let told = !self.told.is_empty();
        for op in ops.iter().filter(|_| told) {
            if let Op::SetCells { sheet_id, cells, .. } = op {
                let cells = cells.iter().filter(|c| !matches!(c.input, Some(crate::workbook::Input::Formula { .. })));
                self.forget_told(cells.map(|cell| (sheet_id.clone(), cell.r.clone(), cell.c.clone())).collect());
            }
        }
        let (reshaped, touched) = shape_change(before, &self.workbook, ops);
        self.report.reshaped |= reshaped;
        // Formulas reading past rows or columns inserted after every cell wait, until they are worked out or set to
        // something else (and those reading them, as they read a formula waiting).
        self.report.touched |= !touched.is_empty();
        if !reshaped && !touched.is_empty() {
            self.report.texts_to_check.extend(texts_moved(&self.workbook, ops));
        }
        if let Some(changed) = &mut self.changed {
            changed.formulas.extend(touched);
        }
    }

    /// The workbook shown, again: the confirmed one with the page's own edits on top. The edits up to the one being
    /// sent are kept when they no longer apply (the server has them); a later one that no longer applies is dropped.
    fn rebuild(&mut self, others: &[Op], removed: Option<&Queued>) {
        // Formulas that read a renamed sheet are told when its visible name changes across the rebuild.
        let renamed_before = self.report.changes.renamed.clone();
        let names_before: HashMap<String, String> =
            self.workbook.sheets.iter().map(|s| (s.id.clone(), s.name.clone())).collect();
        if let Some(edit) = removed {
            self.undone(edit);
        }
        for edit in &self.queue {
            if let Some(reverse) = &edit.reverse {
                for op in reverse {
                    self.report.changes.of_op(op, &self.workbook);
                }
            }
        }
        let mut workbook = self.confirmed.clone();
        for op in others {
            self.report.changes.of_op(op, &workbook);
        }
        let mut kept = Vec::with_capacity(self.queue.len());
        for mut edit in std::mem::take(&mut self.queue) {
            // Undeleting what the load forgot: kept, not made on the workbook shown.
            if self.forgets(&edit.recorded.ops) {
                edit.reverse = None;
                kept.push(edit);
                continue;
            }
            // An edit that leaves no sheet, or two of one name, no longer applies.
            let was_whole = is_whole(&workbook);
            let applied = workbook.apply(&edit.recorded.ops).and_then(|reverse| {
                if was_whole && !is_whole(&workbook) {
                    let _ = workbook.apply(&reverse);
                    return Err(Refusal::UnknownSheet);
                }
                Ok(reverse)
            });
            match applied {
                Ok(reverse) => {
                    self.report.reshaped |= reshapes(&edit.recorded.ops);
                    for op in &edit.recorded.ops {
                        self.report.changes.of_op(op, &workbook);
                    }
                    edit.reverse = Some(reverse);
                    workbook.revision += 1;
                    kept.push(edit);
                }
                // Sent, it may be saved yet: what the server says of it decides.
                Err(_) if edit.is_handed_out => {
                    edit.reverse = None;
                    workbook.revision += 1;
                    kept.push(edit);
                }
                Err(_) => {
                    self.report.dropped.push(edit.op_id);
                    self.steps.clear();
                }
            }
        }
        workbook.revision = self.confirmed_revision + kept.iter().filter(|q| q.reverse.is_some()).count() as u64;
        self.queue = kept;
        carry_outcomes(&self.workbook, &mut workbook);
        self.workbook = workbook;
        self.workbook.needs_calculation = true;
        let named_as_before = |id: &String| {
            let now = self.workbook.sheets.iter().find(|s| s.id == *id).map(|s| &s.name);
            now.is_some() && now == names_before.get(id)
        };
        let unchanged: Vec<String> =
            self.report.changes.renamed.iter().filter(|id| !renamed_before.contains(*id) && named_as_before(id)).cloned().collect();
        for id in unchanged {
            self.report.changes.renamed.remove(&id);
        }
    }

    /// `NOW()` as the clock reading tells it, when the reading counts for the workbook.
    fn now(&self) -> Option<f64> {
        let (reading, zone) = self.reading.as_ref()?;
        if !crate::time_zone::reading_applies(self.workbook.time_zone.as_deref(), zone.as_deref()) {
            return None;
        }
        crate::time_zone::local_serial(reading.unix_milliseconds, reading.utc_offset_in_minutes)
    }

    fn calculate_now(&mut self) {
        self.changed = Some(Changed::default());
        if self.workbook.needs_calculation {
            let now = self.now();
            calculate(&mut self.workbook, now);
            self.is_changed_directly = false;
        }
    }

    /// Works out the formulas after a change, and tells the page the cells whose values changed. When the page asked
    /// to be answered before calculating and the change left formulas to work out, they wait for `calculate` (the
    /// answer says the calculation is unfinished; what the page was told stays what it was told). A change of shape
    /// works every formula out at once.
    fn settle_formulas(&mut self) {
        // A locale other than the one the page was told of formulas in: every formula reads differently.
        if self.workbook.locale != self.told_locale {
            self.told_locale = self.workbook.locale.clone();
            // Formulas in deleted rows or columns are not there to read.
            let has_formulas = self.workbook.sheets.iter().any(|s| {
                s.cells.iter().any(|(&(r, c), cell)| {
                    matches!(cell.input, crate::workbook::Input::Formula { .. })
                        && s.rows.position(r).is_some()
                        && s.columns.position(c).is_some()
                })
            });
            self.report.touched |= has_formulas;
            self.anything_changed(has_formulas);
        }
        // Before calculating: once no formula is left (the last one cleared, say), or none waits (those set since the
        // last calculation, or reading a cell changed since, cleared), none is left to work out.
        if self.answer_before_calculating && (self.report.touched || self.is_calculation_due) {
            let wait = self.changed.as_ref().is_none_or(|changed| formulas_wait(&self.workbook, changed));
            if !has_live_formulas(&self.workbook) || !wait {
                self.is_calculation_due = false;
                self.report.touched = false;
            }
        }
        if self.report.reshaped || self.report.works_out_pivot {
            self.is_calculation_due = false;
        } else if self.answer_before_calculating && (self.report.touched || self.is_calculation_due) {
            self.is_calculation_due = true;
            self.tell_formula_texts_changed();
            return;
        }
        for (sheet_id, r, c) in &self.values_changed() {
            self.report.changes.cell(sheet_id, r, c);
        }
    }

    /// The formulas whose text rows or columns inserted changed, while formulas wait to be worked out: told now, with
    /// their text (their values when they are worked out).
    fn tell_formula_texts_changed(&mut self) {
        for key in std::mem::take(&mut self.report.texts_to_check) {
            if let Some(told) = self.told.get_mut(&key) {
                let (sheet_id, r, c) = &key;
                let wb = &self.workbook;
                if let (Some(i), Some(r), Some(c)) = (wb.sheet_index(sheet_id), wb.bases.parse(r), wb.bases.parse(c)) {
                    if let Some(crate::workbook::Input::Formula { formula }) = wb.sheets[i].cells.get(&(r, c)).map(|cell| &cell.input) {
                        told.formula_text = Some(wb.formula_text(i, formula));
                    }
                }
            }
            self.report.changes.cell(&key.0, &key.1, &key.2);
        }
    }

    /// Works the formulas out, and the cells whose values changed since the page was last told of them, which it is
    /// now taken to be told of.
    fn values_changed(&mut self) -> Vec<(String, String, String)> {
        self.calculate_now();
        let values = formula_values(&self.workbook);
        let mut changed = Vec::new();
        for (key, value) in &values {
            if self.told.get(key).is_none_or(|before| value.changed_from(before, self.report.reshaped)) {
                changed.push(key.clone());
            }
        }
        // A cell no longer shown worked out: told again, unless a value of its own took the formula's place or it was
        // emptied (setting it told of it). A cell an array no longer fills is told again when it holds nothing or a
        // value of its own.
        let has_value = |(sheet_id, r, c): &(String, String, String), was_filled: bool| -> bool {
            let wb = &self.workbook;
            let (Some(i), Some(r), Some(c)) = (wb.sheet_index(sheet_id), wb.bases.parse(r), wb.bases.parse(c)) else {
                return false;
            };
            let sheet = &wb.sheets[i];
            if sheet.rows.position(r).is_none() || sheet.columns.position(c).is_none() {
                return false;
            }
            match sheet.cells.get(&(r, c)) {
                Some(cell) => !was_filled && !matches!(cell.input, crate::workbook::Input::Formula { .. }),
                None => !was_filled,
            }
        };
        for (key, told) in &self.told {
            if !values.contains_key(key) && !has_value(key, told.spilled) {
                changed.push(key.clone());
            }
        }
        self.told = values;
        changed
    }

    fn sync_state(&mut self) -> String {
        self.sync_state_text(Some("syncState"))
    }

    fn next_step(&self) -> Next {
        if let Some(reason) = self.stop {
            return Next::Json(json!({"kind": "stop", "reason": reason}));
        }
        let fetch = |loading: &Loading| json!({"kind": "fetchLoadPage", "from": loading.from, "isRepeat": loading.is_repeat});
        if let Some(loading) = self.loading.as_ref().filter(|l| l.revision.is_some()) {
            return Next::Json(fetch(loading));
        }
        if let Some(edit) = self.queue.iter().position(|q| q.acknowledged.is_none()) {
            return Next::Send(edit);
        }
        if let Some(loading) = &self.loading {
            return Next::Json(fetch(loading));
        }
        Next::Json(Json::Null)
    }

    /// The next step as written, the edit to send handed out: its operations are written as they are, not copied
    /// into JSON first (a part of a large edit holds a thousand cells).
    fn next_step_text(&mut self) -> String {
        let edit = match self.next_step() {
            Next::Json(step) => return step.to_string(),
            Next::Send(edit) => edit,
        };
        let op_id = self.queue[edit].op_id.clone();
        if let Some(edit) = self.queue.iter_mut().find(|q| q.op_id == op_id) {
            edit.is_handed_out = true;
        }
        let edit = &self.queue[edit];
        let mut step = format!("{{\"kind\":\"sendEdit\",\"opId\":{}", Json::from(op_id.as_str()));
        if let Some(action_id) = &edit.action_id {
            step += &format!(",\"actionId\":{}", Json::from(action_id.as_str()));
        }
        step += ",\"recordedEdit\":";
        step += &serde_json::to_string(&edit.recorded).unwrap_or_default();
        step.push('}');
        step
    }

    /// The sync state as written (with a kind first, when given).
    /// A sheet renamed tells the formulas of other sheets reading it (in rows and columns not deleted), whatever their
    /// text, even those whose reference has lost its cells.
    fn tell_formulas_reading(&mut self) {
        let renamed = std::mem::take(&mut self.report.changes.renamed);
        let deferred_lines = self.is_calculation_due && self.report.changes.lines_changed();
        if renamed.is_empty() && !deferred_lines {
            return;
        }
        let workbook = &self.workbook;
        let mut cells = Vec::new();
        for (i, sheet) in workbook.sheets.iter().enumerate() {
            for (&(r, c), cell) in &sheet.cells {
                let crate::workbook::Input::Formula { formula } = &cell.input else { continue };
                let reads = |id: &String| *id != sheet.id && formula.references.iter().any(|f| f.sheet_id() == id);
                if !sheet.rows.contains(r) || !sheet.columns.contains(c) {
                    continue;
                }
                let key = (sheet.id.clone(), workbook.bases.text(r), workbook.bases.text(c));
                let text = workbook.formula_text(i, formula);
                let text_changed = deferred_lines && self.told.get(&key).and_then(|v| v.formula_text.as_ref()).is_some_and(|old| old != &text);
                if !text_changed && !renamed.iter().any(reads) {
                    continue;
                }
                // Told with their text as it reads now: not told again for it.
                if let Some(told) = self.told.get_mut(&key) {
                    told.formula_text = Some(text);
                }
                cells.push(key);
            }
        }
        for (s, r, c) in cells {
            self.report.changes.cell(&s, &r, &c);
        }
    }

    fn sync_state_text(&mut self, kind: Option<&str>) -> String {
        self.settle_formulas();
        for op in std::mem::take(&mut self.untold) {
            self.report.changes.of_op_taken_back(&op, &self.workbook);
        }
        self.report.changes.extend(std::mem::take(&mut self.untold_changes));
        self.tell_formulas_reading();
        let report = std::mem::take(&mut self.report);
        let mut state = Map::new();
        if let Some(kind) = kind {
            state.insert("kind".into(), json!(kind));
        }
        state.insert("confirmedRevision".into(), json!(self.confirmed_revision));
        state.insert("isLoaded".into(), json!(self.is_loaded));
        state.insert("changes".into(), report.changes.to_json(&self.workbook));
        if self.is_calculation_due {
            state.insert("calculation".into(), json!("unfinished"));
        }
        let head = Json::Object(state).to_string();
        let step = self.next_step_text();
        let mut state = Map::new();
        state.insert("droppedOpIds".into(), json!(report.dropped));
        state.insert("confirmedOpIds".into(), json!(report.confirmed));
        state.insert("unconfirmedCount".into(), json!(self.queue.len()));
        state.insert(
            "unacknowledgedCount".into(),
            json!(self.queue.iter().filter(|q| q.acknowledged.is_none()).count()),
        );
        if let Some(fault) = report.fault {
            state.insert("fault".into(), json!(fault));
        }
        if !report.others.is_empty() {
            let others: Vec<Json> = report
                .others
                .iter()
                .map(|(revision, place)| {
                    let place = match place {
                        OthersPlace::Now(json) => self.as_shown(json.clone()),
                        OthersPlace::Later(place) => self.as_shown(place.to_json(&self.workbook)),
                        OthersPlace::Insertion(op) => {
                            place::of_ops(&self.workbook, &self.workbook, std::slice::from_ref(op)).to_json(&self.workbook)
                        }
                    };
                    json!({"revision": revision, "placeChanged": place})
                })
                .collect();
            state.insert("editsOfOthers".into(), json!(others));
        }
        let tail = Json::Object(state).to_string();
        format!("{},\"nextStep\":{step},{}", &head[..head.len() - 1], &tail[1..])
    }
}
