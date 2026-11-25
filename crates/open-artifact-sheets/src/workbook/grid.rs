//! How `setCells` writes its cells: as a list of cells, each with its ids (`cells`), or as a grid (`grid`, format 39
//! onward): the rows and columns that hold a cell set, each as its base and runs of
//! numbers (`[first, count]`), and the inputs row by row. An input is written bare when it is a number, a text or a
//! true or false (`5.0`, `"x"`, `true`), `null` when the cell is emptied, `[]` where no cell is set (a hole), and as
//! itself for a dropdown option, people or text with looks. Formulas use a shared dictionary in format 46.
//!
//! A grid is spelled one way only: bases in order (as strings), each base once, its runs in order, apart (a run that
//! goes on where the one before ends is one run) and of at least one number; every row as long as there are
//! columns; no row or column of holes; nothing written as an object that could be written bare. Any other
//! spelling is refused as unreadable.
//!
//! The rows and columns are in the order of their ids (base, then number), not as they stand on the sheet.

use std::fmt;

use hashbrown::HashSet;
use serde::de::{self, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq, Serializer};
use serde::{Deserialize, Serialize};

use super::load::CellToSet;
use super::Input;
use crate::ids::split_id;

pub(super) mod formulas;
use formulas::{Formula, Formulas};

/// The usual minimum for a grid. A large list of formulas can qualify earlier.
pub const LEAST_CELLS_OF_A_GRID: usize = 32;

/// Whether a cell edit needs its encoding chosen or has already been sized.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellForm {
    Auto,
    /// Keep the list under the edit's size budget, then consider a grid.
    ListUnlessLarge,
    List,
    Grid,
}

mod cost;
pub(crate) use cost::{listed_cell_bytes, written, GridPlan};

/// The rows and columns of a grid, the cells' places in it, in the order they are written: `None` when no grid can
/// name these cells (an id with no number, or a cell set twice).
pub struct Shape<'a> {
    pub rows: Vec<(&'a str, u32)>,
    pub columns: Vec<(&'a str, u32)>,
    /// For each cell, its row and column in the grid.
    pub places: Vec<(usize, usize)>,
}

impl<'a> Shape<'a> {
    pub fn of(cells: &'a [CellToSet]) -> Option<Shape<'a>> {
        let mut rows = Vec::with_capacity(cells.len());
        let mut columns = Vec::with_capacity(cells.len());
        for cell in cells {
            rows.push(split_id(&cell.r)?);
            columns.push(split_id(&cell.c)?);
        }
        let lines = |ids: &[(&'a str, u32)]| {
            let mut sorted = ids.to_vec();
            sorted.sort_unstable();
            sorted.dedup();
            sorted
        };
        let (row_lines, column_lines) = (lines(&rows), lines(&columns));
        let place = |lines: &[(&str, u32)], id: &(&str, u32)| lines.binary_search(id).unwrap();
        let places: Vec<(usize, usize)> =
            rows.iter().zip(&columns).map(|(r, c)| (place(&row_lines, r), place(&column_lines, c))).collect();
        let mut seen = HashSet::with_capacity(places.len());
        if !places.iter().all(|&place| seen.insert(place)) {
            return None;
        }
        Some(Shape { rows: row_lines, columns: column_lines, places })
    }
}

/// Lines (rows or columns) as a grid writes them: each base with its runs.
pub fn lines_written(lines: &[(&str, u32)]) -> Vec<(String, Vec<[u32; 2]>)> {
    let mut out: Vec<(String, Vec<[u32; 2]>)> = Vec::new();
    for &(base, n) in lines {
        match out.last_mut() {
            Some((b, runs)) if b == base => match runs.last_mut() {
                Some(run) if run[0] as u64 + run[1] as u64 == n as u64 => run[1] += 1,
                _ => runs.push([n, 1]),
            },
            _ => out.push((base.to_owned(), vec![[n, 1]])),
        }
    }
    out
}

#[derive(Serialize)]
struct LineOut<'a> {
    base: &'a str,
    runs: &'a [[u32; 2]],
}

/// One slot of a grid as written.
pub enum Slot<'a> {
    Hole,
    Cell(Option<&'a Input>),
    Formula(usize),
}

impl Serialize for Slot<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Slot::Hole => s.serialize_seq(Some(0))?.end(),
            Slot::Cell(None) => s.serialize_unit(),
            Slot::Cell(Some(Input::Number { value })) => s.serialize_f64(*value),
            Slot::Cell(Some(Input::Text { value })) => s.serialize_str(value),
            Slot::Cell(Some(Input::Boolean { value })) => s.serialize_bool(*value),
            Slot::Cell(Some(input)) => input.serialize(s),
            Slot::Formula(f) => {
                let mut map = s.serialize_map(Some(1))?;
                map.serialize_entry("f", f)?;
                map.end()
            }
        }
    }
}

struct Lines<'a>(&'a [(String, Vec<[u32; 2]>)]);

impl Serialize for Lines<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(self.0.iter().map(|(base, runs)| LineOut { base, runs }))
    }
}

struct Row<'a> {
    slots: &'a [Option<usize>],
    cells: &'a [CellToSet],
    formulas: &'a [Option<usize>],
}

impl Serialize for Row<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut seq = s.serialize_seq(Some(self.slots.len()))?;
        for slot in self.slots {
            match slot {
                Some(k) => match self.formulas[*k] {
                    Some(f) => seq.serialize_element(&Slot::Formula(f))?,
                    None => seq.serialize_element(&Slot::Cell(self.cells[*k].input.as_ref()))?,
                },
                None => seq.serialize_element(&Slot::Hole)?,
            }
        }
        seq.end()
    }
}

struct Inputs<'a> {
    slots: &'a [Option<usize>],
    width: usize,
    cells: &'a [CellToSet],
    formulas: &'a [Option<usize>],
}

impl Serialize for Inputs<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(self.slots.chunks(self.width.max(1)).map(|slots| Row {
            slots, cells: self.cells, formulas: self.formulas
        }))
    }
}

struct GridOut<'a> {
    cells: &'a [CellToSet],
    shape: &'a Shape<'a>,
}

impl Serialize for GridOut<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let width = self.shape.columns.len();
        let mut slots = vec![None; self.shape.rows.len() * width];
        for (k, &(i, j)) in self.shape.places.iter().enumerate() {
            slots[i * width + j] = Some(k);
        }
        let mut formulas = Formulas::default();
        let mut formula_slots = vec![None; self.cells.len()];
        if uses_formula_dictionary(self.cells) {
            for (at, &k) in slots.iter().enumerate().filter_map(|(at, slot)| slot.as_ref().map(|k| (at, k))) {
                if let Some(Input::Formula { formula }) = &self.cells[k].input {
                    formula_slots[k] = formulas.index(formula, self.shape.rows[at / width], self.shape.columns[at % width]);
                }
            }
        }
        let mut map = s.serialize_map(Some(3 + usize::from(!formulas.entries.is_empty())))?;
        map.serialize_entry("rows", &Lines(&lines_written(&self.shape.rows)))?;
        map.serialize_entry("columns", &Lines(&lines_written(&self.shape.columns)))?;
        if !formulas.entries.is_empty() {
            map.serialize_entry("formulas", &formulas.entries)?;
        }
        map.serialize_entry("inputs", &Inputs { slots: &slots, width, cells: self.cells, formulas: &formula_slots })?;
        map.end()
    }
}

/// Whether the write uses a grid.
pub fn is_grid(sheet_id: &str, cells: &[CellToSet], form: CellForm) -> bool {
    match form {
        CellForm::List | CellForm::ListUnlessLarge => false,
        CellForm::Grid => true,
        CellForm::Auto => (cells.len() >= LEAST_CELLS_OF_A_GRID || uses_formula_dictionary(cells))
            && GridPlan::of(sheet_id, cells, None).is_whole_grid(),
    }
}

fn grid_shape<'a>(sheet_id: &str, cells: &'a [CellToSet], form: CellForm) -> Option<Shape<'a>> {
    if is_grid(sheet_id, cells, form) { Shape::of(cells) } else { None }
}

pub(super) fn uses_formula_dictionary(cells: &[CellToSet]) -> bool {
    let mut formulas = cells.iter().filter_map(|cell| match &cell.input {
        Some(Input::Formula { formula }) => Some(formula),
        _ => None,
    }).peekable();
    formulas.peek().is_some() && formulas.all(Formula::can_write)
}

/// `setCells` as written (its `kind` aside): `sheetId`, then its cells as `cells` or `grid`. A grid is written from
/// what types, pastes, fills or copies cells (and their undoing). Dropdown conversions start with a list and consider
/// a grid when the whole edit exceeds its budget. Read back, an operation keeps the form it was written in.
pub mod set_cells {
    use super::*;

    pub fn serialize<S: Serializer>(sheet_id: &String, cells: &[CellToSet], form: &CellForm, s: S) -> Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(Some(2))?;
        map.serialize_entry("sheetId", sheet_id)?;
        match grid_shape(sheet_id, cells, *form) {
            Some(shape) => map.serialize_entry("grid", &GridOut { cells, shape: &shape })?,
            None => map.serialize_entry("cells", cells)?,
        }
        map.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<(String, Vec<CellToSet>, CellForm), D::Error> {
        d.deserialize_map(SetCellsVisitor)
    }

    struct SetCellsVisitor;

    impl<'de> Visitor<'de> for SetCellsVisitor {
        type Value = (String, Vec<CellToSet>, CellForm);

        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("setCells")
        }

        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            const FIELDS: &[&str] = &["sheetId", "cells", "grid"];
            let (mut sheet_id, mut cells) = (None, None);
            while let Some(key) = map.next_key::<String>()? {
                match key.as_str() {
                    "sheetId" if sheet_id.is_none() => sheet_id = Some(map.next_value::<String>()?),
                    "cells" if cells.is_none() => cells = Some((map.next_value::<Vec<CellToSet>>()?, CellForm::List)),
                    "grid" if cells.is_none() => cells = Some((map.next_value::<GridIn>()?.cells, CellForm::Auto)),
                    "sheetId" => return Err(de::Error::duplicate_field("sheetId")),
                    "cells" | "grid" => return Err(de::Error::custom("cells written twice")),
                    other => {
                        map.next_value::<IgnoredAny>()?;
                        return Err(de::Error::unknown_field(other, FIELDS));
                    }
                }
            }
            let sheet_id = sheet_id.ok_or_else(|| de::Error::missing_field("sheetId"))?;
            let (cells, form) = cells.ok_or_else(|| de::Error::missing_field("cells"))?;
            Ok((sheet_id, cells, form))
        }
    }
}

/// `#[serde(flatten, with = "grid::form")]`: the cells of `setCells` as written, `cells` or `grid`.
pub mod form {
    use super::*;

    pub fn serialize<S: Serializer>(cells: &[CellToSet], s: S) -> Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(Some(1))?;
        match grid_shape("", cells, CellForm::Auto) {
            Some(shape) => map.serialize_entry("grid", &GridOut { cells, shape: &shape })?,
            None => map.serialize_entry("cells", cells)?,
        }
        map.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<CellToSet>, D::Error> {
        // As a struct: flattened, the keys it reads are taken, so the operation's own check of keys passes.
        d.deserialize_struct("Cells", &["cells", "grid"], FormVisitor)
    }
}

struct FormVisitor;

impl<'de> Visitor<'de> for FormVisitor {
    type Value = Vec<CellToSet>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("cells or a grid")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut out = None;
        while let Some(key) = map.next_key::<String>()? {
            let cells = match key.as_str() {
                "cells" => map.next_value::<Vec<CellToSet>>()?,
                "grid" => map.next_value::<GridIn>()?.cells,
                other => {
                    map.next_value::<IgnoredAny>()?;
                    return Err(de::Error::unknown_field(other, &["cells", "grid"]));
                }
            };
            if out.replace(cells).is_some() {
                return Err(de::Error::custom("cells written twice"));
            }
        }
        out.ok_or_else(|| de::Error::missing_field("cells"))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LineIn {
    base: String,
    runs: Vec<(u32, u32)>,
}

/// One slot of a grid as read: a hole, or a cell's input (`None`: emptied).
enum SlotIn {
    Hole,
    Cell(Option<Input>),
    Formula(usize),
}

impl<'de> Deserialize<'de> for SlotIn {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(SlotVisitor)
    }
}

struct SlotVisitor;

impl<'de> Visitor<'de> for SlotVisitor {
    type Value = SlotIn;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an input, null or []")
    }
    fn visit_unit<E: de::Error>(self) -> Result<SlotIn, E> {
        Ok(SlotIn::Cell(None))
    }
    fn visit_none<E: de::Error>(self) -> Result<SlotIn, E> {
        Ok(SlotIn::Cell(None))
    }
    fn visit_bool<E: de::Error>(self, value: bool) -> Result<SlotIn, E> {
        Ok(SlotIn::Cell(Some(Input::Boolean { value })))
    }
    fn visit_f64<E: de::Error>(self, value: f64) -> Result<SlotIn, E> {
        Ok(SlotIn::Cell(Some(Input::Number { value })))
    }
    fn visit_u64<E: de::Error>(self, value: u64) -> Result<SlotIn, E> {
        self.visit_f64(value as f64)
    }
    fn visit_i64<E: de::Error>(self, value: i64) -> Result<SlotIn, E> {
        self.visit_f64(value as f64)
    }
    fn visit_str<E: de::Error>(self, value: &str) -> Result<SlotIn, E> {
        Ok(SlotIn::Cell(Some(Input::Text { value: value.to_owned() })))
    }
    fn visit_string<E: de::Error>(self, value: String) -> Result<SlotIn, E> {
        Ok(SlotIn::Cell(Some(Input::Text { value })))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<SlotIn, A::Error> {
        match seq.next_element::<IgnoredAny>()? {
            None => Ok(SlotIn::Hole),
            Some(_) => Err(de::Error::custom("a hole holds nothing")),
        }
    }
    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<SlotIn, A::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Index { f: usize }
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Object { Formula(Index), Input(Input) }
        match Object::deserialize(de::value::MapAccessDeserializer::new(map))? {
            Object::Formula(Index { f }) => Ok(SlotIn::Formula(f)),
            Object::Input(Input::Number { .. } | Input::Text { .. } | Input::Boolean { .. }) => {
                Err(de::Error::custom("an input written as an object that is written bare"))
            }
            Object::Input(input) => Ok(SlotIn::Cell(Some(input))),
        }
    }
}

/// A grid as read, its cells in order, row by row.
struct GridIn {
    cells: Vec<CellToSet>,
}

impl<'de> Deserialize<'de> for GridIn {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Raw {
            rows: Vec<LineIn>,
            columns: Vec<LineIn>,
            #[serde(default, deserialize_with = "super::layout::written::not_null")]
            formulas: Option<Vec<Formula>>,
            inputs: InputsIn,
        }
        let raw = Raw::deserialize(d)?;
        let formulas = raw.formulas.as_deref();
        if formulas.is_some_and(|entries| entries.is_empty() || entries.iter().collect::<HashSet<_>>().len() != entries.len()) {
            return Err(de::Error::custom("a formula dictionary has one entry for each formula"));
        }
        let inputs = raw.inputs.0;
        let rows = ids(&raw.rows, inputs.len()).ok_or_else(|| de::Error::custom("rows not spelled the one way"))?;
        let columns = ids(&raw.columns, inputs.first().map_or(0, Vec::len))
            .ok_or_else(|| de::Error::custom("columns not spelled the one way"))?;
        let fits = inputs.len() == rows.len() && inputs.iter().all(|row| row.len() == columns.len());
        let mut row_set = vec![false; rows.len()];
        let mut column_set = vec![false; columns.len()];
        if fits {
            for (i, row) in inputs.iter().enumerate() {
                for (j, slot) in row.iter().enumerate() {
                    if !matches!(slot, SlotIn::Hole) {
                        row_set[i] = true;
                        column_set[j] = true;
                    }
                }
            }
        }
        if !fits || row_set.contains(&false) || column_set.contains(&false) {
            return Err(de::Error::custom("a grid not spelled the one way"));
        }
        let mut cells = Vec::new();
        let mut used = vec![false; formulas.map_or(0, <[Formula]>::len)];
        for (i, row) in inputs.into_iter().enumerate() {
            for (j, slot) in row.into_iter().enumerate() {
                let (r, c) = (&rows[i], &columns[j]);
                let input = match slot {
                    SlotIn::Hole => continue,
                    SlotIn::Cell(Some(Input::Formula { .. })) if formulas.is_some() => {
                        return Err(de::Error::custom("a formula with a dictionary is written by index"));
                    }
                    SlotIn::Cell(input) => input,
                    SlotIn::Formula(f) => {
                        let formula = formulas.and_then(|formulas| formulas.get(f))
                            .and_then(|formula| formula.read(split_id(r)?, split_id(c)?))
                            .ok_or_else(|| de::Error::custom("unreadable grid formula"))?;
                        used[f] = true;
                        Some(Input::Formula { formula })
                    }
                };
                cells.push(CellToSet { r: r.clone(), c: c.clone(), input });
            }
        }
        if used.contains(&false) {
            return Err(de::Error::custom("the dictionary holds a formula the grid doesn't use"));
        }
        Ok(GridIn { cells })
    }
}

struct InputsIn(Vec<Vec<SlotIn>>);

impl<'de> Deserialize<'de> for InputsIn {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Vec::<Vec<SlotIn>>::deserialize(d).map(InputsIn)
    }
}

/// The ids of lines as a grid spells them, or `None` when not spelled the one way.
fn ids(lines: &[LineIn], expected: usize) -> Option<Vec<String>> {
    if lines.is_empty() || lines.windows(2).any(|w| w[0].base >= w[1].base) {
        return None;
    }
    let mut out = Vec::new();
    for line in lines {
        if line.runs.is_empty() {
            return None;
        }
        let mut end: Option<u64> = None;
        for &(first, count) in &line.runs {
            if count == 0 || first.checked_add(count - 1).is_none() || end.is_some_and(|e| first as u64 <= e)
                || out.len().checked_add(count as usize)? > expected
            {
                return None;
            }
            end = Some(first as u64 + count as u64);
            out.extend((0..count as u64).map(|k| format!("{}.{}", line.base, first as u64 + k)));
        }
    }
    Some(out)
}
