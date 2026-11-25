//! Cell formats: what `setCellFormats` sets and `readWorkbook` reads back.
//!
//! A format is kept property by property (a leaf: the number format, each of the three alignments, the fill,
//! the cell control, each of the four border edges, each of the six font properties), each cell holding a value
//! for some of them; setting a property to its default takes it away. A format written to it (`{"font": {"bold":
//! true}}`) sets only the properties it names, so `{"font": {"italic": true}}` on a bold cell leaves it bold too.
//!
//! What is read back is grouped the same way every time, here and in the reverses of `setCellFormats`:
//! - each property's value is a set of cells; in each column, its rows; columns with the same rows are one block,
//!   rows by columns, each side its ids in order (`base`, then `n`) as runs;
//! - blocks of different properties that cover the same cells are one block with all their properties;
//! - blocks are in the order of their columns, then their rows, as runs (`base`, `first`, `count`).

use std::cmp::Ordering;
use std::collections::BTreeMap;
use hashbrown::HashMap;

use serde_json::{json, Map, Value};

use crate::ids::{Bases, IdRun, LineId};
use crate::number_format::NumberFormat;

/// One property of a cell's format, in the order a format is written.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Leaf {
    NumberFormat,
    Horizontal,
    Vertical,
    Wrap,
    FillColor,
    CellControl,
    BorderTop,
    BorderBottom,
    BorderLeft,
    BorderRight,
    Bold,
    Italic,
    Underline,
    Strikethrough,
    FontColor,
    FontSize,
}

pub const LEAVES: [Leaf; 16] = [
    Leaf::NumberFormat,
    Leaf::Horizontal,
    Leaf::Vertical,
    Leaf::Wrap,
    Leaf::FillColor,
    Leaf::CellControl,
    Leaf::BorderTop,
    Leaf::BorderBottom,
    Leaf::BorderLeft,
    Leaf::BorderRight,
    Leaf::Bold,
    Leaf::Italic,
    Leaf::Underline,
    Leaf::Strikethrough,
    Leaf::FontColor,
    Leaf::FontSize,
];

impl Leaf {
    /// The leaf of a cell's font a mark of text with looks is, the cell's look all over.
    pub fn of_mark(mark: crate::workbook::rich::Mark) -> Leaf {
        use crate::workbook::rich::Mark;
        match mark {
            Mark::Bold => Leaf::Bold,
            Mark::Italic => Leaf::Italic,
            Mark::Underline => Leaf::Underline,
            Mark::Strikethrough => Leaf::Strikethrough,
        }
    }

    /// The key of the format's part it is in, and its own key there (`None`: the part's value is the leaf's).
    pub fn keys(self) -> (&'static str, Option<&'static str>) {
        match self {
            Leaf::NumberFormat => ("numberFormat", None),
            Leaf::Horizontal => ("alignment", Some("horizontal")),
            Leaf::Vertical => ("alignment", Some("vertical")),
            Leaf::Wrap => ("alignment", Some("wrap")),
            Leaf::FillColor => ("fillColor", None),
            Leaf::CellControl => ("cellControl", None),
            Leaf::BorderTop => ("border", Some("top")),
            Leaf::BorderBottom => ("border", Some("bottom")),
            Leaf::BorderLeft => ("border", Some("left")),
            Leaf::BorderRight => ("border", Some("right")),
            Leaf::Bold => ("font", Some("bold")),
            Leaf::Italic => ("font", Some("italic")),
            Leaf::Underline => ("font", Some("underline")),
            Leaf::Strikethrough => ("font", Some("strikethrough")),
            Leaf::FontColor => ("font", Some("color")),
            Leaf::FontSize => ("font", Some("size")),
        }
    }

    /// What a cell has when nothing is set.
    pub fn default_value(self) -> Value {
        match self {
            Leaf::NumberFormat => json!({"pattern": "General"}),
            Leaf::Horizontal => json!("general"),
            Leaf::Vertical => json!("top"),
            Leaf::Wrap | Leaf::Bold | Leaf::Italic | Leaf::Strikethrough => json!(false),
            Leaf::FillColor | Leaf::FontColor | Leaf::CellControl => json!({"kind": "none"}),
            Leaf::BorderTop | Leaf::BorderBottom | Leaf::BorderLeft | Leaf::BorderRight => json!({"kind": "none"}),
            Leaf::Underline => json!("none"),
            Leaf::FontSize => json!(10),
        }
    }

    /// The leaf's value as it is kept, when the written one reads.
    fn read(self, v: &Value) -> Option<Value> {
        match self {
            Leaf::NumberFormat => {
                let o = only_keys(v, &["pattern"])?;
                let pattern = o.get("pattern")?.as_str()?;
                NumberFormat::parse(pattern).ok()?;
                Some(json!({"pattern": pattern}))
            }
            Leaf::Horizontal => one_of(v, &["general", "left", "center", "right"]),
            Leaf::Vertical => one_of(v, &["top", "center", "bottom"]),
            Leaf::Underline => one_of(v, &["none", "single", "double"]),
            // Text's wrapping is written as a boolean or by name (from 44); kept as `true` (wrap), `"clip"` or
            // `false` (overflow, the default).
            Leaf::Wrap => match v {
                Value::Bool(b) => Some(Value::Bool(*b)),
                Value::String(s) => match s.as_str() {
                    "wrap" => Some(json!(true)),
                    "overflow" => Some(json!(false)),
                    "clip" => Some(json!("clip")),
                    _ => None,
                },
                _ => None,
            },
            Leaf::Bold | Leaf::Italic | Leaf::Strikethrough => v.as_bool().map(Value::Bool),
            Leaf::FillColor | Leaf::FontColor => read_color(v),
            Leaf::CellControl => match v.get("kind")?.as_str()? {
                "none" => only_keys(v, &["kind"]).map(|_| json!({"kind": "none"})),
                "checkbox" => only_keys(v, &["kind"]).map(|_| json!({"kind": "checkbox"})),
                "dropdown" => {
                    let o = only_keys(v, &["kind", "dropdownId"])?;
                    let id = o.get("dropdownId")?.as_str()?;
                    Some(json!({"kind": "dropdown", "dropdownId": id}))
                }
                _ => None,
            },
            Leaf::BorderTop | Leaf::BorderBottom | Leaf::BorderLeft | Leaf::BorderRight => match v.get("kind")?.as_str()? {
                "none" => only_keys(v, &["kind"]).map(|_| json!({"kind": "none"})),
                "line" => {
                    let o = only_keys(v, &["kind", "style", "color"])?;
                    let style = one_of(o.get("style")?, &["thin", "medium", "thick", "dashed", "dotted", "double"])?;
                    let color = read_color(o.get("color")?)?;
                    Some(json!({"kind": "line", "style": style, "color": color}))
                }
                _ => None,
            },
            Leaf::FontSize => {
                let n = v.as_u64()?;
                (1..=409).contains(&n).then(|| json!(n))
            }
        }
    }
}

/// The object's keys, when they are all among `keys` (and there is at least one).
fn only_keys<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a Map<String, Value>> {
    let o = v.as_object()?;
    (!o.is_empty() && o.keys().all(|k| keys.contains(&k.as_str()))).then_some(o)
}

fn one_of(v: &Value, names: &[&str]) -> Option<Value> {
    let s = v.as_str()?;
    names.contains(&s).then(|| json!(s))
}

pub const HUES: [&str; 9] = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "magenta"];
pub const SHADES: [u64; 6] = [100, 200, 300, 400, 600, 800];

/// A color as it reads: none, a standard hue and shade, or `#rrggbb` in small letters.
pub fn read_color(v: &Value) -> Option<Value> {
    match v.get("kind")?.as_str()? {
        "none" => only_keys(v, &["kind"]).map(|_| json!({"kind": "none"})),
        "standard" => {
            let o = only_keys(v, &["kind", "hue", "shade"])?;
            let hue = one_of(o.get("hue")?, &HUES)?;
            let shade = o.get("shade")?.as_u64().filter(|s| SHADES.contains(s))?;
            Some(json!({"kind": "standard", "hue": hue, "shade": shade}))
        }
        "rgb" => {
            let o = only_keys(v, &["kind", "hex"])?;
            let hex = o.get("hex")?.as_str()?;
            let ok = hex.len() == 7
                && hex.starts_with('#')
                && hex[1..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
            ok.then(|| json!({"kind": "rgb", "hex": hex}))
        }
        _ => None,
    }
}

/// The leaves a written format sets, with their values; `None` when it does not read.
pub fn read_format(v: &Value) -> Option<Vec<(Leaf, Value)>> {
    let o = only_keys(v, &["numberFormat", "alignment", "fillColor", "cellControl", "border", "font"])?;
    let mut leaves = Vec::new();
    for leaf in LEAVES {
        let (part, key) = leaf.keys();
        let Some(written) = o.get(part) else { continue };
        let written = match key {
            None => written,
            Some(key) => {
                let keys: Vec<&str> = LEAVES.iter().filter(|l| l.keys().0 == part).filter_map(|l| l.keys().1).collect();
                match only_keys(written, &keys)?.get(key) {
                    Some(w) => w,
                    None => continue,
                }
            }
        };
        leaves.push((leaf, leaf.read(written)?));
    }
    Some(leaves)
}

/// A format written from leaves, in the leaves' order.
pub fn write_format(leaves: &BTreeMap<Leaf, Value>) -> Value {
    let mut out = Map::new();
    for (leaf, value) in leaves {
        let (part, key) = leaf.keys();
        match key {
            None => {
                out.insert(part.to_owned(), value.clone());
            }
            Some(key) => {
                let entry = out.entry(part.to_owned()).or_insert_with(|| Value::Object(Map::new()));
                entry.as_object_mut().expect("a part with keys is an object").insert(key.to_owned(), value.clone());
            }
        }
    }
    Value::Object(out)
}

/// The formats set on a sheet's cells: each property's value, by cell (row, column).
#[derive(Clone, Debug, Default)]
pub struct CellFormats {
    leaves: HashMap<Leaf, HashMap<(LineId, LineId), Value>>,
}

impl CellFormats {
    pub fn get(&self, leaf: Leaf, cell: (LineId, LineId)) -> Option<&Value> {
        self.leaves.get(&leaf)?.get(&cell)
    }

    /// The value the cell has (its default when none is set).
    pub fn value(&self, leaf: Leaf, cell: (LineId, LineId)) -> Value {
        self.get(leaf, cell).cloned().unwrap_or_else(|| leaf.default_value())
    }

    /// Sets a leaf of a cell; its default takes the leaf away.
    pub fn set(&mut self, leaf: Leaf, cell: (LineId, LineId), value: Value) {
        if value == leaf.default_value() {
            if let Some(cells) = self.leaves.get_mut(&leaf) {
                cells.remove(&cell);
            }
        } else {
            self.leaves.entry(leaf).or_default().insert(cell, value);
        }
    }

    pub fn is_empty(&self) -> bool {
        self.leaves.values().all(HashMap::is_empty)
    }

    /// Every leaf set, with its cell and value.
    pub fn iter(&self) -> impl Iterator<Item = (Leaf, (LineId, LineId), &Value)> {
        self.leaves.iter().flat_map(|(leaf, cells)| cells.iter().map(move |(cell, v)| (*leaf, *cell, v)))
    }

    /// Whether any cell's control names the dropdown.
    pub fn uses_dropdown(&self, dropdown_id: &str) -> bool {
        self.leaves.get(&Leaf::CellControl).is_some_and(|cells| cells.values().any(|v| v["dropdownId"] == dropdown_id))
    }
}

/// A line id's place in id order: its base's text, then its number.
pub fn id_order(bases: &Bases, a: LineId, b: LineId) -> Ordering {
    bases.name(a.base).cmp(bases.name(b.base)).then(a.n.cmp(&b.n))
}

/// Ids in id order as runs.
pub fn sorted_runs(bases: &Bases, lines: &mut Vec<LineId>) -> Vec<IdRun> {
    lines.sort_by(|a, b| id_order(bases, *a, *b));
    lines.dedup();
    let mut runs: Vec<IdRun> = Vec::new();
    for l in lines.iter() {
        if let Some(last) = runs.last_mut() {
            if last.base == bases.name(l.base) && last.first as u64 + last.count as u64 == l.n as u64 {
                last.count += 1;
                continue;
            }
        }
        runs.push(IdRun { base: bases.name(l.base).to_owned(), first: l.n, count: 1 });
    }
    runs
}

pub(crate) fn run_order(a: &[IdRun], b: &[IdRun]) -> Ordering {
    for (x, y) in a.iter().zip(b) {
        let o = x.base.cmp(&y.base).then(x.first.cmp(&y.first)).then(x.count.cmp(&y.count));
        if o != Ordering::Equal {
            return o;
        }
    }
    a.len().cmp(&b.len())
}

/// Leaves of cells grouped into blocks: rows, columns and format, in their order.
pub fn blocks<'a>(bases: &Bases, cells: impl Iterator<Item = (Leaf, (LineId, LineId), &'a Value)>) -> Vec<(Vec<IdRun>, Vec<IdRun>, Value)> {
    let blocks = leaf_blocks(bases, cells).into_iter();
    blocks.map(|(rows, columns, leaves)| (rows, columns, write_format(&leaves))).collect()
}

/// As `blocks`, each with its leaves rather than the format they make.
pub fn leaf_blocks<'a>(
    bases: &Bases,
    cells: impl Iterator<Item = (Leaf, (LineId, LineId), &'a Value)>,
) -> Vec<(Vec<IdRun>, Vec<IdRun>, BTreeMap<Leaf, Value>)> {
    // Each leaf: each column's rows and their values.
    let mut by_leaf: HashMap<Leaf, HashMap<LineId, Vec<(LineId, &'a Value)>>> = HashMap::new();
    for (leaf, (r, c), v) in cells {
        by_leaf.entry(leaf).or_default().entry(c).or_default().push((r, v));
    }
    // Of a leaf, the columns whose rows hold the same values are one block, a block for each value; blocks over the
    // same cells are one.
    let mut found: Vec<(Vec<IdRun>, Vec<IdRun>, BTreeMap<Leaf, Value>)> = Vec::new();
    let mut index: HashMap<(String, String), usize> = HashMap::new();
    for (leaf, columns) in by_leaf {
        let mut by_rows: BTreeMap<Vec<(String, u32, String)>, (Vec<(LineId, &Value)>, Vec<LineId>)> = BTreeMap::new();
        for (c, mut rows) in columns {
            rows.sort_by(|a, b| id_order(bases, a.0, b.0));
            rows.dedup_by_key(|x| x.0);
            let key = rows.iter().map(|(r, v)| (bases.name(r.base).to_owned(), r.n, v.to_string())).collect();
            by_rows.entry(key).or_insert_with(|| (rows, Vec::new())).1.push(c);
        }
        for (_, (rows, mut columns)) in by_rows {
            let columns = sorted_runs(bases, &mut columns);
            let mut values: Vec<(String, &Value, Vec<LineId>)> = Vec::new();
            for (r, v) in rows {
                let text = v.to_string();
                match values.iter_mut().find(|x| x.0 == text) {
                    Some(x) => x.2.push(r),
                    None => values.push((text, v, vec![r])),
                }
            }
            for (_, value, mut rows) in values {
                let rows = sorted_runs(bases, &mut rows);
                let key = (serde_json::to_string(&rows).unwrap(), serde_json::to_string(&columns).unwrap());
                let i = *index.entry(key).or_insert_with(|| {
                    found.push((rows, columns.clone(), BTreeMap::new()));
                    found.len() - 1
                });
                found[i].2.insert(leaf, value.clone());
            }
        }
    }
    found.sort_by(|a, b| run_order(&a.1, &b.1).then_with(|| run_order(&a.0, &b.0)));
    found
}
