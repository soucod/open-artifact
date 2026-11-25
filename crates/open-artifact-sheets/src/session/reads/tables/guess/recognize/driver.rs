//! The recognizer's run over a sheet: the cell tables it declares first, each read down to its body's
//! end; then the blocks of its content top down, each recognized as a table when it proves one (a block meeting a
//! table already found cut around it, rows above its first wide row cut off); then the blocks left, each assumed a
//! table with the reason it is not recognized.

use std::collections::BTreeMap;

use super::blocks::{blocks, Block};
use super::body::{Body, Frame};
use super::sheet::{Rect, Sheet, Skip, Value};
use super::super::cell_tables::{declared_places, holds_input};
use super::{Basis, Found, Reason, Role};
use crate::workbook::Sheet as WorkbookSheet;

/// The most columns the assumed tables of a sheet take together.
const MOST_ASSUMED_COLUMNS: usize = 10_000;
/// The most columns of a table counted against that.
const MOST_COLUMNS: usize = 500;

/// Blocks by their top left, as a queue taken from the top left.
type Queue = BTreeMap<(usize, usize), Block>;

fn queue(found: Vec<Block>) -> Queue {
    let mut entries: Vec<((usize, usize), Block)> = found.into_iter().map(|b| ((b.area.top, b.area.left), b)).collect();
    entries.sort_by_key(|e| e.0);
    // Of blocks at one top left, the last one is kept.
    entries.into_iter().collect()
}

fn requeue(q: &mut Queue, found: Vec<Block>) {
    for b in found {
        q.insert((b.area.top, b.area.left), b);
    }
}

/// A block's pieces cut into the parts of the block around a range: above it, below it, and left and right of it
/// across its rows; a part meeting the range still cut again strip by strip.
fn around(block: &Block, rect: &Rect) -> Vec<Block> {
    let b = block.area;
    let (left, right) = (b.left.min(b.right), b.left.max(b.right));
    let (top, bottom) = (rect.top.min(rect.bottom), rect.top.max(rect.bottom));
    let strips: Vec<Rect> = [
        (b.top < rect.top).then(|| Rect { top: b.top, left, bottom: rect.top - 1, right }),
        (b.bottom > rect.bottom).then(|| Rect { top: rect.bottom + 1, left, bottom: b.bottom, right }),
        (b.left < rect.left).then(|| Rect { top, left: b.left, bottom, right: rect.left - 1 }),
        (b.right > rect.right).then(|| Rect { top, left: rect.right + 1, bottom, right: b.right }),
    ]
    .into_iter()
    .flatten()
    .collect();
    let clipped = |pieces: &[Rect]| -> Vec<Vec<Rect>> { strips.iter().map(|s| clip(pieces, s)).collect() };
    let mut out = Vec::new();
    for found in blocks(clipped(&block.pieces).concat()) {
        if found.area.meets(rect) {
            for part in clipped(&found.pieces) {
                out.extend(blocks(part));
            }
        } else {
            out.push(found);
        }
    }
    out
}

/// The parts of pieces within a range.
fn clip(pieces: &[Rect], area: &Rect) -> Vec<Rect> {
    pieces
        .iter()
        .filter(|p| p.meets(area))
        .map(|p| Rect {
            top: p.top.max(area.top),
            left: p.left.max(area.left),
            bottom: p.bottom.min(area.bottom),
            right: p.right.min(area.right),
        })
        .collect()
}

/// A block from a row down, the rows above cut off.
fn from_row(block: &Block, row: usize) -> Vec<Block> {
    let b = block.area;
    let area = Rect { top: b.bottom.min(row), left: b.left.min(b.right), bottom: b.bottom.max(row), right: b.left.max(b.right) };
    blocks(clip(&block.pieces, &area))
}

impl Sheet<'_> {
    /// The tables of the sheet, top down and then left to right.
    pub(super) fn tables(&self, sheet: &WorkbookSheet) -> Vec<Found> {
        let mut tables = self.declared(sheet);
        let taken: Vec<Rect> = tables.iter().map(Found::area).collect();

        // Pass 1: the blocks recognized as tables.
        let mut claimed = taken.clone();
        let mut refused: BTreeMap<Rect, Reason> = BTreeMap::new();
        let mut q = queue(blocks(self.pieces()));
        while let Some((_, block)) = q.pop_first() {
            claimed.retain(|r| r.bottom >= block.area.top);
            let parts = if let Some(r) = claimed.iter().find(|r| r.meets(&block.area)) {
                around(&block, r)
            } else {
                match self.first_wide_row(&block.area) {
                    None => Vec::new(),
                    Some(r) if block.area.top < r => from_row(&block, r),
                    Some(_) => match self.recognize(&block, &taken) {
                        Ok(t) => {
                            let area = t.area();
                            tables.push(t);
                            claimed.push(area);
                            around(&block, &area)
                        }
                        Err(reason) => {
                            refused.insert(block.area, reason);
                            Vec::new()
                        }
                    },
                }
            };
            requeue(&mut q, parts);
        }
        tables.sort_by_key(|t| {
            let r = t.area();
            (r.top, r.left)
        });

        // Pass 2: the blocks left, assumed tables.
        let rects: Vec<Rect> = tables.iter().map(Found::area).collect();
        let mut active: Vec<Rect> = Vec::new();
        let mut next = 0;
        let mut room = MOST_ASSUMED_COLUMNS;
        let mut assumed = Vec::new();
        let mut q = queue(blocks(self.pieces()));
        while let Some((_, block)) = q.pop_first() {
            let b = block.area;
            let n = rects[next..].partition_point(|r| r.top < b.top);
            active.extend_from_slice(&rects[next..next + n]);
            next += n;
            active.retain(|r| r.bottom >= b.top);
            let hit = active
                .iter()
                .find(|r| r.meets(&b))
                .or_else(|| rects[next..].iter().take_while(|r| r.top <= b.bottom).find(|r| r.meets(&b)))
                .copied();
            let wide = self.first_wide_row(&b);
            if let Some(r) = wide {
                if b.top < r
                    && self.is_heading_row(r, b.left, b.right, None, Skip::LabelLike)
                    && (self.cells_in(r, b.left, b.right).len() > 2 || self.cells_in(r.saturating_add(1), b.left, b.right).len() >= 2)
                {
                    requeue(&mut q, from_row(&block, r));
                    continue;
                }
            }
            if let Some(t) = hit {
                requeue(&mut q, around(&block, &t));
                continue;
            }
            let (hf, hl) = self.header(&b).map_or((b.top, b.top), |h| (h.first, h.last));
            if hl >= b.bottom {
                continue;
            }
            let reason = match wide {
                None => {
                    if self.is_heading_row(b.top, b.left, b.right, None, Skip::LabelLike) {
                        Reason::OneColumn
                    } else {
                        Reason::NoHeadings
                    }
                }
                Some(_) => match refused.get(&b) {
                    Some(&reason) => reason,
                    None => {
                        let below = b.bottom.saturating_add(1);
                        let sentinel = Rect { top: below, left: b.left.min(b.right), bottom: below, right: b.left.max(b.right) };
                        self.recognize(&block, &[sentinel]).err().unwrap_or(Reason::NoHeadings)
                    }
                },
            };
            let frame = Frame { header: (hf, hl), columns: (b.left, b.right) };
            let body = self.plain_body(&frame, b.bottom);
            let n = b.right.min(b.left.saturating_add(MOST_COLUMNS - 1)).wrapping_sub(b.left).saturating_add(1);
            if room < n {
                break;
            }
            room -= n;
            assumed.push(Found { header: (hf, hl), columns: (b.left, b.right), body: body.runs, footer: None, basis: Basis::Assumed(reason) });
        }
        tables.append(&mut assumed);
        tables.sort_by_key(|t| {
            let r = t.area();
            (r.top, r.left)
        });
        tables
    }

    /// The cell tables the sheet declares, each read down to its body's end.
    fn declared(&self, sheet: &WorkbookSheet) -> Vec<Found> {
        let mut declared = declared_places(self.grid.workbook(), sheet);
        declared.retain(|(_, header, columns, _)| {
            holds_input(sheet, *header, *columns) || self.first_content_row(header.0, header.1, columns.0, columns.1).is_some()
        });
        let boxes = |header: (usize, usize), columns: (usize, usize), footer: Option<(usize, usize)>| {
            let r0 = footer.map_or(header.1, |f| f.1);
            Rect { top: header.0.min(r0), left: columns.0.min(columns.1), bottom: header.0.max(r0), right: columns.0.max(columns.1) }
        };
        let mut kept: Vec<Rect> = Vec::new();
        declared.retain(|(_, header, columns, footer)| {
            let area = boxes(*header, *columns, *footer);
            let overlaps = kept.iter().any(|k| k.meets(&area));
            if !overlaps {
                kept.push(area);
            }
            !overlaps
        });
        let mut rects: Vec<Rect> = declared.iter().map(|(_, h, c, f)| boxes(*h, *c, *f)).collect();
        let mut tables = Vec::new();
        for (i, (id, header, columns, footer)) in declared.into_iter().enumerate() {
            let table = self.read_declaration(header, columns, footer, &rects, Basis::Declared(id));
            rects[i] = table.area();
            tables.push(table);
        }
        tables
    }

    pub(super) fn read_declaration(
        &self, header: (usize, usize), (left, mut right): (usize, usize),
        footer: Option<(usize, usize)>, neighbors: &[Rect], basis: Basis,
    ) -> Found {
        let (first_header, last_header) = header;
        let bottom = footer.map_or(last_header, |(_, last)| last);
        let mut column = right.saturating_add(1);
        while self.has_content(last_header, column, column)
            && !neighbors.iter().any(|r| r.top <= bottom && first_header <= r.bottom && r.left <= column && column <= r.right)
        {
            right = column;
            column += 1;
        }
        let frame = Frame { header, columns: (left, right) };
        let body = match footer {
            Some((first, last)) => {
                let end = first.saturating_sub(1);
                let mut body = self.footer_body(&frame, end, last).unwrap_or_else(|| self.plain_body(&frame, end));
                body.footer = Some((first, last));
                body
            }
            None => self.open_body(&frame, neighbors),
        };
        Found { header, columns: frame.columns, body: body.runs, footer: body.footer, basis }
    }

    /// Whether the first row of a block below blank rows goes on from the last row above them: the first cell
    /// each shows is in the same column, and both or neither is a text (a number, a date, a
    /// boolean and an error alike).
    pub(super) fn goes_on(&self, above: usize, below: usize, c0: usize, c1: usize) -> bool {
        match (self.cells_in(above, c0, c1).first(), self.cells_in(below, c0, c1).first()) {
            (Some(a), Some(b)) => a.column == b.column && a.is_text() == b.is_text(),
            _ => true,
        }
    }

    /// The body of a declared table with no footer: down through the blocks under it the heading does not come
    /// again in, each going on from the row above the blank ones before it, then rows of unticked checkboxes
    /// only.
    fn open_body(&self, frame: &Frame, rects: &[Rect]) -> Body {
        let hl = frame.header.1;
        let (c0, c1) = frame.columns;
        let limit = self.limit(frame, rects);
        let mut end = self.last_filled_row(hl.saturating_add(1), limit, c0, c1).unwrap_or(hl);
        while let Some((None, first, last)) = self.block_below(frame, end, limit) {
            let cells = self.cells_in(first, c0, c1);
            let ok = match cells.len() {
                0 => false,
                1 => matches!(cells[0].value, Value::Boolean) || !self.unticked_in(first, c0, c1).is_empty(),
                _ => true,
            } && (end <= hl || self.goes_on(end, first, c0, c1));
            if !ok {
                break;
            }
            end = last;
        }
        let mut body = self.recognized_body(frame, end, limit).unwrap_or_else(|_| self.plain_body(frame, end));
        let from = match body.footer {
            Some((_, last)) => last,
            None => body.runs.last().map_or(hl, |r| r.last),
        };
        let s = from.saturating_add(1);
        if s <= limit {
            let (mut any, mut last_ok) = (false, s);
            let mut r = s;
            loop {
                if self.unticked_in(r, c0, c1).is_empty() {
                    break;
                }
                let filled = self.has_content(r, c0, c1);
                if r == limit {
                    if !filled {
                        last_ok = r;
                        any = true;
                    }
                    break;
                }
                if filled {
                    break;
                }
                any = true;
                last_ok = r;
                r += 1;
            }
            if any && body.footer.is_none() {
                match body.runs.last_mut() {
                    Some(l) if l.role == Role::Blank => l.last = last_ok,
                    _ => body.runs.push(super::Run { first: s, last: last_ok, role: Role::Blank }),
                }
            }
        }
        body
    }

    /// The block under a table's rows across its columns, after one blank row or more, when the columns beside it
    /// show nothing along it: the row the heading comes again on in it if it does, its first row and its last; none
    /// when there is none.
    pub(super) fn block_below(&self, frame: &Frame, from: usize, limit: usize) -> Option<(Option<usize>, usize, usize)> {
        let (c0, c1) = frame.columns;
        let start = from.saturating_add(1);
        let first = self.first_content_row(start, limit, c0, c1)?;
        if start >= first {
            return None;
        }
        let last = self.last_filled_row(first, limit, c0, c1)?;
        let sides = [c0.checked_sub(1), (c1 != usize::MAX).then(|| c1 + 1)];
        for r in first..=last {
            if sides.iter().flatten().any(|&s| self.has_content(r, s, s)) {
                return None;
            }
        }
        let area = Rect { top: first.min(last), left: c0.min(c1), bottom: first.max(last), right: c0.max(c1) };
        let again = match self.first_wide_row(&area) {
            Some(x) if x < last && self.is_heading_row(x, c0, c1, None, Skip::LabelLike) => Some(x),
            _ => None,
        };
        Some((again, first, last))
    }
}

