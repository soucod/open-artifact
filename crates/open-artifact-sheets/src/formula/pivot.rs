//! PIVOT's stored arguments and editable specification.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

use super::{CellPoint, ColumnPoint, Expr, Reference, RowPoint, StoredFormula, UnaryOp};
use crate::value::{number_text, CellError, Value};
use crate::workbook::layout::CellIds;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Source {
    pub sheet_id: String,
    pub header_row: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Spec {
    pub source: Source,
    pub rows: Vec<Axis<String>>,
    #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
    pub columns: Option<Axis<String>>,
    pub values: Vec<Measure<String>>,
    pub filters: Vec<Filter<String, Listed>>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Axis<C> {
    pub column: C,
    #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
    pub by: Option<Period>,
    pub order: Order,
    #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
    pub name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Measure<C> {
    pub column: C,
    pub total: Total,
    #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
    pub order: Option<Order>,
    #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
    pub name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Filter<C, L> {
    pub column: C,
    pub keeps: Keeps,
    pub listed: L,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Listed {
    Written {
        values: Vec<Option<WrittenValue>>,
    },
    #[serde(rename_all = "camelCase")]
    InACell {
        sheet_id: String,
        cell: CellIds,
    },
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum WrittenValue {
    Number { value: f64 },
    Text { value: String },
    Boolean { value: bool },
    Error { value: CellError },
}

impl WrittenValue {
    pub fn from_value(value: &Value) -> Option<Self> {
        Some(match value {
            Value::Blank => return None,
            Value::Text(value) if value.trim().is_empty() => return None,
            Value::Text(value) => Self::Text {
                value: value.to_string(),
            },
            Value::Number(value) => Self::Number { value: *value },
            Value::Boolean(value) => Self::Boolean { value: *value },
            Value::Error(value) => Self::Error { value: *value },
        })
    }

    pub fn value(&self) -> Value {
        match self {
            Self::Number { value } => Value::number(*value),
            Self::Text { value } => Value::text(value.as_str()),
            Self::Boolean { value } => Value::Boolean(*value),
            Self::Error { value } => Value::Error(*value),
        }
    }

    fn literal(&self) -> String {
        match self {
            Self::Number { value } => number_text(*value),
            Self::Text { value } => quoted(value),
            Self::Boolean { value } => if *value { "TRUE" } else { "FALSE" }.to_owned(),
            Self::Error { value } => value.text().to_owned(),
        }
    }
}

/// Pivots compare text case-insensitively and keep its spacing and kind. Whitespace-only cells share a blank group.
#[derive(Clone, Hash, PartialEq, Eq)]
pub(crate) enum Key {
    Number(u64),
    Text(String),
    Boolean(bool),
    Error(CellError),
    Blank,
}

impl Key {
    pub fn of(value: &Value) -> Self {
        match value {
            Value::Blank => Self::Blank,
            Value::Number(n) => Self::Number((n + 0.0).to_bits()),
            Value::Boolean(b) => Self::Boolean(*b),
            Value::Error(e) => Self::Error(*e),
            Value::Text(t) if t.trim().is_empty() => Self::Blank,
            Value::Text(t) => Self::Text(t.to_lowercase()),
        }
    }

    pub fn cmp(&self, other: &Self, order: Order) -> Ordering {
        use Key::*;
        let rank = |key: &Key| match key {
            Number(_) => 0,
            Text(_) => 1,
            Boolean(_) => 2,
            Error(_) => 3,
            Blank => 4,
        };
        let order_of = rank(self).cmp(&rank(other)).then_with(|| match (self, other) {
            (Number(x), Number(y)) => f64::from_bits(*x).total_cmp(&f64::from_bits(*y)),
            (Text(x), Text(y)) => x.cmp(y),
            (Boolean(x), Boolean(y)) => x.cmp(y),
            // Errors by how they are written (#DIV/0!, #N/A, #NUM!).
            (Error(x), Error(y)) => x.text().cmp(y.text()),
            _ => Ordering::Equal,
        });
        // Errors and blanks come last in either order.
        let last = |key: &Key| matches!(key, Error(_) | Blank);
        if order == Order::Descending && !last(self) && !last(other) {
            order_of.reverse()
        } else {
            order_of
        }
    }
}

macro_rules! words {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
        #[serde(rename_all = "camelCase")]
        pub(crate) enum $name { $($variant),+ }

        impl $name {
            fn from_word(word: &str) -> Option<Self> {
                $(if word.eq_ignore_ascii_case($text) { return Some(Self::$variant); })+
                None
            }

            pub fn word(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }
        }
    };
}

words!(Period { Day => "day", Month => "month", Quarter => "quarter", Year => "year" });
words!(Order { Ascending => "ascending", Descending => "descending" });
words!(Total {
    Sum => "sum", Count => "count", DistinctCount => "distinct count", Average => "average",
    Min => "min", Max => "max", ShareOfTotal => "share of total",
});
words!(Keeps { OneOf => "is one of", NoneOf => "is none of" });

impl Total {
    pub fn needs_numbers(self) -> bool {
        !matches!(self, Self::Count | Self::DistinctCount)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Sum => "Sum of",
            Self::Count => "Count of",
            Self::DistinctCount => "Distinct count of",
            Self::Average => "Average of",
            Self::Min => "Smallest of",
            Self::Max => "Largest of",
            Self::ShareOfTotal => "% of",
        }
    }
}

impl<C> Axis<C> {
    fn map<D>(&self, column: D) -> Axis<D> {
        Axis {
            column,
            by: self.by,
            order: self.order,
            name: self.name.clone(),
        }
    }
}

impl<C> Measure<C> {
    fn map<D>(&self, column: D) -> Measure<D> {
        Measure {
            column,
            total: self.total,
            order: self.order,
            name: self.name.clone(),
        }
    }
}

impl Spec {
    pub fn columns_used(&self) -> impl Iterator<Item = &str> {
        self.columns
            .iter()
            .chain(&self.rows)
            .map(|axis| axis.column.as_str())
            .chain(self.values.iter().map(|measure| measure.column.as_str()))
            .chain(self.filters.iter().map(|filter| filter.column.as_str()))
    }

    pub fn readable(&self) -> bool {
        !self.values.is_empty()
            && self.filters.iter().all(|f| match &f.listed {
                Listed::Written { values } => !values.is_empty(),
                Listed::InACell { .. } => true,
            })
    }

    pub fn stored(&self) -> StoredFormula {
        let mut writer = Writer {
            source: &self.source,
            stored: StoredFormula {
                text_between_references: Vec::new(),
                references: Vec::new(),
            },
            text: "=PIVOT(".to_owned(),
        };
        if let Some(columns) = &self.columns {
            writer.axis(columns);
        }
        for rows in &self.rows {
            writer.word("rows");
            writer.axis(rows);
        }
        for measure in &self.values {
            writer.word(measure.total.word());
            writer.column(&measure.column);
            writer.options(None, measure.order, measure.name.as_deref());
        }
        for filter in &self.filters {
            writer.word("where");
            writer.column(&filter.column);
            writer.word(filter.keeps.word());
            writer.text.push(',');
            match &filter.listed {
                Listed::Written { values } => {
                    let list = values
                        .iter()
                        .map(|v| v.as_ref().map_or_else(|| quoted(""), WrittenValue::literal))
                        .collect::<Vec<_>>()
                        .join(",");
                    writer.text.push_str(&format!("{{{list}}}"));
                }
                Listed::InACell { sheet_id, cell } => writer.reference(Reference::Cell {
                    sheet_id: sheet_id.clone(),
                    cell: CellPoint {
                        r: cell.r.clone(),
                        c: cell.c.clone(),
                        is_row_absolute: false,
                        is_column_absolute: false,
                    },
                }),
            }
        }
        writer.text.push(')');
        writer.stored.text_between_references.push(writer.text);
        writer.stored
    }
}

struct Writer<'a> {
    source: &'a Source,
    stored: StoredFormula,
    text: String,
}

fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('"', "\"\""))
}

impl Writer<'_> {
    fn word(&mut self, word: &str) {
        self.text.push(',');
        self.text.push_str(&quoted(word));
    }

    fn reference(&mut self, reference: Reference) {
        self.stored.text_between_references.push(std::mem::take(&mut self.text));
        self.stored.references.push(reference);
    }

    fn column(&mut self, c: &str) {
        if !self.text.ends_with('(') {
            self.text.push(',');
        }
        let column = ColumnPoint {
            c: c.to_owned(),
            is_column_absolute: true,
        };
        self.reference(Reference::Columns {
            sheet_id: self.source.sheet_id.clone(),
            top: Some(RowPoint {
                r: self.source.header_row.clone(),
                is_row_absolute: true,
            }),
            left: column.clone(),
            right: column,
        });
    }

    fn options(&mut self, by: Option<Period>, order: Option<Order>, name: Option<&str>) {
        if let Some(by) = by {
            self.word("by");
            self.word(by.word());
        }
        if let Some(order) = order {
            self.word("order");
            self.word(order.word());
        }
        if let Some(name) = name {
            self.word("named");
            self.word(name);
        }
    }

    fn axis(&mut self, axis: &Axis<String>) {
        self.column(&axis.column);
        self.options(
            axis.by,
            (axis.order != Order::Ascending).then_some(axis.order),
            axis.name.as_deref(),
        );
    }
}

pub(crate) struct Formula {
    pub rows: Vec<Axis<usize>>,
    pub columns: Option<Axis<usize>>,
    pub values: Vec<Measure<usize>>,
    pub filters: Vec<Filter<usize, Criterion>>,
}

/// Why a PIVOT formula is not read, as `readCauseOfError` tells it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum NotRead {
    /// A word in it no PIVOT reads there (`wordIsNotRead`): of what to do, or of an option.
    Word(String),
    /// No total (`pivotTotalsNothing`).
    TotalsNothing,
    /// Columns and more than one total (`pivotWithColumnsTotalsSeveral`).
    WithColumnsTotalsSeveral,
    /// Several values (an array, or a range worked out) where a use goes, or what a `where` keeps
    /// (`severalCellsForOneValue` of the use).
    SeveralValues,
    /// Anything else: the cause is found as for any function.
    Other,
}

pub(crate) enum Criterion {
    Values(Vec<Value>),
    Reference(usize),
}

impl Formula {
    pub fn from_expr(expr: &Expr) -> Option<Result<Self, CellError>> {
        match expr {
            Expr::Call { name, arguments, .. } if name.as_ref() == "PIVOT" => Some(Self::read(arguments)),
            _ => None,
        }
    }

    pub fn read(arguments: &[Expr]) -> Result<Self, CellError> {
        Self::read_telling_why(arguments).map_err(|(error, _)| error)
    }

    /// The formula read, or its error and why it is not read (`readCauseOfError`).
    pub fn read_telling_why(arguments: &[Expr]) -> Result<Self, (CellError, NotRead)> {
        let other = |error| (error, NotRead::Other);
        let word_not_read = |word: &str| (CellError::Value, NotRead::Word(word.to_owned()));
        if count_is_wrong(arguments.len()) {
            return Err(other(CellError::NotAvailable));
        }
        let mut args = arguments.iter().peekable();
        let columns = match args.next() {
            Some(Expr::Missing) => None,
            Some(Expr::Reference(column)) => Some(read_axis(*column, &mut args)?),
            _ => return Err(other(CellError::Value)),
        };
        let mut pivot = Self {
            columns,
            rows: Vec::new(),
            values: Vec::new(),
            filters: Vec::new(),
        };
        while let Some(argument) = args.next() {
            let word = match argument {
                Expr::Text(word) => word.to_string(),
                Expr::Number(_) | Expr::Boolean(_) => return Err(word_not_read(&option_text(argument).unwrap_or_default())),
                Expr::Missing => return Err(other(CellError::Value)),
                // What is left of an argument worked out where one value goes is several (`pivot_read`).
                _ => return Err((CellError::Value, NotRead::SeveralValues)),
            };
            // A word it does not read is told before what follows it.
            if !word.eq_ignore_ascii_case("rows") && !word.eq_ignore_ascii_case("where") && Total::from_word(&word).is_none() {
                return Err(word_not_read(&word));
            }
            let column = match args.next() {
                Some(Expr::Reference(column)) => *column,
                _ => return Err(other(CellError::Value)),
            };
            if word.eq_ignore_ascii_case("rows") {
                pivot.rows.push(read_axis(column, &mut args)?);
            } else if word.eq_ignore_ascii_case("where") {
                let keeps = match args.next() {
                    Some(argument) if several(argument) => return Err((CellError::Value, NotRead::SeveralValues)),
                    argument => argument.and_then(as_text).and_then(Keeps::from_word).ok_or_else(|| word_not_read(&word))?,
                };
                let listed = match args.next().ok_or_else(|| word_not_read(&word))? {
                    Expr::Array(array) => Criterion::Values(array.values().cloned().collect()),
                    Expr::Reference(i) => Criterion::Reference(*i),
                    other => Criterion::Values(vec![scalar(other).ok_or_else(|| word_not_read(&word))?]),
                };
                pivot.filters.push(Filter { column, keeps, listed });
            } else {
                let total = Total::from_word(&word).ok_or_else(|| word_not_read(&word))?;
                let (by, order, name) = options(&mut args)?;
                if by.is_some() {
                    return Err(word_not_read("by"));
                }
                pivot.values.push(Measure {
                    column,
                    total,
                    order,
                    name,
                });
            }
        }
        match pivot.values.len() {
            0 => Err((CellError::Value, NotRead::TotalsNothing)),
            1 => Ok(pivot),
            _ if pivot.columns.is_some() => Err((CellError::Value, NotRead::WithColumnsTotalsSeveral)),
            _ => Ok(pivot),
        }
    }

    pub fn columns_used(&self) -> impl Iterator<Item = usize> + '_ {
        self.columns
            .iter()
            .chain(&self.rows)
            .map(|axis| axis.column)
            .chain(self.values.iter().map(|measure| measure.column))
            .chain(self.filters.iter().map(|filter| filter.column))
    }

    pub fn specification(&self, references: &[Reference]) -> Option<Spec> {
        let (source, _, end) = source_column(references.get(self.values.first()?.column)?)?;
        let column = |i| {
            let (from, column, last) = source_column(references.get(i)?)?;
            (from == source && last == end).then_some(column)
        };
        let columns = match &self.columns {
            Some(axis) => Some(axis.map(column(axis.column)?)),
            None => None,
        };
        let rows = self
            .rows
            .iter()
            .map(|axis| Some(axis.map(column(axis.column)?)))
            .collect::<Option<_>>()?;
        let values = self
            .values
            .iter()
            .map(|value| Some(value.map(column(value.column)?)))
            .collect::<Option<_>>()?;
        let filters = self
            .filters
            .iter()
            .map(|filter| {
                let listed = match &filter.listed {
                    Criterion::Values(values) => Listed::Written {
                        values: values.iter().map(WrittenValue::from_value).collect(),
                    },
                    Criterion::Reference(i) => match references.get(*i)? {
                        Reference::Cell { sheet_id, cell } => Listed::InACell {
                            sheet_id: sheet_id.clone(),
                            cell: CellIds {
                                r: cell.r.clone(),
                                c: cell.c.clone(),
                            },
                        },
                        _ => return None,
                    },
                };
                Some(Filter {
                    column: column(filter.column)?,
                    keeps: filter.keeps,
                    listed,
                })
            })
            .collect::<Option<_>>()?;
        Some(Spec {
            source,
            rows,
            columns,
            values,
            filters,
        })
    }
}

/// One column's header and optional last row in an editable formula.
pub(crate) fn source_column(reference: &Reference) -> Option<(Source, String, Option<&str>)> {
    let (sheet_id, header_row, column, last_row) = match reference {
        Reference::Columns {
            sheet_id,
            left,
            right,
            top: Some(top),
        } if left.c == right.c => (sheet_id, &top.r, &left.c, None),
        Reference::Range {
            sheet_id,
            top_left,
            bottom_right,
        } if top_left.c == bottom_right.c => (sheet_id, &top_left.r, &top_left.c, Some(bottom_right.r.as_str())),
        _ => return None,
    };
    Some((
        Source {
            sheet_id: sheet_id.clone(),
            header_row: header_row.clone(),
        },
        column.clone(),
        last_row,
    ))
}

type Arguments<'a> = std::iter::Peekable<std::slice::Iter<'a, Expr>>;

fn as_text(expr: &Expr) -> Option<&str> {
    match expr {
        Expr::Text(value) => Some(value),
        _ => None,
    }
}

fn read_axis(column: usize, args: &mut Arguments<'_>) -> Result<Axis<usize>, (CellError, NotRead)> {
    let (by, order, name) = options(args)?;
    Ok(Axis {
        column,
        by,
        order: order.unwrap_or(Order::Ascending),
        name,
    })
}

fn options(args: &mut Arguments<'_>) -> Result<(Option<Period>, Option<Order>, Option<String>), (CellError, NotRead)> {
    let (mut by, mut order, mut name) = (None, None, None);
    // A blank value is no word.
    let not_read = |value: &str| (CellError::Value, if value.is_empty() { NotRead::Other } else { NotRead::Word(value.to_owned()) });
    while let Some(word) = args.peek().and_then(|argument| as_text(argument)) {
        let option = word.to_ascii_lowercase();
        if !matches!(option.as_str(), "by" | "order" | "named") {
            break;
        }
        args.next();
        // A number or TRUE is read as it is written; an option given again is the one taken; several values are the
        // option's word not read.
        let value = match args.next() {
            Some(argument) if several(argument) => return Err((CellError::Value, NotRead::Word(word.to_owned()))),
            argument => argument.and_then(option_text).ok_or((CellError::Value, NotRead::Other))?,
        };
        match option.as_str() {
            "by" => by = Some(Period::from_word(&value).ok_or_else(|| not_read(&value))?),
            "order" => order = Some(Order::from_word(&value).ok_or_else(|| not_read(&value))?),
            _ => name = Some(value),
        }
    }
    Ok((by, order, name))
}

/// Whether PIVOT is given a number of arguments it does not take: the columns field, then pairs of a use (a total, or
/// `rows`, `where`, an option) and a field (#N/A, the cause told as for any function's arguments).
pub fn count_is_wrong(given: usize) -> bool {
    given < 3 || given % 2 == 0
}

/// The arguments' missing one or half pair as `readCauseOfError` tells it, when their number is wrong.
pub fn count_of_arguments(given: usize) -> Option<serde_json::Value> {
    let missing = |argument: &str| serde_json::json!({"kind": "argumentIsMissing", "function": "PIVOT", "argument": argument});
    count_is_wrong(given).then(|| match given {
        0 => missing("columns field"),
        1 => missing("use"),
        2 => missing("field"),
        _ => serde_json::json!({"kind": "pairIsIncomplete", "function": "PIVOT", "first": "use", "second": "field"}),
    })
}

/// An option's value, or a word, as text: a number as it is written, TRUE or FALSE, a blank cell's as none.
fn option_text(expr: &Expr) -> Option<String> {
    match expr {
        Expr::Missing => Some(String::new()),
        Expr::Text(text) => Some(text.to_string()),
        Expr::Number(n) => Some(number_text(*n)),
        Expr::Boolean(b) => Some(if *b { "TRUE" } else { "FALSE" }.to_owned()),
        _ => None,
    }
}

/// Whether an argument read where one value goes is several: an array, or what is left of one worked out.
fn several(expr: &Expr) -> bool {
    !matches!(expr, Expr::Missing | Expr::Text(_) | Expr::Number(_) | Expr::Boolean(_))
}

fn scalar(expr: &Expr) -> Option<Value> {
    Some(match expr {
        Expr::Text(value) => Value::Text(value.clone()),
        Expr::Number(value) => Value::number(*value),
        Expr::Boolean(value) => Value::Boolean(*value),
        Expr::Error(value) => Value::Error(*value),
        Expr::Missing => Value::Blank,
        Expr::Unary(op @ (UnaryOp::Negate | UnaryOp::Plus), inner) => {
            let Value::Number(n) = scalar(inner)? else { return None };
            Value::number(if *op == UnaryOp::Negate { -n } else { n })
        }
        _ => return None,
    })
}
