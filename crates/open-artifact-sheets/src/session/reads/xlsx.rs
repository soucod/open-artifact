//! The workbook shown, written as an .xlsx file (`readXlsxFile`): the file's parts, each its path and its XML (the
//! page puts them in the zip), what the file cannot carry, and the charts left out of it.
//!
//! The file has the workbook (its sheets, under the names Excel takes, `names.rs`), a part for each sheet
//! (`worksheet.rs`), the cells' looks (`styles.rs`), the texts the cells share, and, when a formula is written as a
//! dynamic array (`formula.rs`), the metadata that says so. The options of the dropdowns cells use go in a hidden
//! sheet after the others, each dropdown's in a column, and the cells offer them as a list from it.
//!
//! What does not carry over is told (`notCarriedOver`), in this order: formulas written as their values, random
//! numbers (which Excel draws again), people (written as their labels), links of parts of texts, links Excel does
//! not take, checkboxes, the colors of dropdown options, sheet names Excel does not take, blank cells' looks past
//! the file's room for them, sizes past Excel's largest, conditional formats, views placed on sheets, the charts'
//! looks, and interactives (a sheet that shows one is written as its cells). A placed
//! view is a chart in the file only when it is described (`charts`); every other one is in `chartsLeftOut`, with why.

mod charts;
mod formula;
mod names;
mod styles;
mod worksheet;
mod xml;

use std::collections::HashMap;
use std::fmt::Write;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use self::charts::DescribedChart;
use self::styles::{Look, StandardColors, Styles};
use self::worksheet::{address, Validation, Writing};
use self::xml::{SharedStrings, DECLARATION};
use crate::formula::column_letters;
use crate::ids::LineId;
use crate::workbook::formats::{blocks, Leaf, HUES, SHADES};
use crate::workbook::Workbook;

pub const KINDS: &[&str] = &["readXlsxFile"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct Request {
    kind: String,
    name_of_the_sheet_of_options: String,
    rgb_of_standard_colors: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    charts: Vec<DescribedChart>,
}

/// What the file does not carry over.
#[derive(Default)]
pub struct Flags {
    pub formulas_written_as_values: bool,
    pub random_numbers: bool,
    pub users: bool,
    pub links_of_parts_of_texts: bool,
    pub links_of_some_cells: bool,
    pub lists_in_texts: bool,
    pub checkboxes: bool,
    pub looks_of_some_blank_cells: bool,
    pub sizes_cut: bool,
}

const CONTENT_TYPE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml";
pub const RELATIONSHIP: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// The request read, and its standard colors.
fn read(request: &Json) -> Option<(Request, StandardColors)> {
    let request = serde_json::from_value::<Request>(request.clone()).ok()?;
    let colors = standard_colors(&request.rgb_of_standard_colors)?;
    Some((request, colors))
}

/// Whether a request is a `readXlsxFile` that reads.
pub fn reads(request: &Json) -> bool {
    request.get("kind").and_then(Json::as_str).is_some_and(|kind| KINDS.contains(&kind)) && read(request).is_some()
}

pub fn answer(workbook: &Workbook, request: &Json) -> String {
    let Some((request, colors)) = read(request) else {
        return super::unreadable();
    };
    if workbook.sheets.is_empty() {
        return json!({"kind": "refused", "refusal": "noSheetToWrite"}).to_string();
    }

    // The dropdowns cells use, each a column of the sheet of options, in the order of the sheets.
    let mut lists: Vec<Vec<String>> = Vec::new();
    let mut sqrefs: Vec<Vec<(usize, String)>> = Vec::new();
    let mut dropdown_colors = false;
    for sheet in &workbook.sheets {
        let mut here = Vec::new();
        for (id, options) in sheet.dropdowns.values() {
            let sqref = sqref_of(workbook, sheet, id);
            if sqref.is_empty() {
                continue;
            }
            dropdown_colors |= options.iter().any(|o| o.color.get("kind").and_then(Json::as_str) != Some("none"));
            here.push((lists.len(), sqref));
            lists.push(options.iter().map(|o| o.label.clone()).collect());
        }
        sqrefs.push(here);
    }

    let names: Vec<&str> = workbook.sheets.iter().map(|s| s.name.as_str()).collect();
    let options_name = (!lists.is_empty()).then_some(request.name_of_the_sheet_of_options.as_str());
    let (names, options_name, names_changed) = names::names_in_the_file(&names, options_name);
    let charts = charts::charts(workbook, &names, &request.charts);
    let mut writing = Writing {
        workbook,
        names: &names,
        colors: &colors,
        styles: Styles::default(),
        strings: SharedStrings::default(),
        flags: Flags::default(),
        budget: worksheet::BUDGET,
        sheet_links: Vec::new(),
        drawings: charts.drawings.iter().map(|d| d.as_ref().map(|d| d.number)).collect(),
    };
    let mut sheets: Vec<String> = Vec::new();
    for (i, here) in sqrefs.iter().enumerate() {
        let quoted = format!("'{}'", options_name.as_deref().unwrap_or_default().replace('\'', "''"));
        let validations: Vec<Validation> = here
            .iter()
            .map(|(k, sqref)| {
                let column = column_letters(*k);
                let formula = format!("{quoted}!${column}$1:${column}${}", lists[*k].len());
                Validation { sqref: sqref.clone(), formula }
            })
            .collect();
        sheets.push(writing.sheet(i, i == 0, &validations));
    }
    if options_name.is_some() {
        sheets.push(options_sheet(&lists, &mut writing.strings, &mut writing.styles));
    }
    let is_array = sheets.iter().any(|s| s.contains(" cm=\"1\""));

    let mut parts: Vec<(String, String)> = Vec::new();
    let mut types = String::from(DECLARATION);
    types.push_str(
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" \
         ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" \
         ContentType=\"application/xml\"/>",
    );
    let mut overrides = vec![("workbook.xml".to_owned(), "sheet.main")];
    overrides.extend((1..=sheets.len()).map(|i| (format!("worksheets/sheet{i}.xml"), "worksheet")));
    overrides.push(("styles.xml".to_owned(), "styles"));
    overrides.push(("sharedStrings.xml".to_owned(), "sharedStrings"));
    if is_array {
        overrides.push(("metadata.xml".to_owned(), "sheetMetadata"));
    }
    for (part, kind) in overrides {
        let _ = write!(types, "<Override PartName=\"/xl/{part}\" ContentType=\"{CONTENT_TYPE}.{kind}+xml\"/>");
    }
    for drawing in charts.drawings.iter().flatten() {
        let _ = write!(
            types,
            "<Override PartName=\"/xl/drawings/drawing{}.xml\" \
             ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>",
            drawing.number
        );
        for (n, _) in &drawing.charts {
            let _ = write!(
                types,
                "<Override PartName=\"/xl/charts/chart{n}.xml\" \
                 ContentType=\"application/vnd.openxmlformats-officedocument.drawingml.chart+xml\"/>"
            );
        }
    }
    types.push_str("</Types>");
    parts.push(("[Content_Types].xml".into(), types));
    parts.push((
        "_rels/.rels".into(),
        format!(
            "{DECLARATION}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             <Relationship Id=\"rId1\" Type=\"{RELATIONSHIP}/officeDocument\" Target=\"xl/workbook.xml\"/>\
             </Relationships>"
        ),
    ));
    let mut book = String::from(DECLARATION);
    let _ = write!(
        book,
        "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"{RELATIONSHIP}\">\
         <bookViews><workbookView/></bookViews><sheets>"
    );
    let all_names = names.iter().map(String::as_str).chain(options_name.as_deref());
    for (i, name) in all_names.enumerate() {
        let hidden = if i == names.len() { " state=\"hidden\"" } else { "" };
        let name = xml::attribute(name);
        let _ = write!(book, "<sheet name=\"{name}\" sheetId=\"{}\"{hidden} r:id=\"rId{}\"/>", i + 1, i + 1);
    }
    book.push_str("</sheets><calcPr fullCalcOnLoad=\"1\"/></workbook>");
    parts.push(("xl/workbook.xml".into(), book));
    let mut rels = String::from(DECLARATION);
    rels.push_str("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
    let mut targets: Vec<(&str, String)> =
        (1..=sheets.len()).map(|i| ("worksheet", format!("worksheets/sheet{i}.xml"))).collect();
    targets.push(("styles", "styles.xml".to_owned()));
    targets.push(("sharedStrings", "sharedStrings.xml".to_owned()));
    if is_array {
        targets.push(("sheetMetadata", "metadata.xml".to_owned()));
    }
    for (i, (kind, target)) in targets.into_iter().enumerate() {
        let _ = write!(rels, "<Relationship Id=\"rId{}\" Type=\"{RELATIONSHIP}/{kind}\" Target=\"{target}\"/>", i + 1);
    }
    rels.push_str("</Relationships>");
    parts.push(("xl/_rels/workbook.xml.rels".into(), rels));
    for (i, sheet) in sheets.into_iter().enumerate() {
        parts.push((format!("xl/worksheets/sheet{}.xml", i + 1), sheet));
    }
    parts.push(("xl/styles.xml".into(), writing.styles.part()));
    parts.push(("xl/sharedStrings.xml".into(), writing.strings.part()));
    if is_array {
        parts.push(("xl/metadata.xml".into(), METADATA.to_owned()));
    }
    // Each sheet's links, then its drawing and its charts.
    let mut links = std::mem::take(&mut writing.sheet_links).into_iter().peekable();
    for (i, drawing) in charts.drawings.into_iter().enumerate() {
        if let Some((n, rels)) = links.next_if(|(n, _)| *n == i + 1) {
            parts.push((format!("xl/worksheets/_rels/sheet{n}.xml.rels"), rels));
        }
        if let Some(drawing) = drawing {
            let d = drawing.number;
            parts.push((format!("xl/drawings/drawing{d}.xml"), drawing.xml));
            parts.push((format!("xl/drawings/_rels/drawing{d}.xml.rels"), drawing.rels));
            parts.extend(drawing.charts.into_iter().map(|(n, xml)| (format!("xl/charts/chart{n}.xml"), xml)));
        }
    }

    let flags = &writing.flags;
    let drawn = writing.drawings.iter().any(Option::is_some);
    let not_carried_over: Vec<&str> = [
        (flags.formulas_written_as_values, "formulasWrittenAsValues"),
        (flags.random_numbers, "randomNumbersThatStay"),
        (flags.users, "users"),
        (flags.links_of_parts_of_texts, "linksOfPartsOfTexts"),
        (flags.links_of_some_cells, "linksOfSomeCells"),
        (flags.lists_in_texts, "listsInTexts"),
        (flags.checkboxes, "checkboxes"),
        (dropdown_colors, "colorsOfDropdownOptions"),
        (names_changed, "sheetNames"),
        (flags.looks_of_some_blank_cells, "looksOfSomeBlankCells"),
        (flags.sizes_cut, "sizesOfTheLargestRowsAndColumns"),
        (workbook.sheets.iter().any(|s| !s.conditional_formats.is_empty()), "conditionalFormats"),
        (!charts.left_out.is_empty(), "placedViews"),
        (drawn, "looksOfCharts"),
        // A sheet that shows an interactive is written as its cells, without it.
        (workbook.sheets.iter().any(|s| s.interactive.is_some()), "interactives"),
    ]
    .into_iter()
    .filter_map(|(on, name)| on.then_some(name))
    .collect();
    let parts: Vec<Json> = parts.into_iter().map(|(path, xml)| json!({"path": path, "xml": xml})).collect();
    json!({
        "kind": "xlsxFile",
        "parts": parts,
        "notCarriedOver": not_carried_over,
        "chartsLeftOut": charts.left_out,
    })
    .to_string()
}

/// The standard colors, when every hue has every shade, each `#` and six lower-case hex digits.
fn standard_colors(given: &HashMap<String, HashMap<String, String>>) -> Option<StandardColors> {
    if given.len() != HUES.len() {
        return None;
    }
    let mut out = StandardColors::new();
    for hue in HUES {
        let shades = given.get(hue)?;
        if shades.len() != SHADES.len() {
            return None;
        }
        for shade in SHADES {
            let hex = shades.get(&shade.to_string())?;
            let digits = hex.strip_prefix('#')?;
            if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                return None;
            }
            out.insert((hue.to_owned(), shade), format!("FF{}", digits.to_ascii_uppercase()));
        }
    }
    Some(out)
}

/// The cells a dropdown is offered in, as the file lists them: blocks of cell controls (the columns
/// whose controls are the same in every row together, so that a checkbox in one column parts it from the next) that
/// offer it, in the order of their ids, each such block's rectangles by their rows, then their columns.
fn sqref_of(workbook: &Workbook, sheet: &crate::workbook::Sheet, dropdown_id: &str) -> String {
    let cells = sheet.formats.iter().filter(|(leaf, _, _)| *leaf == Leaf::CellControl);
    let offers = |format: &Json| format["cellControl"]["dropdownId"].as_str() == Some(dropdown_id);
    let mut out: Vec<String> = Vec::new();
    for (rows, columns, _) in blocks(&workbook.bases, cells).into_iter().filter(|(_, _, format)| offers(format)) {
        let positions = |runs: &[crate::ids::IdRun], axis: &crate::ids::Axis| -> Vec<(usize, usize)> {
            let mut p: Vec<usize> = runs
                .iter()
                .flat_map(|run| {
                    let base = workbook.bases.find(&run.base);
                    (run.first..run.first + run.count).filter_map(move |n| Some(LineId { base: base?, n }))
                })
                .filter_map(|line| axis.position(line))
                .collect();
            p.sort_unstable();
            let mut runs: Vec<(usize, usize)> = Vec::new();
            for x in p {
                match runs.last_mut() {
                    Some((_, last)) if *last + 1 == x => *last = x,
                    _ => runs.push((x, x)),
                }
            }
            runs
        };
        let (rows, columns) = (positions(&rows, &sheet.rows), positions(&columns, &sheet.columns));
        for &(top, bottom) in &rows {
            for &(left, right) in &columns {
                if (top, left) == (bottom, right) {
                    out.push(address(top, left));
                } else {
                    out.push(format!("{}:{}", address(top, left), address(bottom, right)));
                }
            }
        }
    }
    out.join(" ")
}

/// The hidden sheet of dropdown options: each dropdown's labels down a column.
fn options_sheet(lists: &[Vec<String>], strings: &mut SharedStrings, styles: &mut Styles) -> String {
    let mut out = String::from(DECLARATION);
    out.push_str(
        "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetViews><sheetView \
         workbookViewId=\"0\"/></sheetViews><sheetFormatPr defaultColWidth=\"14.857142857142858\" \
         defaultRowHeight=\"12.75\"/><sheetData>",
    );
    let longest = lists.iter().map(Vec::len).max().unwrap_or(0);
    for row in 0..longest {
        let _ = write!(out, "<row r=\"{}\">", row + 1);
        for (column, list) in lists.iter().enumerate() {
            if let Some(label) = list.get(row) {
                let _ = write!(out, "<c r=\"{}\"", address(row, column));
                // A label Excel would read as a formula or a number is kept as text.
                if label.starts_with(['=', '+', '-']) {
                    let _ = write!(out, " s=\"{}\"", styles.xf(&Look::default(), true));
                }
                let _ = write!(out, " t=\"s\"><v>{}</v></c>", strings.place(label));
            }
        }
        out.push_str("</row>");
    }
    out.push_str("</sheetData></worksheet>");
    out
}

const METADATA: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<metadata \
xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
xmlns:xda=\"http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray\"><metadataTypes count=\"1\">\
<metadataType name=\"XLDAPR\" minSupportedVersion=\"120000\" copy=\"1\" pasteAll=\"1\" pasteValues=\"1\" merge=\"1\" \
splitFirst=\"1\" rowColShift=\"1\" clearFormats=\"1\" clearComments=\"1\" assign=\"1\" coerce=\"1\" cellMeta=\"1\"/>\
</metadataTypes><futureMetadata name=\"XLDAPR\" count=\"1\"><bk><extLst>\
<ext uri=\"{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}\"><xda:dynamicArrayProperties fDynamic=\"1\" fCollapsed=\"0\"/>\
</ext></extLst></bk></futureMetadata><cellMetadata count=\"1\"><bk><rc t=\"1\" v=\"0\"/></bk></cellMetadata></metadata>";
