use std::io::{self, Write};

use hashbrown::HashSet;
use serde::Serialize;

use super::{Formula, Slot, LEAST_CELLS_OF_A_GRID};
use crate::ids::split_id;
use crate::workbook::{load::CellToSet, Input};

const FORMULA_LIST_BYTES: usize = 3 * 1024;
const MAX_GRID_COLUMNS: usize = 1024;
const MAX_BASE_BYTES: usize = 64;

/// The cells eligible for the grid, in the order the edit encounters them. A far column can
/// leave some cells in a separate list even when the rest of the grid saves space.
pub(crate) struct GridPlan {
    pub accepted: Vec<bool>,
    pub use_grid: bool,
    pub bytes: usize,
}

impl GridPlan {
    pub fn of(sheet_id: &str, cells: &[CellToSet], old: Option<&[CellToSet]>) -> Self {
        let sheet_bytes = written(sheet_id);
        let mut grid = Cost {
            listed: sheet_bytes + 41,
            grid_bytes: sheet_bytes + 74,
            listed_outside: sheet_bytes + 42,
            ..Cost::default()
        };
        let accepted = cells
            .iter()
            .enumerate()
            .map(|(i, cell)| {
                let old = old
                    .and_then(|entries| entries.get(i))
                    .and_then(|entry| entry.input.as_ref());
                grid.add(cell, old)
            })
            .collect();
        let grid_bytes = grid.estimated_grid_bytes();
        let use_grid = grid.prefers_grid(grid_bytes);
        let bytes = if use_grid { grid_bytes } else { grid.listed };
        Self {
            accepted,
            use_grid,
            bytes,
        }
    }

    pub fn is_whole_grid(&self) -> bool {
        self.use_grid && self.accepted.iter().all(|accepted| *accepted)
    }
}

#[derive(Default)]
struct Cost<'a> {
    rows: Axis<'a>,
    columns: Axis<'a>,
    cells: HashSet<((&'a str, u32), (&'a str, u32))>,
    formulas: usize,
    new_formulas: HashSet<String>,
    old_formulas: HashSet<String>,
    listed: usize,
    grid_bytes: usize,
    listed_outside: usize,
    formula_weight: usize,
}

impl<'a> Cost<'a> {
    fn add(&mut self, cell: &'a CellToSet, old: Option<&Input>) -> bool {
        let new = cell.input.as_ref();
        let listed = listed_cell_bytes(cell, old).saturating_add(1);
        self.listed = self.listed.saturating_add(listed);
        if self.add_to_grid(cell, new, old, listed) {
            return true;
        }
        self.listed_outside = self.listed_outside.saturating_add(listed);
        false
    }

    fn add_to_grid(
        &mut self,
        cell: &'a CellToSet,
        new: Option<&Input>,
        old: Option<&Input>,
        listed: usize,
    ) -> bool {
        let (Some(row), Some(column)) = (split_id(&cell.r), split_id(&cell.c)) else {
            return false;
        };
        if row.0.len() > MAX_BASE_BYTES
            || column.0.len() > MAX_BASE_BYTES
            || self.cells.contains(&(row, column))
        {
            return false;
        }
        let column_cost = self.columns.price(column);
        let rows = self.rows.lines.len();
        let columns = self.columns.lines.len();
        if column_cost != 0
            && (columns >= MAX_GRID_COLUMNS
                || (3 * rows > listed && self.holes().saturating_add(rows) > self.cells.len()))
        {
            return false;
        }
        let (Some(new_slot), Some(old_slot)) = (
            GridSlot::of(new, row, column),
            GridSlot::of(old, row, column),
        ) else {
            return false;
        };
        let row_cost = self.rows.price(row);
        self.rows.insert(row);
        self.columns.insert(column);
        self.cells.insert((row, column));
        if matches!(new_slot, GridSlot::Formula(_)) || matches!(old_slot, GridSlot::Formula(_)) {
            if self.formulas == 0 {
                self.grid_bytes += 14;
            }
            self.formulas += 1;
        }
        let slot = new_slot
            .cost(&mut self.new_formulas)
            .max(old_slot.cost(&mut self.old_formulas));
        self.grid_bytes = self
            .grid_bytes
            .saturating_add(row_cost + usize::from(row_cost != 0) * 3 + column_cost + slot + 1);
        self.formula_weight = self
            .formula_weight
            .saturating_add(formula_weight(new).max(formula_weight(old)));
        true
    }

    fn holes(&self) -> usize {
        self.rows
            .lines
            .len()
            .saturating_mul(self.columns.lines.len())
            .saturating_sub(self.cells.len())
    }

    fn prefers_grid(&self, grid_bytes: usize) -> bool {
        let cells = self.cells.len();
        let may_use_grid = cells >= LEAST_CELLS_OF_A_GRID
            || (self.formulas != 0 && self.listed > FORMULA_LIST_BYTES);
        may_use_grid && grid_bytes < self.listed
    }

    fn estimated_grid_bytes(&self) -> usize {
        let formula_digits = digits(self.new_formulas.len().max(self.old_formulas.len()));
        self.grid_bytes
            .saturating_add(3usize.saturating_mul(self.holes()))
            .saturating_add(self.formulas.saturating_mul(formula_digits))
            .max(12usize.saturating_mul(self.cells.len()))
            .max(self.formula_weight)
            .saturating_add(self.listed_outside)
    }
}

#[derive(Default)]
struct Axis<'a> {
    lines: HashSet<(&'a str, u32)>,
    bases: HashSet<&'a str>,
}

impl<'a> Axis<'a> {
    fn price(&self, (base, index): (&str, u32)) -> usize {
        if self.lines.contains(&(base, index)) {
            return 0;
        }
        if !self.bases.contains(base) {
            return written(base) + 25 + digits(index as usize);
        }
        let has_neighbor = index
            .checked_sub(1)
            .is_some_and(|i| self.lines.contains(&(base, i)))
            || index
                .checked_add(1)
                .is_some_and(|i| self.lines.contains(&(base, i)));
        if has_neighbor {
            1
        } else {
            5 + digits(index as usize)
        }
    }

    fn insert(&mut self, (base, index): (&'a str, u32)) {
        self.bases.insert(base);
        self.lines.insert((base, index));
    }
}

enum GridSlot {
    Bare(usize),
    Formula(String),
}

impl GridSlot {
    fn of(input: Option<&Input>, row: (&str, u32), column: (&str, u32)) -> Option<Self> {
        match input {
            Some(Input::Formula { formula }) => {
                let compact = Formula::written(formula, row, column)?;
                Some(Self::Formula(serde_json::to_string(&compact).ok()?))
            }
            _ => Some(Self::Bare(written(&Slot::Cell(input)))),
        }
    }

    fn cost(self, seen: &mut HashSet<String>) -> usize {
        match self {
            Self::Bare(bytes) => bytes,
            Self::Formula(formula) => {
                let bytes = formula.len();
                // Each slot has six bytes around the index. The dictionary entry is counted once.
                if seen.insert(formula) {
                    bytes + 7
                } else {
                    6
                }
            }
        }
    }
}

fn formula_weight(input: Option<&Input>) -> usize {
    match input {
        Some(Input::Formula { formula }) => {
            let text_bytes = formula
                .text_between_references
                .iter()
                .map(String::len)
                .sum::<usize>();
            5 * formula.references.len() + text_bytes.div_ceil(4)
        }
        _ => 0,
    }
}

fn digits(n: usize) -> usize {
    n.checked_ilog10().map_or(1, |log| log as usize + 1)
}

pub(crate) fn listed_cell_bytes(cell: &CellToSet, old: Option<&Input>) -> usize {
    let old_extra = written(&old).saturating_sub(written(&cell.input));
    written(cell).saturating_add(old_extra)
}

pub(crate) fn written<T: Serialize + ?Sized>(value: &T) -> usize {
    #[derive(Default)]
    struct Counter(usize);
    impl Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0 = self.0.saturating_add(bytes.len());
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut count = Counter::default();
    serde_json::to_writer(&mut count, value).map_or(usize::MAX, |()| count.0)
}
