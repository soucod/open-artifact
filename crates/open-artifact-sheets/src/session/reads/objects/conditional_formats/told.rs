//! The conditional formats of the records around some cells, as the agent is told them
//! (`readConditionalFormatsAsAgentIsTold`): how rules are written (`told.txt`), then the sheet as JSON between
//! `<sheet>` and `</sheet>`: today, the sheet's size, the cells and the records by address, what the records'
//! columns hold (each column by its letters), and the rules over the records written by address, the first 30.

use std::fmt::Write;

use serde_json::{json, Value as Json};

use super::super::range_address;
use super::records::{Around, Block};
use super::renamed;
use crate::dates::date_from_serial;
use crate::formula::column_letters;
use crate::workbook::{Sheet, Workbook};

/// How rules are written, as the agent is told.
const HOW_RULES_ARE_WRITTEN: &str = include_str!("told.txt");
/// The most rules told.
const MOST_RULES: usize = 30;
/// The most groups of rows without records told.
const MOST_NON_RECORDS: usize = 200;

/// What the agent is told of the conditional formats around some cells.
pub(super) fn told(workbook: &Workbook, sheet: &Sheet, rows: &[usize], columns: &[usize], now: Option<f64>) -> Json {
    let around = Around::of(workbook, sheet, rows, columns);
    let Around { values, cells, records, about, .. } = &around;
    let block = records.block;
    let table = values.columns(records, about.left);
    let today = now.map(f64::floor).map(|today| {
        let (year, month, day) = date_from_serial(today as i64);
        json!({"date": format!("{year:04}-{month:02}-{day:02}"), "number": today as i64})
    });
    let letters = |c: &str| -> Result<String, ()> {
        workbook.bases.parse(c).and_then(|l| sheet.columns.position(l)).map(column_letters).ok_or(())
    };
    let mut kept: Vec<_> = sheet.conditional_formats.iter().collect();
    kept.sort_by(|a, b| (a.1 .1.priority, a.0).cmp(&(b.1 .1.priority, b.0)));
    // The rules over the records; one that cannot be written by address (a column it reads is deleted) is left out.
    let mut over_the_records = 0usize;
    let mut rules: Vec<Json> = kept
        .into_iter()
        .filter_map(|(_, (_, rule))| {
            let boxes: Vec<_> = rule.ranges.iter().filter_map(|r| sheet.live_box(&workbook.bases, r)).collect();
            let meets = |&(t, b, l, r): &(usize, usize, usize, usize)| {
                t <= block.bottom && block.top <= b && l <= block.right && block.left <= r
            };
            if !boxes.iter().any(meets) {
                return None;
            }
            over_the_records = over_the_records.saturating_add(1);
            let cells: Vec<String> = boxes.iter().map(|&(t, b, l, r)| range_address((t, l), (b, r))).collect();
            Some(json!({"cells": cells, "effect": renamed(&rule.effect, &letters).ok()?}))
        })
        .collect();
    rules.truncate(MOST_RULES);
    let left_out = over_the_records.saturating_sub(rules.len());
    let columns: Vec<Json> = table.iter().map(|c| c.told(json!(column_letters(c.column)))).collect();
    let address = |b: Block| range_address((b.top, b.left), (b.bottom, b.right));
    let no_records = (records.non_records.len() <= MOST_NON_RECORDS).then(|| {
        records.non_records.iter().map(|&(rows, kind)| json!({"cells": address(rows), "are": kind})).collect::<Vec<_>>()
    });
    let told = json!({
        "today": today,
        "rowCount": sheet.rows.len(),
        "columnCount": sheet.columns.len(),
        "selected": address(*cells),
        "table": address(records.table),
        "records": address(block),
        "noRecords": no_records,
        "footer": records.footer.map(address),
        "columns": columns,
        "columnsLeftOut": (block.right - block.left).saturating_add(1).saturating_sub(table.len()),
        "rules": rules,
        "rulesLeftOut": left_out,
    });
    let told = format!("{HOW_RULES_ARE_WRITTEN}<sheet>\n{}\n</sheet>\n", escaped(&told.to_string()));
    json!({"kind": "conditionalFormatsAsAgentIsTold", "told": told})
}

/// JSON with what cannot be seen escaped as well, and the angle brackets (none can close the `<sheet>` it is in).
fn escaped(json: &str) -> String {
    let mut out = String::with_capacity(json.len());
    for ch in json.chars() {
        if is_escaped(ch) {
            let mut units = [0u16; 2];
            for unit in ch.encode_utf16(&mut units) {
                let _ = write!(out, "\\u{unit:04x}");
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// Whether a character is written escaped: `<` and `>`, DEL and the C1 controls, the spaces other than the space,
/// and the characters ignored by default (with a few blank ones: the Hangul fillers and the blank braille pattern).
fn is_escaped(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3c | 0x3e
            | 0x7f..=0xa0
            | 0xad
            | 0x34f
            | 0x61c
            | 0x115f
            | 0x1160
            | 0x1680
            | 0x17b4
            | 0x17b5
            | 0x180b..=0x180f
            | 0x2000..=0x200f
            | 0x2028..=0x202f
            | 0x205f..=0x206f
            | 0x2800
            | 0x3000
            | 0x3164
            | 0xfe00..=0xfe0f
            | 0xfeff
            | 0xffa0
            | 0xfff0..=0xfffb
            | 0x1bca0..=0x1bca3
            | 0x1d173..=0x1d17a
            | 0xe0000..=0xe0fff
    )
}
