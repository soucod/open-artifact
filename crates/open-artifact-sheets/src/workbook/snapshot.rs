//! The line-oriented workbook snapshot (load form 2). A snapshot preserves row and column identities, but
//! deliberately leaves out cells from deleted sheets and lines.

mod axes;
mod cells;

use hashbrown::HashSet;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use self::axes::{Ids, Rows, Run};
use super::formats;
use super::layout::{self, RangeIds};
use super::load::{Op, Refusal};
use super::{Sheet, Workbook, DEFAULT_LOCALE};
use crate::ids::LineId;

const OLDEST_READER: u32 = 46;
const MOST_LINES: usize = 2_000_000;

#[derive(Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Piece {
    Workbook {
        oldest_reader: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        time_zone: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        locale: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        seed: Option<u32>,
    },
    Views {
        entries: Vec<Json>,
    },
    Sheet {
        sheet_id: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        is_deleted: bool,
        name: String,
        rows: Rows,
        columns: Vec<Run>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        last_frozen_row: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        last_frozen_column: Option<String>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        are_gridlines_hidden: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        interactive: Option<String>,
    },
    MergedRanges {
        entries: Vec<RangeIds>,
    },
    ColumnWidths {
        entries: Vec<Json>,
    },
    RowHeights {
        entries: Vec<Json>,
    },
    Dropdowns {
        entries: Vec<Json>,
    },
    DropdownsLeftOut {
        entries: Vec<String>,
    },
    CellFormats {
        entries: Vec<CellFormat>,
    },
    RowGroups {
        entries: Vec<Json>,
    },
    ColumnGroups {
        entries: Vec<Json>,
    },
    ConditionalFormats {
        entries: Vec<Json>,
    },
    Placements {
        entries: Vec<Json>,
    },
    CellTables {
        entries: Vec<Json>,
    },
    NamedViews {
        entries: Vec<Json>,
    },
    Cells {
        grid: cells::Grid,
    },
    End {
        lines_before: usize,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CellFormat {
    rows: Vec<Ids>,
    columns: Vec<crate::ids::IdRun>,
    format: Json,
}

pub(crate) struct Snapshot {
    pieces: Vec<Piece>,
    has_end: bool,
}

impl std::fmt::Debug for Snapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Snapshot")
            .field("piece_count", &self.pieces.len())
            .field("has_end", &self.has_end)
            .finish()
    }
}

impl Snapshot {
    pub(crate) fn new() -> Self {
        Self {
            pieces: Vec::new(),
            has_end: false,
        }
    }

    /// Each page stops at a line break, with the final line break optional.
    pub(crate) fn append(&mut self, lines: &str, is_last: bool) -> Option<()> {
        for line in lines.split_terminator('\n') {
            if self.has_end {
                return None;
            }
            let piece: Piece = serde_json::from_str(line).ok()?;
            match &piece {
                Piece::Workbook { oldest_reader, .. } => {
                    if !self.pieces.is_empty() || *oldest_reader > super::version::NEWEST {
                        return None;
                    }
                }
                _ if self.pieces.is_empty() => return None,
                Piece::End { lines_before } => {
                    if *lines_before != self.pieces.len() {
                        return None;
                    }
                    self.has_end = true;
                }
                _ => {}
            }
            self.pieces.push(piece);
        }
        (!is_last || self.has_end).then_some(())
    }

    pub(crate) fn finish(self) -> Option<Workbook> {
        let mut workbook = Workbook::default();
        let mut current_sheet = None;
        let mut row_ids = HashSet::new();
        let mut column_ids = HashSet::new();
        let mut deleted = Vec::new();
        for piece in self.pieces {
            match piece {
                Piece::Workbook {
                    time_zone,
                    locale,
                    seed,
                    ..
                } => {
                    if let Some(time_zone) = time_zone {
                        workbook
                            .apply_in_place(&[Op::SetTimeZone {
                                time_zone: Some(time_zone),
                            }])
                            .ok()?;
                    }
                    if let Some(locale) = locale {
                        workbook.apply_in_place(&[Op::SetLocale { locale }]).ok()?;
                    }
                    if let Some(seed) = seed {
                        workbook.seed = seed;
                    }
                }
                Piece::Views { entries } if current_sheet.is_none() => {
                    apply_entries(&mut workbook, "", "setViews", "views", entries)?;
                }
                Piece::Sheet {
                    sheet_id,
                    is_deleted,
                    name,
                    rows,
                    columns,
                    last_frozen_row,
                    last_frozen_column,
                    are_gridlines_hidden,
                    interactive,
                } => {
                    if workbook.sheet_order.contains(&sheet_id) {
                        return None;
                    }
                    let mut rows = rows.read(&mut workbook.bases)?;
                    let mut columns = axes::read_runs(&columns, &mut workbook.bases)?;
                    if !rows.all().iter().all(|&line| row_ids.insert(line))
                        || !columns.all().iter().all(|&line| column_ids.insert(line))
                    {
                        return None;
                    }
                    // The pieces keep layout on deleted lines. Read that layout with all its lines present,
                    // then restore the deletion markers.
                    let deleted_rows: Vec<_> = rows.deleted().collect();
                    let deleted_columns: Vec<_> = columns.deleted().collect();
                    if !deleted_rows.is_empty() {
                        rows.undelete(&deleted_rows);
                    }
                    if !deleted_columns.is_empty() {
                        columns.undelete(&deleted_columns);
                    }
                    deleted.push((is_deleted, deleted_rows, deleted_columns));
                    let frozen =
                        |axis: &crate::ids::Axis, id: Option<String>| -> Option<Option<LineId>> {
                            let Some(id) = id else { return Some(None) };
                            let line = workbook.bases.parse(&id)?;
                            axis.knows(line).then_some(Some(line))
                        };
                    let sheet = Sheet {
                        id: sheet_id.clone(),
                        name,
                        last_frozen_row: frozen(&rows, last_frozen_row)?,
                        last_frozen_column: frozen(&columns, last_frozen_column)?,
                        rows,
                        columns,
                        are_gridlines_hidden,
                        interactive,
                        ..Sheet::default()
                    };
                    workbook.sheet_order.push(sheet_id);
                    workbook.sheets.push(sheet);
                    current_sheet = Some(workbook.sheets.len() - 1);
                }
                Piece::End { .. } => break,
                piece => {
                    let index = current_sheet?;
                    let sheet_id = workbook.sheets[index].id.clone();
                    read_sheet_piece(&mut workbook, index, &sheet_id, piece)?;
                }
            }
        }
        for (mut sheet, (is_deleted, rows, columns)) in std::mem::take(&mut workbook.sheets)
            .into_iter()
            .zip(deleted)
        {
            if !rows.is_empty() {
                sheet.rows.delete(&rows);
            }
            if !columns.is_empty() {
                sheet.columns.delete(&columns);
            }
            if is_deleted {
                workbook.deleted_sheets.push(sheet);
            } else {
                workbook.sheets.push(sheet);
            }
        }
        workbook.needs_calculation = true;
        Some(workbook)
    }
}

fn apply_entries(
    workbook: &mut Workbook,
    sheet_id: &str,
    kind: &str,
    key: &str,
    entries: impl Serialize,
) -> Option<()> {
    let mut op = json!({"kind": kind, key: entries});
    if !sheet_id.is_empty() {
        op["sheetId"] = json!(sheet_id);
    }
    let op: Op = serde_json::from_value(op).ok()?;
    workbook.apply_in_place(&[op]).ok()?;
    Some(())
}

fn nest_entries(entries: Vec<Json>, id_key: &str, object_key: &str) -> Option<Vec<Json>> {
    entries
        .into_iter()
        .map(|entry| {
            let Json::Object(mut entry) = entry else {
                return None;
            };
            let id = entry.swap_remove(id_key)?;
            Some(json!({id_key: id, object_key: entry}))
        })
        .collect()
}

fn read_sheet_piece(workbook: &mut Workbook, index: usize, id: &str, piece: Piece) -> Option<()> {
    match piece {
        Piece::MergedRanges { entries } => {
            apply_entries(workbook, id, "mergeCells", "ranges", entries)
        }
        Piece::ColumnWidths { entries } => {
            apply_entries(workbook, id, "setColumnWidths", "widths", entries)
        }
        Piece::RowHeights { entries } => {
            apply_entries(workbook, id, "setRowHeights", "heights", entries)
        }
        Piece::Dropdowns { entries } => {
            apply_entries(workbook, id, "setDropdowns", "dropdowns", entries)
        }
        Piece::DropdownsLeftOut { .. } => Some(()),
        Piece::CellFormats { entries } => {
            let formats = entries
                .into_iter()
                .map(|entry| {
                    let mut rows = Vec::new();
                    for Ids { base, runs } in entry.rows {
                        rows.extend(runs.into_iter().map(|[first, count]| crate::ids::IdRun {
                            base: base.clone(),
                            first,
                            count,
                        }));
                    }
                    super::load::CellsToFormat {
                        rows,
                        columns: entry.columns,
                        format: entry.format,
                    }
                })
                .collect::<Vec<_>>();
            apply_entries(workbook, id, "setCellFormats", "formats", formats)
        }
        Piece::RowGroups { entries } => apply_entries(
            workbook,
            id,
            "setRowGroups",
            "groups",
            nest_entries(entries, "groupId", "group")?,
        ),
        Piece::ColumnGroups { entries } => apply_entries(
            workbook,
            id,
            "setColumnGroups",
            "groups",
            nest_entries(entries, "groupId", "group")?,
        ),
        Piece::ConditionalFormats { entries } => apply_entries(
            workbook,
            id,
            "setConditionalFormats",
            "conditionalFormats",
            nest_entries(entries, "conditionalFormatId", "conditionalFormat")?,
        ),
        Piece::Placements { entries } => {
            apply_entries(workbook, id, "setPlacements", "placements", entries)
        }
        Piece::CellTables { entries } => {
            apply_entries(workbook, id, "setCellTables", "cellTables", entries)
        }
        Piece::NamedViews { entries } => {
            apply_entries(workbook, id, "setNamedViews", "namedViews", entries)
        }
        Piece::Cells { grid } => grid.read(&mut workbook.sheets[index], &workbook.bases),
        _ => None,
    }
}

pub(crate) fn lines_of_load(ops: &[Op]) -> Result<String, Refusal> {
    let mut workbook = Workbook::default();
    workbook.apply_in_place(ops)?;
    let mut pieces = Vec::new();
    pieces.push(Piece::Workbook {
        oldest_reader: OLDEST_READER,
        time_zone: workbook.time_zone.clone(),
        locale: (workbook.locale != DEFAULT_LOCALE).then(|| workbook.locale.clone()),
        seed: (workbook.seed != Workbook::default().seed).then_some(workbook.seed),
    });
    write_views(&workbook, &mut pieces);
    for id in &workbook.sheet_order {
        let (sheet, is_deleted) = match workbook.sheets.iter().find(|sheet| &sheet.id == id) {
            Some(sheet) => (sheet, false),
            None => (
                workbook
                    .deleted_sheets
                    .iter()
                    .find(|sheet| &sheet.id == id)
                    .expect("sheet is held"),
                true,
            ),
        };
        let bases = &workbook.bases;
        pieces.push(Piece::Sheet {
            sheet_id: id.clone(),
            is_deleted,
            name: if is_deleted {
                String::new()
            } else {
                sheet.name.clone()
            },
            rows: axes::rows_written(&sheet.rows, bases),
            columns: axes::columns_written(&sheet.columns, bases),
            last_frozen_row: sheet.last_frozen_row.map(|line| bases.text(line)),
            last_frozen_column: sheet.last_frozen_column.map(|line| bases.text(line)),
            are_gridlines_hidden: sheet.are_gridlines_hidden,
            interactive: sheet.interactive.clone().filter(|_| !is_deleted),
        });
        write_sheet_pieces(sheet, is_deleted, &workbook, &mut pieces);
    }
    pieces.push(Piece::End {
        lines_before: pieces.len(),
    });
    let mut lines = String::new();
    for piece in pieces {
        lines.push_str(&serde_json::to_string(&piece).expect("snapshot piece serializes"));
        lines.push('\n');
    }
    Ok(lines)
}

fn write_views(workbook: &Workbook, pieces: &mut Vec<Piece>) {
    let live: HashSet<_> = workbook
        .sheets
        .iter()
        .flat_map(Sheet::shown_views)
        .collect();
    let deleted: HashSet<_> = workbook
        .deleted_sheets
        .iter()
        .flat_map(Sheet::shown_views)
        .collect();
    let entries = workbook
        .views
        .values()
        .filter(|(id, _)| live.contains(id.as_str()) || !deleted.contains(id.as_str()))
        .map(|(id, view)| json!({"viewId": id, "view": view}))
        .collect::<Vec<_>>();
    if !entries.is_empty() {
        pieces.push(Piece::Views { entries });
    }
}

fn write_sheet_pieces(
    sheet: &Sheet,
    is_deleted: bool,
    workbook: &Workbook,
    pieces: &mut Vec<Piece>,
) {
    use super::Input;

    if !sheet.merged_ranges.is_empty() {
        pieces.push(Piece::MergedRanges {
            entries: sheet.merged_ranges.clone(),
        });
    }
    let bases = &workbook.bases;
    let widths = sizes_written(bases, &sheet.column_widths, "columns", "widthInPixels");
    if !widths.is_empty() {
        pieces.push(Piece::ColumnWidths { entries: widths });
    }
    let heights = sizes_written(bases, &sheet.row_heights, "rows", "heightInPixels");
    if !heights.is_empty() {
        pieces.push(Piece::RowHeights { entries: heights });
    }
    let is_live =
        |r: LineId, c: LineId| !is_deleted && sheet.rows.contains(r) && sheet.columns.contains(c);
    let used_dropdowns: HashSet<_> = sheet
        .formats
        .iter()
        .filter(|(_, (r, c), _)| is_live(*r, *c))
        .filter(|(leaf, _, _)| *leaf == formats::Leaf::CellControl)
        .filter_map(|(_, _, value)| value["dropdownId"].as_str())
        .collect();
    let used_options: HashSet<_> = sheet
        .cells
        .iter()
        .filter(|&(&(r, c), _)| is_live(r, c))
        .filter_map(|(_, cell)| match &cell.input {
            Input::DropdownOption { option_id, .. } => Some(option_id),
            _ => None,
        })
        .collect();
    let mut dropdowns = Vec::new();
    let mut left_out = Vec::new();
    for (id, options) in sheet.dropdowns.values() {
        if used_dropdowns.contains(id.as_str())
            || options
                .iter()
                .any(|option| used_options.contains(&option.option_id))
        {
            dropdowns.push(json!({"dropdownId": id, "options": options}));
        } else {
            left_out.push(id.clone());
        }
    }
    if !dropdowns.is_empty() {
        pieces.push(Piece::Dropdowns { entries: dropdowns });
    }
    let formats = sheet.formats.iter().filter(|(leaf, _, value)| {
        *leaf != formats::Leaf::CellControl
            || value["dropdownId"]
                .as_str()
                .is_none_or(|id| !left_out.iter().any(|gone| gone == id))
    });
    let formats = formats::blocks(bases, formats)
        .into_iter()
        .map(|(rows, columns, format)| {
            let mut grouped: Vec<Ids> = Vec::new();
            for row in rows {
                if grouped.last().is_none_or(|group| group.base != row.base) {
                    grouped.push(Ids {
                        base: row.base,
                        runs: Vec::new(),
                    });
                }
                grouped
                    .last_mut()
                    .unwrap()
                    .runs
                    .push([row.first, row.count]);
            }
            CellFormat {
                rows: grouped,
                columns,
                format,
            }
        })
        .collect::<Vec<_>>();
    if !left_out.is_empty() {
        pieces.push(Piece::DropdownsLeftOut { entries: left_out });
    }
    if !formats.is_empty() {
        pieces.push(Piece::CellFormats { entries: formats });
    }
    let groups = |groups: &std::collections::BTreeMap<layout::IdKey, (String, layout::Group)>| {
        groups
            .values()
            .map(|(id, group)| {
                let mut entry = json!({"groupId": id, "ends": group.ends});
                if group.is_collapsed {
                    entry["isCollapsed"] = json!(true);
                }
                entry
            })
            .collect::<Vec<_>>()
    };
    if !sheet.row_groups.is_empty() {
        pieces.push(Piece::RowGroups {
            entries: groups(&sheet.row_groups),
        });
    }
    if !sheet.column_groups.is_empty() {
        pieces.push(Piece::ColumnGroups {
            entries: groups(&sheet.column_groups),
        });
    }
    if !is_deleted && !sheet.conditional_formats.is_empty() {
        let entries = sheet.conditional_formats.values().map(|(id, format)| json!({
            "conditionalFormatId": id, "ranges": format.ranges, "priority": format.priority, "effect": format.effect
        })).collect();
        pieces.push(Piece::ConditionalFormats { entries });
    }
    if !is_deleted && !sheet.placements.is_empty() {
        let entries = sheet
            .placements
            .values()
            .map(|(id, placement)| json!({"placementId": id, "placement": placement}))
            .collect();
        pieces.push(Piece::Placements { entries });
    }
    if !sheet.cell_tables.is_empty() {
        let entries = sheet
            .cell_tables
            .values()
            .map(|(id, table)| json!({"cellTableId": id, "cellTable": table}))
            .collect();
        pieces.push(Piece::CellTables { entries });
    }
    if !is_deleted && !sheet.named_views.is_empty() {
        let entries = sheet
            .named_views
            .values()
            .map(|(id, view)| json!({"namedViewId": id, "namedView": view}))
            .collect();
        pieces.push(Piece::NamedViews { entries });
    }
    if !is_deleted {
        pieces.extend(
            cells::written(sheet, bases)
                .into_iter()
                .map(|grid| Piece::Cells { grid }),
        );
    }
}

fn sizes_written(
    bases: &crate::ids::Bases,
    sizes: &hashbrown::HashMap<LineId, u32>,
    key: &str,
    value: &str,
) -> Vec<Json> {
    let mut ids: Vec<_> = sizes.keys().copied().collect();
    ids.sort_unstable_by_key(|id| (bases.name(id.base), id.n));
    ids.chunk_by(|before, after| sizes[before] == sizes[after])
        .flat_map(|ids| {
            let size = sizes[&ids[0]];
            crate::ids::runs_of(ids, bases)
                .into_iter()
                .map(move |run| json!({key: run, value: size}))
        })
        .collect()
}
