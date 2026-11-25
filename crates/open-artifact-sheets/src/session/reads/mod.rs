//! The page's reads: requests that read the workbook shown and change nothing. Each family has a module of its own
//! with `KINDS` (the requests it answers) and `answer` (the request, read strictly, answered
//! as text: the answer, or `{"kind": "refused", "refusal": …}`).

use serde_json::Value as Json;

use crate::workbook::Workbook;

mod cells;
pub(super) mod clipboard;
pub(super) mod formats;
mod lines;
mod objects;
pub(crate) mod pivot;
pub(crate) mod tables;
mod xlsx;

/// Whether a request is one of the reads.
pub fn is_read(kind: &str) -> bool {
    [cells::KINDS, clipboard::KINDS, formats::KINDS, lines::KINDS, tables::KINDS, objects::KINDS, pivot::KINDS, xlsx::KINDS].iter().any(|kinds| kinds.contains(&kind))
}

/// Whether a read works the formulas out first, even when the page asked to be answered before calculating: the
/// .xlsx file holds every value as it comes to (a request that does not read is refused as it is), and a proposed
/// formula reads the others as they come to.
pub fn works_formulas_out(workbook: &Workbook, request: &Json) -> bool {
    xlsx::reads(request) || cells::works_formulas_out(workbook, request)
}

/// A read answered, the workbook as it is shown (its formulas worked out as far as the session has).
pub fn answer(workbook: &Workbook, request: &Json) -> String {
    let kind = request.get("kind").and_then(Json::as_str).unwrap_or("");
    if cells::KINDS.contains(&kind) {
        cells::answer(workbook, request)
    } else if clipboard::KINDS.contains(&kind) {
        clipboard::answer(workbook, request)
    } else if formats::KINDS.contains(&kind) {
        formats::answer(workbook, request)
    } else if lines::KINDS.contains(&kind) {
        lines::answer(workbook, request)
    } else if tables::KINDS.contains(&kind) {
        tables::answer(workbook, request)
    } else if objects::KINDS.contains(&kind) {
        objects::answer(workbook, request)
    } else if pivot::KINDS.contains(&kind) {
        pivot::answer(workbook, request)
    } else {
        xlsx::answer(workbook, request)
    }
}

/// Whether a read goes by the session's clock: the formats given, and the suggestions for conditional formats.
pub fn reads_the_clock(request: &Json) -> bool {
    formats::reads_the_clock(request) || objects::reads_the_clock(request)
}

/// A read that goes by the session's clock answered, `now` the clock reading in the workbook's time zone.
pub fn answer_at(workbook: &Workbook, request: &Json, now: Option<f64>) -> String {
    if objects::reads_the_clock(request) {
        objects::answer_at(workbook, request, now)
    } else {
        formats::answer_at(workbook, request, now)
    }
}

/// The answer to a request that cannot be read.
pub fn unreadable() -> String {
    r#"{"kind":"refused","refusal":"unreadableRequest"}"#.to_owned()
}
