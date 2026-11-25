//! The wasm-bindgen face of open-artifact-sheets, compiled only for wasm32: what the Sheets page's worker
//! (`workbook-worker.js`) and Node load. Everything crosses as JSON text: a request goes in, its answer comes out.
//!
//! - `WorkbookSession` (`new`, `answerJson`, `answerWithCells`): one workbook and every request about it;
//! - `answerUtilityRequestJson`: the requests that need no workbook (locales, number formats, time zones, …);
//! - `functionDescriptionsJson`: the functions a formula may call, for the page's formula help;
//! - `start`: runs once when the module is instantiated, and sends panics to `console.error`.
//!
//! The packed cell reads (`readWorkbookWithCellsPacked`, `readRowsWithCellsPacked`) answer JSON that indexes cell
//! blocks; `answerWithCells` hands each block to the given sink's `take(lists, texts)` before it returns. Through
//! `answerJson` those reads answer the same JSON and the blocks are dropped.
//!
//! The module imports `console.error`, `performance.now` and the sink's `take`.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn error(message: &str);

    #[wasm_bindgen(js_namespace = performance)]
    fn now() -> f64;

    /// What takes the cell blocks of a packed read: an object with `take(lists, texts)`.
    pub type CellSink;

    #[wasm_bindgen(method)]
    fn take(this: &CellSink, lists: &[u8], texts: &str);
}

/// The clock the engine measures its own work by (`calculate` stops when its time is up).
struct PerformanceClock;

impl crate::Clock for PerformanceClock {
    fn now_ms(&self) -> f64 {
        now()
    }
}

/// One workbook, as the page's worker holds it.
#[wasm_bindgen]
pub struct WorkbookSession {
    session: crate::WorkbookSession,
}

#[wasm_bindgen]
impl WorkbookSession {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> WorkbookSession {
        WorkbookSession { session: crate::WorkbookSession::new(Box::new(PerformanceClock)) }
    }

    /// A request about this workbook, as JSON; its answer, as JSON.
    #[wasm_bindgen(js_name = answerJson)]
    pub fn answer_json(&mut self, request: &str) -> String {
        self.session.answer_json(request)
    }

    /// A request about this workbook, as JSON; its answer, as JSON, with a packed read's cell blocks sent to `sink`
    /// in index order.
    #[wasm_bindgen(js_name = answerWithCells)]
    pub fn answer_with_cells(&mut self, request: &str, sink: &CellSink) -> String {
        self.session.answer_with_cells(request, |lists, texts| sink.take(lists, texts))
    }
}

/// A request that needs no workbook, as JSON; its answer, as JSON.
#[wasm_bindgen(js_name = answerUtilityRequestJson)]
pub fn answer_utility_request_json(request: &str) -> String {
    crate::answer_utility_request_json(request)
}

/// Every function a formula may call, with its family, its arguments and what it answers.
#[wasm_bindgen(js_name = functionDescriptionsJson)]
pub fn function_descriptions_json() -> String {
    crate::functions::description::descriptions_json()
}

#[wasm_bindgen(start)]
pub fn start() {
    std::panic::set_hook(Box::new(|info| error(&info.to_string())));
}
