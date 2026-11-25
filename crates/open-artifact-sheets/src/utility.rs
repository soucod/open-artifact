//! Requests that need no workbook (`answerUtilityRequestJson`): the format version, sizes and limits the page shares
//! with the engine; the locales and what each writes its own way; values shown with a pattern; typed days; formulas
//! written for a locale; time zones; how texts read under a column reading; dropdown labels; and what chart code
//! may hold.
//!
//! A request is JSON with a `kind`, read strictly: a field it doesn't have, a field twice, or a value of the wrong
//! shape refuses it (`unreadableRequest`). A `locale` left out is en-US; one not known (`de-de`, `xx-XX`)
//! refuses the request.

use serde::{Deserialize, Deserializer};
use serde_json::json;

use crate::column_readings::{self, ColumnReading};
use crate::locale::{self, Locale};
use crate::number_format::{NumberFormat, Room};
use crate::shown::shown;
use crate::time_zone;
use crate::value::{CellError, Value};
use crate::{formula_text, typed_day};

/// What `describeSharedCode` answers.
const SHARED_CODE: &str = concat!(
    r#"{"kind":"sharedCodeDescription","newestFormatVersion":47,"defaultColumnWidthInPixels":104,"widthsOfNumbers":{"pixelsInTenPoints":13,"widthOfADigit":0.64,"widthOfABoldDigit":0.67,"aroundTheTextInPixels":8,"halfAsWideAsADigit":" "#,
    // A no-break space and a narrow no-break space.
    "\u{a0}\u{202f}",
    r#"!',.:;Iijl","noWiderThanADigit":"0123456789#+$€£()[]{}|/\\*\"?=<>^~_`-abcdefghijklnopqrstuvxyzEFJLPST","widthOfAnyOtherCharacter":1.75},"limits":{"mostCells":500000,"mostBytesOfCopiedCells":16777216,"mostBytesOfATableToImport":50331648,"longestSheetNameInCharacters":100,"longestDropdownOptionInCharacters":100,"mostOptionsInADropdown":100,"mostUsersInACell":40,"narrowestColumnInPixels":8,"widestColumnInPixels":2000,"shortestRowInPixels":8,"tallestRowInPixels":2000,"smallestFontSizeInPoints":6,"largestFontSizeInPoints":96,"deepestGroup":7,"deepestLevelOfAListLine":2,"mostConditionalFormats":500,"mostRangesInAConditionalFormat":20,"mostTestsInAConditionalFormat":5,"longestTextOfAConditionInCharacters":100,"largestCountInACondition":1000,"smallestSideOfAPlacementInPixels":40,"largestSideOfAPlacementInPixels":4000,"largestOffsetOfAPlacementInPixels":2000,"mostCheckboxesOfOneInsert":40000,"mostEditsInAStep":512,"mostNamedViewsInASheet":20,"longestNameOfANamedViewInCharacters":100},"workbookContentsVersion":1,"loadForm":2}"#
);

/// What `readWhatChartCodeMayHold` answers: the SVG a chart's code may draw with, and how much of it.
const WHAT_CHART_CODE_MAY_HOLD: &str = r#"{"kind":"whatChartCodeMayHold","mayHold":{"tagsDrawn":["svg","g","path","line","rect","circle","ellipse","polyline","polygon","text","tspan"],"tagsLeftOut":["title","desc"],"attributesOfWords":["role","aria-label","aria-hidden"],"attributesOfPlaceAndPaint":["viewBox","preserveAspectRatio","width","height","transform","d","points","x","y","x1","y1","x2","y2","cx","cy","r","rx","ry","dx","dy","rotate","fill","fillOpacity","fillRule","color","opacity","visibility","display","overflow","paintOrder","pointerEvents","stroke","strokeWidth","strokeOpacity","strokeLinecap","strokeLinejoin","strokeMiterlimit","shapeRendering","textRendering","fontSize","fontWeight","fontStyle","letterSpacing","wordSpacing","textAnchor","dominantBaseline","alignmentBaseline","baselineShift","textLength","lengthAdjust"],"mostShapes":8500,"mostShapesOfWords":2500,"mostTooltips":2000}}"#;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    DescribeSharedCode {},
    #[serde(rename_all = "camelCase")]
    ReadShownValue {
        value: ValueIn,
        // Required, though it may be null.
        #[serde(deserialize_with = "Option::deserialize")]
        number_format: Option<PatternIn>,
        room: RoomIn,
        #[serde(default)]
        locale: LocaleIn,
    },
    ReadTypedDay {
        text: String,
        #[serde(default)]
        locale: LocaleIn,
    },
    ReadTimeZones {},
    ReadTimeZoneNamed {
        name: String,
    },
    ReadLocales {},
    ReadPatternsOfMoney {
        #[serde(default)]
        locale: LocaleIn,
    },
    ReadPatternsOfDatesWithTheMonthNamed {
        #[serde(default)]
        locale: LocaleIn,
    },
    ReadFormulaTextInLocale {
        text: String,
        #[serde(default)]
        locale: LocaleIn,
    },
    ReadKindOfPattern {
        pattern: String,
    },
    ReadTextsUnderAColumnReading {
        reading: ColumnReading,
        texts: Vec<String>,
        #[serde(default)]
        locale: LocaleIn,
    },
    ReadFitOfColumnReadings {
        readings: Vec<ColumnReading>,
        texts: Vec<String>,
        #[serde(default)]
        locale: LocaleIn,
    },
    ReadLabelsOfADropdownColumn {
        texts: Vec<String>,
    },
    ReadListLinesAsKept {
        lists: Vec<crate::workbook::rich::List>,
    },
    ReadWhatChartCodeMayHold {},
}

/// A value to show: `{"kind":"number","value":1.5}`, or a text, a boolean or an error (`"#N/A"`).
#[derive(Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase", deny_unknown_fields)]
enum ValueIn {
    Number(f64),
    Text(String),
    Boolean(bool),
    Error(CellError),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PatternIn {
    pattern: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum RoomIn {
    AsText {},
    #[serde(rename_all = "camelCase")]
    InACell {
        most_characters: u32,
    },
}

/// A locale named exactly as it is known; en-US when left out.
struct LocaleIn(&'static Locale);

impl Default for LocaleIn {
    fn default() -> Self {
        LocaleIn(locale::en_us())
    }
}

impl<'de> Deserialize<'de> for LocaleIn {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let tag = String::deserialize(deserializer)?;
        locale::find(&tag).map(LocaleIn).ok_or_else(|| serde::de::Error::custom("no such locale"))
    }
}

pub fn answer_utility_request_json(request: &str) -> String {
    let Ok(request) = serde_json::from_str::<Request>(request) else {
        return unreadable();
    };
    match request {
        Request::DescribeSharedCode {} => SHARED_CODE.to_owned(),
        Request::ReadWhatChartCodeMayHold {} => WHAT_CHART_CODE_MAY_HOLD.to_owned(),
        Request::ReadLocales {} => json!({
            "kind": "locales",
            "locales": locale::all().iter().map(|l| l.tag).collect::<Vec<_>>(),
            "localeOfANewWorkbook": locale::LOCALE_OF_A_NEW_WORKBOOK,
        })
        .to_string(),
        Request::ReadPatternsOfMoney { locale } => {
            let p = locale.0.patterns_of_money;
            json!({"kind": "patternsOfMoney", "withTwoDecimals": p.with_two_decimals, "withNoDecimals": p.with_no_decimals})
                .to_string()
        }
        Request::ReadPatternsOfDatesWithTheMonthNamed { locale } => {
            let p = locale.0.patterns_of_dates_with_the_month_named;
            json!({
                "kind": "patternsOfDatesWithTheMonthNamed",
                "withTheMonthInFull": p.with_the_month_in_full,
                "withTheMonthForShort": p.with_the_month_for_short,
                "monthAndDay": p.month_and_day,
                "monthAndYear": p.month_and_year,
            })
            .to_string()
        }
        Request::ReadTimeZones {} => json!({"kind": "timeZones", "timeZones": time_zone::listed()}).to_string(),
        Request::ReadTimeZoneNamed { name } => {
            json!({"kind": "timeZoneNamed", "timeZone": time_zone::named(&name)}).to_string()
        }
        Request::ReadKindOfPattern { pattern } => match NumberFormat::parse(&pattern) {
            Ok(format) => json!({"kind": "kindOfPattern", "numberFormatKind": format.kind().name()}).to_string(),
            Err(refusal) => refused(refusal.name()),
        },
        Request::ReadShownValue { value, number_format, room, locale } => {
            let value = match value {
                ValueIn::Number(n) => Value::Number(n),
                ValueIn::Text(t) => Value::text(t),
                ValueIn::Boolean(b) => Value::Boolean(b),
                ValueIn::Error(e) => Value::Error(e),
            };
            let room = match room {
                RoomIn::AsText {} => Room::AsText,
                RoomIn::InACell { most_characters } => Room::InACell { most_characters },
            };
            match shown(&value, number_format.as_ref().map(|p| p.pattern.as_str()), room, locale.0) {
                Ok(shown) => json!({"kind": "shownValue", "shown": shown}).to_string(),
                Err(refusal) => refused(refusal.name()),
            }
        }
        Request::ReadTypedDay { text, locale } => {
            let day = typed_day::read(&text, locale.0).map(|(y, m, d)| format!("{y:04}-{m:02}-{d:02}"));
            json!({"kind": "typedDay", "day": day}).to_string()
        }
        Request::ReadFormulaTextInLocale { text, locale } => {
            json!({"kind": "formulaTextInLocale", "text": formula_text::in_locale(&text, locale.0)}).to_string()
        }
        Request::ReadTextsUnderAColumnReading { reading, texts, locale } => {
            column_readings::texts_under_a_column_reading_json(&reading, &texts, locale.0)
        }
        Request::ReadFitOfColumnReadings { readings, texts, locale } => {
            column_readings::fit_of_column_readings_json(&readings, &texts, locale.0)
        }
        Request::ReadLabelsOfADropdownColumn { texts } => {
            json!({"kind": "labelsOfADropdownColumn", "labels": column_readings::labels_of_a_dropdown_column(&texts)})
                .to_string()
        }
        // Lines of lists as a cell keeps them (`rich::kept_lists`), each with its number.
        Request::ReadListLinesAsKept { mut lists } => {
            crate::workbook::rich::kept_lists(&mut lists);
            let numbers = crate::workbook::rich::numbers(&lists);
            let lines: Vec<serde_json::Value> =
                lists.iter().zip(numbers).map(|(list, number)| json!({"list": list, "number": number})).collect();
            json!({"kind": "listLinesAsKept", "lines": lines}).to_string()
        }
    }
}

fn refused(refusal: &str) -> String {
    json!({"kind": "refused", "refusal": refusal}).to_string()
}

fn unreadable() -> String {
    refused("unreadableRequest")
}
