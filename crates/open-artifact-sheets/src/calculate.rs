//! Working out a workbook's formulas.
//!
//! A calculation works out every formula once, each when it is first needed: a formula that reads another cell
//! works that cell out first. A formula in a cycle of reads is #REF!, as a whole, without being worked out: one
//! that reads its own cell (`=SUM(A1:B2)` in A1), or one that reads a formula that reads it, however far round.
//! The reads are those written in the formula, whether or not they are reached (`=IF(TRUE,1,B1)` with `=A1` in B1),
//! except a reference written directly where a function takes only the place (`=ROWS(A1:B2)` in A1 is 2). A cell
//! an array spills into is read from the formula that spills it. A formula that reads one in a cycle reads #REF!.
//!
//! A formula whose answer is an array (`=TRANSPOSE(A1:A3)`, `={1,2}`) spills it: the array fills the cells right
//! of and below it, which must be empty (else the formula is #SPILL!, `blocked` by the first filled cell), inside
//! the sheet (`endOfSheet`), and not filled already by another formula's array (`earlierFormula`). Other formulas
//! read the spilled cells as if the values were there. Since a cell may be read before the formula that spills
//! into it is worked out, the calculation goes again while the spills it ends with differ from those it began
//! with; each pass works out first the formula that would spill into a cell before reading it.
//!
//! Before any is worked out, each formula that may spill is given the cells its array could fill at most (see
//! `reach`), in order of position: one whose cells meet those of an earlier one is #SPILL! (`earlierFormula`, to
//! as far as it could fill) without being worked out, reads nothing, and still keeps later ones out of its cells.
//! A formula that reads a cell another's array could fill reads that formula (`=UNIQUE(A2:A4)` in A1 reads itself).

use std::collections::BTreeMap;
use std::hash::Hasher;
use std::ops::RangeInclusive;
use std::rc::Rc;

use hashbrown::{HashMap, HashSet};

use crate::brought::Brought;
use crate::evaluate::{Operand, Place};
use crate::formula::{Expr, ParseError, Reference};
use crate::functions::{self, Takes};
use crate::ids::LineId;
use crate::locale::{self, Locale};
use crate::value::{Array, CellError, Value};
use crate::workbook::{Input, Workbook};

mod reach;

use crate::formula::pivot::{Criterion, Formula as PivotFormula, Source as PivotSource};
use crate::session::reads::pivot as pivot_read;

/// What a formula worked out.
#[derive(Clone, Debug, PartialEq)]
pub struct Outcome {
    /// Its cell's value: the first of a spilled array, #SPILL! when blocked.
    pub value: Value,
    pub spill: Option<SpillOutcome>,
    /// The number format it brings from what it reads, when its value is a number.
    pub brought: Option<Brought>,
    /// The link its value is shown as (`HYPERLINK`'s), when its value is no error.
    pub links_to: Option<Rc<str>>,
    /// For a formula in a cycle, the first formula of that cycle it reads (in the order it reads them): the page is
    /// told its #REF! again when that changes, as when the formula it read first leaves the cycle.
    pub cycle_entry: Option<CellKey>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum SpillOutcome {
    /// The array fills its cells, to `to` (row and column positions); `formats`: what each of its values brings
    /// (row by row), when its function picked them from cells.
    Fills { array: Rc<Array>, to: (usize, usize), formats: Option<SpillFormats> },
    /// The array cannot spill; it would fill to `would_fill_to` (inside the sheet).
    Blocked { by: BlockedBy, would_fill_to: (usize, usize) },
}

/// Number formats can occupy the same sparse positions as the values they display.
#[derive(Clone, Debug, PartialEq)]
pub enum SpillFormats {
    Dense(Rc<[Option<Brought>]>),
    Sparse(Rc<BTreeMap<(usize, usize), Brought>>),
}

impl SpillFormats {
    pub(crate) fn get(&self, columns: usize, position: (usize, usize)) -> Option<&Brought> {
        match self {
            Self::Dense(values) => values.get(position.0 * columns + position.1)?.as_ref(),
            Self::Sparse(values) => values.get(&position),
        }
    }

    fn crop(&self, stride: usize, rows: usize, columns: usize) -> Self {
        match self {
            Self::Dense(_) => Self::Dense((0..rows).flat_map(|r| {
                (0..columns).map(move |c| self.get(stride, (r, c)).cloned())
            }).collect()),
            Self::Sparse(values) => Self::Sparse(Rc::new(values.iter()
                .filter(|&(&(r, c), _)| r < rows && c < columns)
                .map(|(position, format)| (*position, format.clone()))
                .collect())),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum BlockedBy {
    FilledCell((usize, usize)),
    EarlierFormula((usize, usize)),
    EndOfSheet((usize, usize)),
}

/// The most passes a calculation makes while spills change.
const MOST_PASSES: usize = 8;

/// (sheet, row, column), by position.
pub(crate) type CellKey = (usize, usize, usize);

/// Dense spills have a cell index. Sparse spills reserve their rectangle with one item per formula.
#[derive(Default)]
pub(crate) struct SpillCoverage {
    cells: HashMap<CellKey, usize>,
    rectangles: Vec<(usize, Place, Rc<Array>)>,
}

impl PartialEq for SpillCoverage {
    fn eq(&self, other: &Self) -> bool {
        let footprint = |(owner, place, _): &(usize, Place, Rc<Array>)| (*owner, *place);
        self.cells == other.cells
            && self.rectangles.iter().map(footprint).eq(other.rectangles.iter().map(footprint))
    }
}

impl SpillCoverage {
    fn get(&self, key: CellKey) -> Option<usize> {
        self.cells.get(&key).copied().or_else(|| self.meeting(&Place {
            sheet: key.0, top: key.1, bottom: key.1, left: key.2, right: key.2,
        }).next().map(|(_, owner)| owner))
    }

    fn meeting<'a>(&'a self, area: &'a Place) -> impl Iterator<Item = ((usize, usize), usize)> + 'a {
        self.rectangles.iter().filter_map(|&(owner, rect, _)| {
            if !meet(&rect, area) {
                return None;
            }
            let first = (rect.top.max(area.top), rect.left.max(area.left));
            if first != (rect.top, rect.left) {
                return Some((first, owner));
            }
            if rect.right.min(area.right) > first.1 {
                return Some(((first.0, first.1 + 1), owner));
            }
            (rect.bottom.min(area.bottom) > first.0).then_some(((first.0 + 1, first.1), owner))
        })
    }

    fn is_empty(&self) -> bool {
        self.cells.is_empty() && self.rectangles.is_empty()
    }

    pub(crate) fn add(&mut self, owner: usize, area: Place, array: &Rc<Array>) {
        if array.is_sparse() {
            self.rectangles.push((owner, area, array.clone()));
            return;
        }
        for row in area.top..=area.bottom {
            for column in area.left..=area.right {
                if (row, column) != (area.top, area.left) {
                    self.cells.insert((area.sheet, row, column), owner);
                }
            }
        }
    }

    /// Rows of a pivot source can have spilled values. Visit stored values of sparse spill ranges.
    pub(crate) fn add_rows(&self, place: Place, rows: &mut HashSet<usize>) {
        let within = |r, c| (place.top..=place.bottom).contains(&r) && (place.left..=place.right).contains(&c);
        rows.extend(self.cells.keys().filter_map(|&(s, r, c)| (s == place.sheet && within(r, c)).then_some(r)));
        for (_, area, array) in &self.rectangles {
            if !meet(&place, area) {
                continue;
            }
            rows.extend(array.entries().filter_map(|((r, c), _)| {
                let (r, c) = (r + area.top, c + area.left);
                within(r, c).then_some(r)
            }));
        }
    }
}

pub(crate) enum Slot {
    Constant(Value),
    Formula(usize),
}

pub(crate) struct Grid {
    pub rows: usize,
    pub columns: usize,
    pub slots: BTreeMap<(usize, usize), Slot>,
    /// What the number formats of the cells holding numbers or formulas bring.
    pub formats: HashMap<(usize, usize), Brought>,
}

pub(crate) enum State {
    Waiting,
    Working,
    Done(Outcome),
}

pub(crate) struct FormulaCell {
    pub sheet: usize,
    pub row: usize,
    pub column: usize,
    pub parsed: Rc<Result<Expr, ParseError>>,
    /// Where each of the formula's references points now; `None` when a row, column or sheet of it is gone.
    pub places: Vec<Option<Place>>,
    /// Whether the formula contains a subtotal or aggregate, including inside a conditional branch.
    pub contains_total: bool,
    pub pivot_records: Option<Rc<[RangeInclusive<usize>]>>,
    /// The places whose cells the formula reads.
    pub reads: Vec<Place>,
    /// The formulas it reads, by index, sorted.
    pub reads_formulas: Vec<usize>,
    /// Whether it is in a cycle of reads (#REF!).
    pub in_cycle: bool,
    /// Where the array of a formula that may spill could fill to at most (inside the sheet).
    pub reaches_to: Option<(usize, usize)>,
    /// The earlier formula whose array could fill a cell this one's could: it is #SPILL! without being worked out.
    pub kept_out_by: Option<usize>,
    /// In a cycle, the first formula of the cycle it reads, by index.
    pub cycle_entry: Option<usize>,
    pub state: State,
    /// What its random numbers are drawn by: SipHash-2-4 with no key of its sheet's, row's and column's ids, each
    /// after its length.
    pub random_key: u64,
}

/// A cell's key for its random numbers: its sheet's, row's and column's ids, each after its length (8 bytes).
pub(crate) fn random_key(sheet_id: &str, row_id: &str, column_id: &str) -> u64 {
    #[allow(deprecated)]
    let mut hasher = std::hash::SipHasher::new_with_keys(0, 0);
    for id in [sheet_id, row_id, column_id] {
        hasher.write(&(id.len() as u64).to_le_bytes());
        hasher.write(id.as_bytes());
    }
    hasher.finish()
}

pub struct Calculation {
    pub(crate) grids: Vec<Grid>,
    pub(crate) formulas: Vec<FormulaCell>,
    /// The cells spilled into in this pass, and by which formula.
    pub(crate) covered: SpillCoverage,
    /// The cells spilled into when the last pass ended.
    pub(crate) covered_before: SpillCoverage,
    /// The cells each array that is not kept out could fill, by formula.
    pub(crate) may_fill: Vec<(usize, Place)>,
    /// The names LET has given values, what each brings and the link it is, innermost last.
    pub(crate) scopes: Vec<(Rc<str>, Operand, Option<Brought>, Option<Rc<str>>)>,
    /// Whether the expression being worked out is inside an argument that takes several cells (ARRAYFORMULA's,
    /// SUM's, FILTER's, …), where a function given several cells for one value works cell by cell (`evaluate.rs`).
    pub(crate) lifting: bool,
    /// What the expression last worked out in the formula being worked out brings.
    pub(crate) brought: Option<Brought>,
    /// The link the expression last worked out is: a HYPERLINK's, passed on by IF, CHOOSE, LET and the like.
    pub(crate) link: Option<Rc<str>>,
    /// The formulas being worked out, innermost last.
    pub(crate) working: Vec<usize>,
    /// What each value of the arrays functions picked from cells brings (see `CallContext::sources`), by array, while
    /// a formula is worked out (the array is kept so that no other is made where it is).
    pub(crate) array_formats: HashMap<*const Array, (Rc<Array>, SpillFormats)>,
    pub(crate) now: Option<f64>,
    /// The workbook's seed, which RAND's numbers are drawn from.
    pub(crate) seed: u32,
    /// The workbook's locale: how text is read as a number, and a number written as text.
    pub(crate) locale: &'static Locale,
}

impl Calculation {
    pub fn new(workbook: &Workbook, now: Option<f64>) -> Calculation {
        let mut grids = Vec::with_capacity(workbook.sheets.len());
        let mut formulas = Vec::new();
        let mut pivot_sources = HashMap::new();
        for (s, sheet) in workbook.sheets.iter().enumerate() {
            let mut slots = BTreeMap::new();
            let mut formats = HashMap::new();
            let mut cells: Vec<_> = sheet
                .cells
                .iter()
                .filter_map(|(&(r, c), cell)| Some((sheet.rows.position(r)?, sheet.columns.position(c)?, (r, c), cell)))
                .collect();
            cells.sort_by_key(|(r, c, _, _)| (*r, *c));
            for (r, c, (row_id, column_id), cell) in cells {
                if matches!(cell.input, Input::Number { .. } | Input::Formula { .. }) {
                    let pattern = sheet.formats.get(crate::workbook::formats::Leaf::NumberFormat, (row_id, column_id));
                    if let Some(brought) = pattern.and_then(|p| p.get("pattern")?.as_str()).and_then(Brought::of_pattern) {
                        formats.insert((r, c), brought);
                    }
                }
                let slot = match &cell.input {
                    Input::Number { value } => Slot::Constant(Value::Number(*value)),
                    Input::Text { value } => Slot::Constant(Value::Text(value.as_str().into())),
                    Input::Boolean { value } => Slot::Constant(Value::Boolean(*value)),
                    Input::DropdownOption { option_id, label } => {
                        let label = sheet.dropdown_option(option_id).map_or(label, |o| &o.label);
                        Slot::Constant(Value::Text(label.as_str().into()))
                    }
                    Input::User { .. } | Input::Users { .. } | Input::RichText { .. } => {
                        Slot::Constant(Value::Text(cell.input.reads_as_text().unwrap_or_default().into()))
                    }
                    Input::Formula { formula } => {
                        let parsed = cell.parsed.clone().expect("a formula is read when it is set");
                        let places: Vec<Option<Place>> =
                            formula.references.iter().map(|reference| resolve(workbook, reference)).collect();
                        let pivot = parsed.as_ref().as_ref().ok()
                            .and_then(PivotFormula::from_expr).and_then(Result::ok);
                        let pivot_records = pivot.as_ref()
                            .and_then(|pivot| pivot_records(workbook, pivot, formula, &mut pivot_sources))
                            .map(Rc::from);
                        let (contains_total, reads) = match &*parsed {
                            Ok(expr) => {
                                let mut read = Vec::new();
                                read_references(expr, &mut read);
                                let contains_total = calls(expr, "SUBTOTAL") || calls(expr, "AGGREGATE");
                                let places_read = match (&pivot, &pivot_records) {
                                    (Some(pivot), Some(records)) => pivot_reads(pivot, records, &places),
                                    _ => read.into_iter().filter_map(|i| places.get(i).copied().flatten()).collect(),
                                };
                                (contains_total, places_read)
                            }
                            Err(_) => (false, Vec::new()),
                        };
                        formulas.push(FormulaCell {
                            sheet: s,
                            row: r,
                            column: c,
                            parsed,
                            places,
                            contains_total,
                            pivot_records,
                            reads,
                            reads_formulas: Vec::new(),
                            in_cycle: false,
                            reaches_to: None,
                            kept_out_by: None,
                            cycle_entry: None,
                            state: State::Waiting,
                            random_key: random_key(&sheet.id, &workbook.bases.text(row_id), &workbook.bases.text(column_id)),
                        });
                        Slot::Formula(formulas.len() - 1)
                    }
                };
                slots.insert((r, c), slot);
            }
            grids.push(Grid { rows: sheet.rows.len(), columns: sheet.columns.len(), slots, formats });
        }
        let mut taken: Vec<Vec<(Place, usize)>> = grids.iter().map(|_| Vec::new()).collect();
        for (i, f) in formulas.iter_mut().enumerate() {
            let reach = match &*f.parsed {
                Ok(expr) => reach::reach(expr, &f.places),
                Err(_) => continue,
            };
            if !reach.spills || !reach.is_several() {
                continue;
            }
            let grid = &grids[f.sheet];
            let bottom = f.row.saturating_add(reach.rows - 1).min(grid.rows - 1);
            let right = f.column.saturating_add(reach.columns - 1).min(grid.columns - 1);
            let area = Place { sheet: f.sheet, top: f.row, left: f.column, bottom, right };
            // The first of its cells an earlier array could fill, and the earliest that could.
            f.kept_out_by = taken[f.sheet]
                .iter()
                .filter(|(earlier, _)| meet(earlier, &area))
                .map(|(earlier, j)| ((earlier.top.max(area.top), earlier.left.max(area.left)), *j))
                .min()
                .map(|(_, j)| j);
            f.reaches_to = Some((bottom, right));
            taken[f.sheet].push((area, i));
        }
        let may_fill: Vec<(usize, Place)> = taken
            .into_iter()
            .flatten()
            .filter(|(_, j)| formulas[*j].kept_out_by.is_none())
            .map(|(p, j)| (j, p))
            .collect();
        for f in &mut formulas {
            let mut read = Vec::new();
            for place in f.reads.iter().filter(|_| f.kept_out_by.is_none()) {
                let slots = &grids[place.sheet].slots;
                for r in place.top..=place.bottom {
                    for (_, slot) in slots.range((r, place.left)..=(r, place.right)) {
                        if let Slot::Formula(j) = slot {
                            read.push(*j);
                        }
                    }
                }
                read.extend(may_fill.iter().filter(|(_, area)| meet(area, place)).map(|(j, _)| *j));
            }
            read.sort_unstable();
            read.dedup();
            f.reads_formulas = read;
        }
        let mut calculation = Calculation {
            grids,
            formulas,
            covered: SpillCoverage::default(),
            covered_before: SpillCoverage::default(),
            may_fill,
            scopes: Vec::new(),
            lifting: false,
            brought: None,
            link: None,
            working: Vec::new(),
            array_formats: HashMap::new(),
            now,
            seed: workbook.seed,
            locale: locale::find(&workbook.locale).unwrap_or_else(locale::en_us),
        };
        calculation.find_cycles();
        calculation
    }

    /// Marks the formulas in a cycle of reads: Tarjan's strongly connected components, a component of one formula
    /// being a cycle when the formula reads itself.
    fn find_cycles(&mut self) {
        const UNSEEN: usize = usize::MAX;
        let n = self.formulas.len();
        let (mut index, mut low, mut on_stack) = (vec![UNSEEN; n], vec![0; n], vec![false; n]);
        let (mut stack, mut work, mut next) = (Vec::new(), Vec::new(), 0);
        // Each formula's component, by the index of its root.
        let mut component = vec![UNSEEN; n];
        for root in 0..n {
            if index[root] != UNSEEN {
                continue;
            }
            work.push((root, 0));
            while let Some(&(v, e)) = work.last() {
                if e == 0 {
                    index[v] = next;
                    low[v] = next;
                    next += 1;
                    stack.push(v);
                    on_stack[v] = true;
                }
                if let Some(&w) = self.formulas[v].reads_formulas.get(e) {
                    work.last_mut().expect("a formula being visited").1 += 1;
                    if index[w] == UNSEEN {
                        work.push((w, 0));
                    } else if on_stack[w] {
                        low[v] = low[v].min(index[w]);
                    }
                    continue;
                }
                work.pop();
                if let Some(&(parent, _)) = work.last() {
                    low[parent] = low[parent].min(low[v]);
                }
                if low[v] == index[v] {
                    let start = stack.iter().rposition(|&w| w == v).expect("a formula on the stack");
                    let cycle = stack.len() - start > 1 || self.formulas[v].reads_formulas.binary_search(&v).is_ok();
                    for w in stack.drain(start..) {
                        on_stack[w] = false;
                        self.formulas[w].in_cycle = cycle;
                        component[w] = v;
                    }
                }
            }
        }
        // The first formula of its own cycle each one in a cycle reads: itself, when it reads itself; else by its
        // references in order, as `first_read_through` finds it.
        for i in 0..n {
            let f = &self.formulas[i];
            let reads_itself = f.reads_formulas.binary_search(&i).is_ok();
            let entry = f.in_cycle.then(|| {
                if reads_itself {
                    return Some(i);
                }
                f.reads.iter().find_map(|place| self.first_read_through(place, |j| component[j] == component[i]))
            });
            self.formulas[i].cycle_entry = entry.flatten();
        }
    }

    /// The first formula of those `wanted` takes that a place is read through: one a cell of it holds, row by row;
    /// else one whose array may fill (or fills) some of its cells, by the first cell they share, row by row (the
    /// formula's own cell is the one named).
    pub(crate) fn first_read_through(&self, place: &Place, wanted: impl Fn(usize) -> bool) -> Option<usize> {
        let slots = &self.grids[place.sheet].slots;
        let held = (place.top..=place.bottom).find_map(|r| {
            slots.range((r, place.left)..=(r, place.right)).find_map(|(_, slot)| match slot {
                Slot::Formula(j) if wanted(*j) => Some(*j),
                _ => None,
            })
        });
        held.or_else(|| {
            let may_fill = self.may_fill.iter().filter(|(j, area)| meet(area, place) && wanted(*j));
            let may_fill = may_fill.map(|(j, area)| ((area.top.max(place.top), area.left.max(place.left)), *j));
            let in_place = |&(s, r, c): &CellKey| {
                s == place.sheet && (place.top..=place.bottom).contains(&r) && (place.left..=place.right).contains(&c)
            };
            let covered = self.covered.cells.iter().filter(|(key, j)| in_place(key) && wanted(**j));
            let sparse = self.covered.meeting(place).filter(|(_, j)| wanted(*j));
            may_fill.chain(covered.map(|(&(_, r, c), &j)| ((r, c), j))).chain(sparse).min().map(|(_, j)| j)
        })
    }

    /// Adds the reads of cells this pass spilled into, from the formulas that read them to the one that spills;
    /// answers whether any is new.
    fn read_spills(&mut self) -> bool {
        if self.covered.is_empty() {
            return false;
        }
        let covered: BTreeMap<CellKey, usize> = self.covered.cells.iter().map(|(k, v)| (*k, *v)).collect();
        let mut added = false;
        for f in self.formulas.iter_mut().filter(|f| f.kept_out_by.is_none()) {
            for place in &f.reads {
                for (_, anchor) in self.covered.meeting(place) {
                    if let Err(at) = f.reads_formulas.binary_search(&anchor) {
                        f.reads_formulas.insert(at, anchor);
                        added = true;
                    }
                }
                if covered.is_empty() {
                    continue;
                }
                for r in place.top..=place.bottom {
                    for (_, &anchor) in covered.range((place.sheet, r, place.left)..=(place.sheet, r, place.right)) {
                        if let Err(at) = f.reads_formulas.binary_search(&anchor) {
                            f.reads_formulas.insert(at, anchor);
                            added = true;
                        }
                    }
                }
            }
        }
        added
    }

    /// Works out every formula; answers each one's outcome by (sheet, row, column) position.
    pub fn run(mut self) -> Vec<((usize, usize, usize), Outcome)> {
        for _ in 0..MOST_PASSES {
            for f in &mut self.formulas {
                f.state = State::Waiting;
            }
            self.covered = SpillCoverage::default();
            for i in 0..self.formulas.len() {
                self.outcome(i);
            }
            let new_reads = self.read_spills();
            if new_reads {
                self.find_cycles();
            }
            if self.covered == self.covered_before && !new_reads {
                break;
            }
            self.covered_before = std::mem::take(&mut self.covered);
        }
        self.formulas
            .into_iter()
            .map(|f| {
                let outcome = match f.state {
                    State::Done(o) => o,
                    _ => Outcome { value: Value::Error(CellError::Reference), spill: None, brought: None, links_to: None, cycle_entry: None },
                };
                ((f.sheet, f.row, f.column), outcome)
            })
            .collect()
    }

    /// A formula's outcome, worked out now if it is not yet; `None` while it is being worked out (a cycle).
    pub(crate) fn outcome(&mut self, i: usize) -> Option<&Outcome> {
        match self.formulas[i].state {
            State::Done(_) => {}
            State::Working => return None,
            State::Waiting if self.formulas[i].kept_out_by.is_some() => {
                let f = &self.formulas[i];
                let earlier = &self.formulas[f.kept_out_by.expect("an earlier formula")];
                let by = BlockedBy::EarlierFormula((earlier.row, earlier.column));
                let would_fill_to = f.reaches_to.expect("a formula kept out may spill");
                let spill = Some(SpillOutcome::Blocked { by, would_fill_to });
                let value = Value::Error(CellError::Spill);
                self.formulas[i].state = State::Done(Outcome { value, spill, brought: None, links_to: None, cycle_entry: None });
            }
            State::Waiting if self.formulas[i].in_cycle => {
                let entry = self.formulas[i].cycle_entry.map(|j| (self.formulas[j].sheet, self.formulas[j].row, self.formulas[j].column));
                let value = Value::Error(CellError::Reference);
                self.formulas[i].state = State::Done(Outcome { value, spill: None, brought: None, links_to: None, cycle_entry: entry });
            }
            State::Waiting => {
                self.formulas[i].state = State::Working;
                self.working.push(i);
                // What the formula that reads this one has worked out so far brings stays as it was.
                let reader_brought = self.brought.take();
                let reader_link = self.link.take();
                let reader_lifting = std::mem::replace(&mut self.lifting, false);
                let parsed = self.formulas[i].parsed.clone();
                let operand = match &*parsed {
                    Ok(expr) => self.eval(i, expr),
                    Err(_) => Operand::Value(Value::Error(CellError::Error)),
                };
                let brought = std::mem::replace(&mut self.brought, reader_brought);
                let link = std::mem::replace(&mut self.link, reader_link);
                self.lifting = reader_lifting;
                let mut outcome = self.settle(i, operand);
                outcome.brought = brought.filter(|_| matches!(outcome.value, Value::Number(_)));
                outcome.links_to = link.filter(|_| !matches!(outcome.value, Value::Error(_)));
                self.working.pop();
                if self.working.is_empty() {
                    self.array_formats.clear();
                }
                self.formulas[i].state = State::Done(outcome);
            }
        }
        match &self.formulas[i].state {
            State::Done(o) => Some(o),
            _ => None,
        }
    }

    /// What a formula's answer leaves in its cell: one value, or an array that spills.
    fn settle(&mut self, i: usize, operand: Operand) -> Outcome {
        let one = |value: Value| Outcome { value: held(value), spill: None, brought: None, links_to: None, cycle_entry: None };
        match operand {
            Operand::Value(v) => one(v),
            Operand::Range(place) if place.is_single() => one(self.cell_value(place.sheet, place.top, place.left)),
            Operand::Range(_) => one(Value::Error(CellError::Value)),
            Operand::Values(a) if a.is_single() => one(a.get(0, 0).clone()),
            Operand::Values(_) => one(Value::Error(CellError::Value)),
            Operand::Array(a) => match self.trimmed(a) {
                a if a.is_single() => one(a.get(0, 0).clone()),
                a => self.spill(i, a),
            },
        }
    }

    /// An array that spills without its last rows and columns while they hold nothing but blanks and empty texts;
    /// at least its first value stays. Only what spills is cut: `=ROWS(VSTACK(1,""))` is still 2.
    fn trimmed(&mut self, array: Rc<Array>) -> Rc<Array> {
        let (rows, columns) = array.occupied_dimensions();
        if rows == array.rows() && columns == array.columns() {
            return array;
        }
        let cut = Rc::new(array.crop(rows, columns));
        if let Some((_, formats)) = self.array_formats.get(&Rc::as_ptr(&array)) {
            let formats = formats.crop(array.columns(), rows, columns);
            self.array_formats.insert(Rc::as_ptr(&cut), (cut.clone(), formats));
        }
        cut
    }

    fn spill(&mut self, i: usize, array: Rc<Array>) -> Outcome {
        let (s, row, column) = (self.formulas[i].sheet, self.formulas[i].row, self.formulas[i].column);
        let grid = &self.grids[s];
        let bottom = row + array.rows() - 1;
        let right = column + array.columns() - 1;
        let blocked = |by, to| Outcome {
            value: Value::Error(CellError::Spill),
            spill: Some(SpillOutcome::Blocked { by, would_fill_to: to }),
            brought: None,
            links_to: None,
            cycle_entry: None,
        };
        if bottom >= grid.rows || right >= grid.columns {
            return blocked(BlockedBy::EndOfSheet((bottom, right)), (bottom.min(grid.rows - 1), right.min(grid.columns - 1)));
        }
        for r in row..=bottom {
            for (&(rr, cc), _) in grid.slots.range((r, column)..=(r, right)) {
                if (rr, cc) != (row, column) {
                    return blocked(BlockedBy::FilledCell((rr, cc)), (bottom, right));
                }
            }
        }
        let area = Place { sheet: s, top: row, bottom, left: column, right };
        let dense = if array.is_sparse() {
            self.covered.cells.iter().filter_map(|(&(sheet, r, c), &owner)| {
                (sheet == s && owner != i && (row..=bottom).contains(&r) && (column..=right).contains(&c))
                    .then_some(((r, c), owner))
            }).min()
        } else {
            (row..=bottom).find_map(|r| {
                (column..=right).find_map(|c| {
                    self.covered.cells.get(&(s, r, c)).filter(|&&owner| owner != i).map(|&owner| ((r, c), owner))
                })
            })
        };
        let sparse = self.covered.meeting(&area).filter(|(_, owner)| *owner != i);
        if let Some((_, other)) = dense.into_iter().chain(sparse).min() {
            let at = (self.formulas[other].row, self.formulas[other].column);
            return blocked(BlockedBy::EarlierFormula(at), (bottom, right));
        }
        self.covered.add(i, area, &array);
        let value = held(array.get(0, 0).clone());
        let formats = self.array_formats.get(&Rc::as_ptr(&array)).map(|(_, formats)| formats.clone());
        let spill = SpillOutcome::Fills { array, to: (bottom, right), formats };
        Outcome { value, spill: Some(spill), brought: None, links_to: None, cycle_entry: None }
    }

    /// A cell's value: its input, its formula's value, or what an array spills into it.
    pub(crate) fn cell_value(&mut self, sheet: usize, row: usize, column: usize) -> Value {
        match self.grids[sheet].slots.get(&(row, column)) {
            Some(Slot::Constant(v)) => v.clone(),
            Some(Slot::Formula(j)) => {
                let j = *j;
                match self.outcome(j) {
                    Some(o) => o.value.clone(),
                    None => Value::Error(CellError::Reference),
                }
            }
            None => self.spilled_value(sheet, row, column),
        }
    }

    /// What a cell brings to a formula that reads it: the pattern of a number, a formula's own pattern or else what
    /// it brings, while the formula comes to a number (`="x"` under `h:mm` brings nothing to `=SUM(A1)`); nothing from
    /// other cells, nor from those an array spills into.
    pub(crate) fn cell_brought(&mut self, sheet: usize, row: usize, column: usize) -> Option<Brought> {
        let own = self.grids[sheet].formats.get(&(row, column)).cloned();
        match self.grids[sheet].slots.get(&(row, column)) {
            Some(Slot::Constant(Value::Number(_))) => own,
            Some(Slot::Formula(j)) => {
                let j = *j;
                match self.outcome(j) {
                    Some(outcome) if !matches!(outcome.value, Value::Number(_)) => None,
                    Some(outcome) => own.or_else(|| outcome.brought.clone()),
                    None => own,
                }
            }
            _ => None,
        }
    }

    /// What a range brings: what its first number brings, row by row (`=SUM(A1:B2)` over an empty A1 and B1 brings
    /// A2's time), in its first 100 rows only (`=SUM(A:A)` brings nothing from A101). Empty cells, texts, booleans
    /// and errors are passed over; a number an array spilled is the first and brings nothing. A cell alone brings
    /// what it brings.
    pub(crate) fn range_brought(&mut self, place: Place) -> Option<Brought> {
        if (place.top, place.left) == (place.bottom, place.right) {
            return self.cell_brought(place.sheet, place.top, place.left);
        }
        enum Held {
            Number,
            Formula(usize),
            Other,
            Nothing,
        }
        let held = |slot: &Slot| match slot {
            Slot::Constant(Value::Number(_)) => Held::Number,
            Slot::Formula(j) => Held::Formula(*j),
            Slot::Constant(_) => Held::Other,
        };
        // With no array spilling, only the cells with something in them need looking at.
        let spills = !(self.covered.is_empty() && self.covered_before.is_empty() && self.may_fill.is_empty());
        for r in place.top..=place.bottom.min(place.top + 99) {
            let slots = &self.grids[place.sheet].slots;
            let row: Vec<(usize, Held)> = match spills {
                true => (place.left..=place.right).map(|c| (c, slots.get(&(r, c)).map_or(Held::Nothing, held))).collect(),
                false => slots.range((r, place.left)..=(r, place.right)).map(|(&(_, c), slot)| (c, held(slot))).collect(),
            };
            for (c, held) in row {
                let is_number = match held {
                    Held::Number => true,
                    Held::Formula(j) => matches!(self.outcome(j).map(|o| &o.value), Some(Value::Number(_))),
                    Held::Other => false,
                    Held::Nothing => match self.spilled_value(place.sheet, r, c) {
                        Value::Number(_) => return None,
                        _ => false,
                    },
                };
                if is_number {
                    return self.cell_brought(place.sheet, r, c);
                }
            }
        }
        None
    }

    fn spilled_value(&mut self, sheet: usize, row: usize, column: usize) -> Value {
        let key = (sheet, row, column);
        let anchor = match self.covered.get(key) {
            Some(j) => j,
            None => match self.covered_before.get(key).or_else(|| self.may_fill(key)) {
                Some(j) => {
                    if self.outcome(j).is_none() {
                        return Value::Error(CellError::Reference);
                    }
                    match self.covered.get(key) {
                        Some(k) => k,
                        None => return Value::Blank,
                    }
                }
                None => return Value::Blank,
            },
        };
        let f = &self.formulas[anchor];
        match &f.state {
            State::Done(Outcome { spill: Some(SpillOutcome::Fills { array, .. }), .. }) => array.get(row - f.row, column - f.column).clone(),
            _ => Value::Blank,
        }
    }

    /// The formula whose array could fill a cell, if any is not kept out.
    fn may_fill(&self, (sheet, row, column): CellKey) -> Option<usize> {
        let at = Place { sheet, top: row, left: column, bottom: row, right: column };
        self.may_fill.iter().find(|(_, area)| meet(area, &at)).map(|(j, _)| *j)
    }

    /// The values of a range, row by row.
    pub(crate) fn range_values(&mut self, place: Place) -> Array {
        let mut values = Vec::with_capacity(place.rows() * place.columns());
        for r in place.top..=place.bottom {
            for c in place.left..=place.right {
                values.push(self.cell_value(place.sheet, r, c));
            }
        }
        Array::new(place.rows(), place.columns(), values)
    }

    /// The random number in [0, 1) a call of formula `f` draws: SipHash-2-4, keyed by the workbook's seed and the
    /// cell's key, of the call's index. The same cell, seed and call draw the same number.
    pub(crate) fn random(&self, f: usize, index: u32) -> f64 {
        #[allow(deprecated)]
        let mut hasher = std::hash::SipHasher::new_with_keys(self.seed as u64, self.formulas[f].random_key);
        hasher.write(&index.to_le_bytes());
        (hasher.finish() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }
}

/// Whether an expression calls a function anywhere in it.
pub(crate) fn calls(expr: &Expr, function: &str) -> bool {
    match expr {
        Expr::Call { function: id, arguments, .. } => {
            id.is_some_and(|id| id.name() == function) || arguments.iter().any(|a| calls(a, function))
        }
        Expr::Unary(_, a) => calls(a, function),
        Expr::Binary(_, a, b) => calls(a, function) || calls(b, function),
        _ => false,
    }
}

/// The references, by index, whose cells an expression reads: all but those written directly where a function
/// takes only the place. A call with the wrong number of arguments, or of a name nobody knows, reads them all.
pub(crate) fn read_references(expr: &Expr, out: &mut Vec<usize>) {
    match expr {
        Expr::Reference(i) => out.push(*i),
        Expr::Call { function, arguments, .. } => {
            let slots = function.and_then(|id| functions::match_arguments(id.description(), arguments.len()));
            for (n, argument) in arguments.iter().enumerate() {
                // Too many arguments: those that have a place in the description still take what it says.
                let slot = match &slots {
                    Some(slots) => slots.get(n).copied(),
                    None => function.and_then(|id| id.description().arguments.get(n)),
                };
                let only_the_place = matches!(argument, Expr::Reference(_))
                    && slot.is_some_and(|slot| slot.takes == Takes::OnlyThePlace);
                if !only_the_place {
                    read_references(argument, out);
                }
            }
        }
        Expr::Unary(_, a) => read_references(a, out),
        Expr::Binary(_, a, b) => {
            read_references(a, out);
            read_references(b, out);
        }
        _ => {}
    }
}

/// The recognized source a pivot formula's references describe.
fn pivot_records(
    workbook: &Workbook,
    pivot: &PivotFormula,
    formula: &crate::formula::StoredFormula,
    sources: &mut HashMap<PivotSource, Vec<serde_json::Value>>,
) -> Option<Vec<RangeInclusive<usize>>> {
    let spec = pivot.specification(&formula.references)?;
    let tables = sources.entry(spec.source.clone()).or_insert_with(|| pivot_read::source_tables(workbook, &spec.source));
    let table = pivot_read::matching_table(tables, &spec)?;
    if !pivot_read::reads_just_records(pivot, formula, table) {
        return None;
    }
    let sheet = workbook.sheet_index(&spec.source.sheet_id)?;
    pivot_read::record_runs(workbook, &workbook.sheets[sheet], table)
}

fn pivot_reads(pivot: &PivotFormula, records: &[RangeInclusive<usize>], places: &[Option<Place>]) -> Vec<Place> {
    let at = |i: usize| places.get(i).copied().flatten();
    let mut reads = Vec::new();
    for place in pivot.columns_used().filter_map(at) {
        reads.push(Place { bottom: place.top, ..place });
        reads.extend(records.iter().map(|rows| Place { top: *rows.start(), bottom: *rows.end(), ..place }));
    }
    reads.extend(pivot.filters.iter().filter_map(|filter| match filter.listed {
        Criterion::Reference(i) => at(i),
        Criterion::Values(_) => None,
    }));
    reads
}

/// Whether two places have a cell in common.
pub(crate) fn meet(a: &Place, b: &Place) -> bool {
    a.sheet == b.sheet && a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right
}

/// The cells the array of the formula in a cell (of sheet `s`, still there) could fill at most, from its own, when
/// it may spill (see `reach`).
pub(crate) fn spill_area(workbook: &Workbook, s: usize, (r, c): (LineId, LineId)) -> Option<Place> {
    let sheet = &workbook.sheets[s];
    let cell = sheet.cells.get(&(r, c))?;
    let (Input::Formula { formula }, Some(Ok(expr))) = (&cell.input, cell.parsed.as_deref()) else { return None };
    let (row, column) = (sheet.rows.position(r)?, sheet.columns.position(c)?);
    let places: Vec<Option<Place>> = formula.references.iter().map(|reference| resolve(workbook, reference)).collect();
    let reach = reach::reach(expr, &places);
    if !reach.spills || !reach.is_several() {
        // PIVOT's shape depends on distinct values in its source and cannot be inferred from its syntax.
        // Its last footprint remains relevant when a blank intersection is filled or a blocker is cleared.
        let (bottom, right) = match workbook.outcome(&sheet.id, r, c)?.spill.as_ref()? {
            SpillOutcome::Fills { array, .. } if array.is_sparse() => (
                (row + array.rows() - 1).min(sheet.rows.len() - 1),
                (column + array.columns() - 1).min(sheet.columns.len() - 1),
            ),
            SpillOutcome::Blocked { would_fill_to, .. } if matches!(expr, Expr::Call { name, .. } if name.as_ref() == "PIVOT") => {
                *would_fill_to
            }
            _ => return None,
        };
        return (bottom >= row && right >= column).then_some(Place { sheet: s, top: row, left: column, bottom, right });
    }
    let bottom = row.saturating_add(reach.rows - 1).min(sheet.rows.len() - 1);
    let right = column.saturating_add(reach.columns - 1).min(sheet.columns.len() - 1);
    Some(Place { sheet: s, top: row, left: column, bottom, right })
}

/// The cells each formula that may spill could fill at most (as a calculation gives them), by sheet in order of
/// position, and whether an earlier one's could fill one of them (it is kept out).
pub(crate) fn spill_areas(workbook: &Workbook) -> Vec<(Place, bool)> {
    let mut areas: Vec<(Place, bool)> = Vec::new();
    for (s, sheet) in workbook.sheets.iter().enumerate() {
        let mut found: Vec<Place> = sheet.cells.keys().filter_map(|&at| spill_area(workbook, s, at)).collect();
        found.sort_by_key(|area| (area.top, area.left));
        let first = areas.len();
        for area in found {
            let kept_out = areas[first..].iter().any(|(earlier, _)| meet(earlier, &area));
            areas.push((area, kept_out));
        }
    }
    areas
}

/// Where a reference points now.
fn resolve(workbook: &Workbook, reference: &Reference) -> Option<Place> {
    let at = workbook.locate(reference)?;
    Some(Place { sheet: at.sheet, top: at.top.0, left: at.left.0, bottom: at.bottom.0, right: at.right.0 })
}

/// Works out a workbook's formulas and keeps their outcomes in it.
pub fn calculate(workbook: &mut Workbook, now: Option<f64>) {
    let outcomes = Calculation::new(workbook, now).run();
    let mut kept = HashMap::with_capacity(outcomes.len());
    for ((s, r, c), outcome) in outcomes {
        let sheet = &workbook.sheets[s];
        if let (Some(row), Some(column)) = (sheet.rows.line(r), sheet.columns.line(c)) {
            kept.insert((sheet.id.clone(), row, column), outcome);
        }
    }
    workbook.outcomes = kept;
    workbook.needs_calculation = false;
    workbook.calculated_at = now;
}

/// What a formula's own cell holds: a blank answer is 0 there (the cells an array spills into keep their blanks).
fn held(v: Value) -> Value {
    match v {
        Value::Blank => Value::Number(0.0),
        v => v,
    }
}
