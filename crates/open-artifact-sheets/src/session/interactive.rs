//! Bind an interactive view's writable inputs to live cells and compare them with their defaults.

use crate::workbook::formats::Leaf;
use crate::workbook::layout::{merged_boxes, RangeIds};
use crate::workbook::objects::{InteractiveCell, InteractiveValue, RangeOnASheet, View, ViewElement};
use crate::workbook::Workbook;

const MOST_SAVED_CELLS: usize = 200;

pub(super) struct Binding<'a> {
    workbook: &'a Workbook,
    pub sheet: usize,
    bounds: (usize, usize, usize, usize),
    merges: Vec<(usize, usize, usize, usize)>,
}

impl<'a> Binding<'a> {
    pub fn new(workbook: &'a Workbook, range: &RangeOnASheet) -> Option<Self> {
        let sheet = workbook.sheet_index(&range.sheet_id)?;
        let corners = RangeIds {
            top_left: range.top_left.clone(),
            bottom_right: range.bottom_right.clone(),
        };
        let bounds = workbook.sheets[sheet].live_box(&workbook.bases, &corners)?;
        let merges = merged_boxes(&workbook.bases, &workbook.sheets[sheet]);
        Some(Self {
            workbook,
            sheet,
            bounds,
            merges,
        })
    }

    pub fn position(&self, r: &str, c: &str) -> Option<(usize, usize)> {
        let sheet = &self.workbook.sheets[self.sheet];
        let row = sheet.rows.position(self.workbook.bases.parse(r)?)?;
        let column = sheet.columns.position(self.workbook.bases.parse(c)?)?;
        let (top, bottom, left, right) = self.bounds;
        ((top..=bottom).contains(&row) && (left..=right).contains(&column)).then_some((row, column))
    }

    pub fn at_offset(&self, row: usize, column: usize) -> Option<(usize, usize)> {
        let (top, bottom, left, right) = self.bounds;
        let (r, c) = (top.checked_add(row)?, left.checked_add(column)?);
        (r <= bottom && c <= right).then_some((r, c))
    }

    pub fn is_covered(&self, (row, column): (usize, usize)) -> bool {
        self.merges
            .iter()
            .any(|&(t, b, l, r)| (t..=b).contains(&row) && (l..=r).contains(&column) && (row, column) != (t, l))
    }

    pub fn fits(&self, (row, column): (usize, usize), value: Option<&InteractiveValue>) -> bool {
        let sheet = &self.workbook.sheets[self.sheet];
        let Some(ids) = sheet.rows.line(row).zip(sheet.columns.line(column)) else {
            return false;
        };
        let control = sheet.formats.get(Leaf::CellControl, ids);
        match (control.and_then(|format| format["kind"].as_str()), value) {
            (_, None) | (None | Some("none"), _) => true,
            (Some("checkbox"), Some(InteractiveValue::Boolean { .. })) => true,
            _ => false,
        }
    }

    pub fn read(&self, (row, column): (usize, usize)) -> Result<InteractiveCell, ()> {
        let sheet = &self.workbook.sheets[self.sheet];
        let r = sheet.rows.line(row).ok_or(())?;
        let c = sheet.columns.line(column).ok_or(())?;
        let value = InteractiveValue::from_input(sheet.cells.get(&(r, c)).map(|cell| &cell.input))?;
        Ok(InteractiveCell {
            r: self.workbook.bases.text(r),
            c: self.workbook.bases.text(c),
            value,
        })
    }

    fn defaults(&self, most: usize) -> Result<Vec<InteractiveCell>, ()> {
        let (top, bottom, left, right) = self.bounds;
        let cells: Vec<_> = (top..=bottom)
            .flat_map(|r| (left..=right).map(move |c| (r, c)))
            .filter(|&at| !self.is_covered(at))
            .filter_map(|at| self.read(at).ok())
            .take(most + 1)
            .collect();
        if cells.len() > most {
            Err(())
        } else {
            Ok(cells)
        }
    }
}

pub(super) fn reset_changes(workbook: &Workbook, view: &View) -> Vec<(usize, (usize, usize), InteractiveCell)> {
    let mut changes = Vec::new();
    for element in &view.elements {
        let ViewElement::Interactive { inputs, writes, .. } = element else {
            continue;
        };
        for write in writes {
            let Some(range) = inputs
                .iter()
                .find(|input| input.name == write.input)
                .map(|input| &input.range)
            else {
                continue;
            };
            let Some(binding) = Binding::new(workbook, range) else {
                continue;
            };
            for saved in &write.saved {
                let Some(at) = binding.position(&saved.r, &saved.c) else {
                    continue;
                };
                let Ok(current) = binding.read(at) else {
                    continue;
                };
                if saved.value != current.value && !binding.is_covered(at) && binding.fits(at, saved.value.as_ref()) {
                    changes.push((binding.sheet, at, saved.clone()));
                }
            }
        }
    }
    changes
}

pub(super) fn with_current_defaults(workbook: &Workbook, view: &View) -> Result<View, ()> {
    let mut view = view.clone();
    let mut remaining = MOST_SAVED_CELLS;
    for element in &mut view.elements {
        let ViewElement::Interactive { inputs, writes, .. } = element else {
            continue;
        };
        for write in writes {
            let binding = inputs
                .iter()
                .find(|input| input.name == write.input)
                .and_then(|input| Binding::new(workbook, &input.range));
            if let Some(binding) = binding {
                write.saved = binding.defaults(remaining)?;
            }
            remaining = remaining.checked_sub(write.saved.len()).ok_or(())?;
        }
    }
    Ok(view)
}
