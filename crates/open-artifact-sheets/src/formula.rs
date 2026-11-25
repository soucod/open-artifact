//! Formulas as a workbook stores them, and as the evaluator reads them.
//!
//! A stored formula is its text cut at its references: `=SUM(A1:A2)*2` is kept as the pieces `["=SUM(", ")*2"]` and
//! one reference, a range from row `row_x.0` to `row_x.1` in column `col_x.0`. The references name rows, columns and
//! sheets by id, so the formula follows its cells when rows move, and its text is written again from where they are
//! now (`formulaText`). Everything between the references (function names, operators, literals) stays as typed.

pub mod parse;
pub(crate) mod pivot;

use serde::{Deserialize, Serialize};

pub use parse::{parse, BinaryOp, Expr, ParseError, UnaryOp};

/// A formula as a cell's input keeps it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredFormula {
    /// The text around the references: one piece more than there are references.
    pub text_between_references: Vec<String>,
    pub references: Vec<Reference>,
}

/// One end of a reference: a cell, its row and its column each fixed (`$`) or not.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellPoint {
    pub r: String,
    pub is_row_absolute: bool,
    pub c: String,
    pub is_column_absolute: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowPoint {
    pub r: String,
    pub is_row_absolute: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColumnPoint {
    pub c: String,
    pub is_column_absolute: bool,
}

/// A reference in a formula, always to a sheet by id (the formula's own sheet included).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Reference {
    /// `A1`
    #[serde(rename_all = "camelCase")]
    Cell { sheet_id: String, cell: CellPoint },
    /// `A1:B2`
    #[serde(rename_all = "camelCase")]
    Range { sheet_id: String, top_left: CellPoint, bottom_right: CellPoint },
    /// `A:B`, or `A2:B` from a row down (`top`).
    #[serde(rename_all = "camelCase")]
    Columns {
        sheet_id: String,
        left: ColumnPoint,
        right: ColumnPoint,
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        top: Option<RowPoint>,
    },
    /// `2:3`, or `B2:3` from a column right (`left`).
    #[serde(rename_all = "camelCase")]
    Rows {
        sheet_id: String,
        top: RowPoint,
        bottom: RowPoint,
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        left: Option<ColumnPoint>,
    },
}

impl Reference {
    pub fn sheet_id(&self) -> &str {
        match self {
            Reference::Cell { sheet_id, .. }
            | Reference::Range { sheet_id, .. }
            | Reference::Columns { sheet_id, .. }
            | Reference::Rows { sheet_id, .. } => sheet_id,
        }
    }
}

/// A column's letters: 0 → `A`, 25 → `Z`, 26 → `AA`.
pub fn column_letters(index: usize) -> String {
    let mut n = index + 1;
    let mut letters = Vec::new();
    while n > 0 {
        let m = (n - 1) % 26;
        letters.push(b'A' + m as u8);
        n = (n - 1) / 26;
    }
    letters.reverse();
    String::from_utf8(letters).expect("letters")
}

/// A column's index from its letters, in any case: `AA` → 26.
pub fn column_index(letters: &str) -> Option<usize> {
    if letters.is_empty() || letters.len() > 7 {
        return None;
    }
    let mut n: usize = 0;
    for b in letters.bytes() {
        if !b.is_ascii_alphabetic() {
            return None;
        }
        n = n * 26 + (b.to_ascii_uppercase() - b'A' + 1) as usize;
    }
    Some(n - 1)
}

/// A sheet's name as a reference writes it: quoted (`'My Sheet'!A1`) unless it reads as a plain name.
pub fn sheet_name_text(name: &str) -> String {
    if is_plain_sheet_name(name) {
        name.to_owned()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}

/// Whether a sheet name may be written without quotes: letters, digits, `_` and `.`, starting with neither a digit nor
/// a `.`. A name that reads as a reference or a boolean (`A1`, `R1C1`, `TRUE`) is written as it is.
fn is_plain_sheet_name(name: &str) -> bool {
    let Some(first) = name.chars().next() else { return false };
    !first.is_ascii_digit() && first != '.' && name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn columns() {
        assert_eq!(column_letters(0), "A");
        assert_eq!(column_letters(25), "Z");
        assert_eq!(column_letters(26), "AA");
        assert_eq!(column_letters(701), "ZZ");
        assert_eq!(column_letters(702), "AAA");
        assert_eq!(column_index("aa"), Some(26));
    }

    #[test]
    fn sheet_names() {
        assert_eq!(sheet_name_text("Other"), "Other");
        assert_eq!(sheet_name_text("My Sheet"), "'My Sheet'");
        assert_eq!(sheet_name_text("A1"), "A1");
        assert_eq!(sheet_name_text("a.b"), "a.b");
        assert_eq!(sheet_name_text(".a"), "'.a'");
        assert_eq!(sheet_name_text("it's"), "'it''s'");
    }
}
