//! A grid's shared formulas encode relative references as offsets from the cell's id numbers.

use hashbrown::HashMap;
use serde::{Deserialize, Serialize};

use crate::formula::{CellPoint, ColumnPoint, Reference, RowPoint, StoredFormula};
use crate::ids::split_id;

#[derive(Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::workbook) struct Formula {
    text_between_references: Vec<String>,
    references: Vec<CompactReference>,
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(untagged)]
enum End {
    Offset(i64),
    BaseOffset(String, i64),
    Absolute(String),
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum CompactReference {
    Cell {
        sheet_id: String,
        r: End,
        c: End,
    },
    Range {
        sheet_id: String,
        top: End,
        left: End,
        bottom: End,
        right: End,
    },
    Columns {
        sheet_id: String,
        left: End,
        right: End,
        top: Option<End>,
    },
    Rows {
        sheet_id: String,
        top: End,
        bottom: End,
        left: Option<End>,
    },
}

impl End {
    fn written(id: &str, absolute: bool, (base, number): (&str, u32)) -> Option<Self> {
        if absolute {
            return Some(Self::Absolute(id.into()));
        }
        let (other, n) = split_id(id)?;
        let offset = i64::from(n) - i64::from(number);
        Some(if other == base {
            Self::Offset(offset)
        } else {
            Self::BaseOffset(other.into(), offset)
        })
    }

    fn read(&self, (base, number): (&str, u32)) -> Option<(String, bool)> {
        let (base, offset) = match self {
            Self::Absolute(id) => return Some((id.clone(), true)),
            Self::Offset(offset) => (base, *offset),
            Self::BaseOffset(base, offset) => (base.as_str(), *offset),
        };
        let n = u32::try_from(i64::from(number).checked_add(offset)?).ok()?;
        Some((format!("{base}.{n}"), false))
    }
}

impl CompactReference {
    fn written(reference: &Reference, row: (&str, u32), column: (&str, u32)) -> Option<Self> {
        let r = |p: &RowPoint| End::written(&p.r, p.is_row_absolute, row);
        let c = |p: &ColumnPoint| End::written(&p.c, p.is_column_absolute, column);
        let rc = |p: &CellPoint| {
            Some((
                End::written(&p.r, p.is_row_absolute, row)?,
                End::written(&p.c, p.is_column_absolute, column)?,
            ))
        };
        Some(match reference {
            Reference::Cell { sheet_id, cell } => {
                let (r, c) = rc(cell)?;
                Self::Cell {
                    sheet_id: sheet_id.clone(),
                    r,
                    c,
                }
            }
            Reference::Range {
                sheet_id,
                top_left,
                bottom_right,
            } => {
                let (top, left) = rc(top_left)?;
                let (bottom, right) = rc(bottom_right)?;
                Self::Range {
                    sheet_id: sheet_id.clone(),
                    top,
                    left,
                    bottom,
                    right,
                }
            }
            Reference::Columns {
                sheet_id,
                left,
                right,
                top,
            } => Self::Columns {
                sheet_id: sheet_id.clone(),
                left: c(left)?,
                right: c(right)?,
                top: match top {
                    Some(top) => Some(r(top)?),
                    None => None,
                },
            },
            Reference::Rows {
                sheet_id,
                top,
                bottom,
                left,
            } => Self::Rows {
                sheet_id: sheet_id.clone(),
                top: r(top)?,
                bottom: r(bottom)?,
                left: match left {
                    Some(left) => Some(c(left)?),
                    None => None,
                },
            },
        })
    }

    fn read(&self, row: (&str, u32), column: (&str, u32)) -> Option<Reference> {
        let r = |end: &End| {
            let (r, is_row_absolute) = end.read(row)?;
            Some(RowPoint { r, is_row_absolute })
        };
        let c = |end: &End| {
            let (c, is_column_absolute) = end.read(column)?;
            Some(ColumnPoint {
                c,
                is_column_absolute,
            })
        };
        let rc = |row: &End, column: &End| {
            let RowPoint { r, is_row_absolute } = r(row)?;
            let ColumnPoint {
                c,
                is_column_absolute,
            } = c(column)?;
            Some(CellPoint {
                r,
                is_row_absolute,
                c,
                is_column_absolute,
            })
        };
        Some(match self {
            Self::Cell { sheet_id, r, c } => Reference::Cell {
                sheet_id: sheet_id.clone(),
                cell: rc(r, c)?,
            },
            Self::Range {
                sheet_id,
                top,
                left,
                bottom,
                right,
            } => Reference::Range {
                sheet_id: sheet_id.clone(),
                top_left: rc(top, left)?,
                bottom_right: rc(bottom, right)?,
            },
            Self::Columns {
                sheet_id,
                left,
                right,
                top,
            } => Reference::Columns {
                sheet_id: sheet_id.clone(),
                left: c(left)?,
                right: c(right)?,
                top: match top {
                    Some(top) => Some(r(top)?),
                    None => None,
                },
            },
            Self::Rows {
                sheet_id,
                top,
                bottom,
                left,
            } => Reference::Rows {
                sheet_id: sheet_id.clone(),
                top: r(top)?,
                bottom: r(bottom)?,
                left: match left {
                    Some(left) => Some(c(left)?),
                    None => None,
                },
            },
        })
    }
}

impl Formula {
    pub(super) fn can_write(formula: &StoredFormula) -> bool {
        let row = |r: &RowPoint| r.is_row_absolute || split_id(&r.r).is_some();
        let column = |c: &ColumnPoint| c.is_column_absolute || split_id(&c.c).is_some();
        let cell = |cell: &CellPoint| {
            (cell.is_row_absolute || split_id(&cell.r).is_some())
                && (cell.is_column_absolute || split_id(&cell.c).is_some())
        };
        formula.references.iter().all(|reference| match reference {
            Reference::Cell { cell: at, .. } => cell(at),
            Reference::Range {
                top_left,
                bottom_right,
                ..
            } => cell(top_left) && cell(bottom_right),
            Reference::Columns {
                left, right, top, ..
            } => column(left) && column(right) && top.as_ref().is_none_or(row),
            Reference::Rows {
                top, bottom, left, ..
            } => row(top) && row(bottom) && left.as_ref().is_none_or(column),
        })
    }

    pub(in crate::workbook) fn written(
        formula: &StoredFormula,
        row: (&str, u32),
        column: (&str, u32),
    ) -> Option<Self> {
        let references = formula
            .references
            .iter()
            .map(|reference| CompactReference::written(reference, row, column))
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            text_between_references: formula.text_between_references.clone(),
            references,
        })
    }

    pub(in crate::workbook) fn read(
        &self,
        row: (&str, u32),
        column: (&str, u32),
    ) -> Option<StoredFormula> {
        let references = self
            .references
            .iter()
            .map(|reference| reference.read(row, column))
            .collect::<Option<Vec<_>>>()?;
        if references.len() + 1 != self.text_between_references.len() {
            return None;
        }
        Some(StoredFormula {
            text_between_references: self.text_between_references.clone(),
            references,
        })
    }
}

#[derive(Default)]
pub(in crate::workbook) struct Formulas {
    pub entries: Vec<Formula>,
    indices: HashMap<String, usize>,
}

impl Formulas {
    pub fn index(
        &mut self,
        formula: &StoredFormula,
        row: (&str, u32),
        column: (&str, u32),
    ) -> Option<usize> {
        let compact = Formula::written(formula, row, column)?;
        let key = serde_json::to_string(&compact).ok()?;
        Some(*self.indices.entry(key).or_insert_with(|| {
            self.entries.push(compact);
            self.entries.len() - 1
        }))
    }
}
