//! Number formats: reading a pattern (`#,##0.00`, `[Red]0;-0`, `yyyy-mm-dd`, `@" kg"`) and showing a number or a
//! text with it, the way a locale shows it (TEXT shows it the en-US way).
//!
//! The workbook's locale gives the decimal and group signs, how digits are grouped, the month and day names when a
//! pattern names no language (or `[$-F800]`), and how `m/d/yyyy` and `m/d` are shown (`06.03.2023` and `6.3` in
//! de-DE). General, in a cell that holds only so many characters, takes fewer digits or an exponent to fit.
//!
//! A pattern holds up to four sections split by `;`. Without conditions, one section shows every number; two show
//! numbers from 0 up, then negative ones (without their sign); three show positive, negative and zero numbers. A
//! fourth section, or a last one holding `@`, shows texts.

use std::cmp::Ordering;

use crate::coerce;
use crate::dates;
use crate::locale::{self, Locale};
use crate::value::{number_text, significant_digits, SIGNIFICANT_DIGITS};

mod fraction;
pub(crate) mod names;

use fraction::Fraction;
use names::Names;

/// Why a pattern is refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    PatternEmpty,
    PatternTooLong,
    PatternHoldsControlCharacter,
    QuoteNotClosed,
    NothingAfterEscape,
    BracketNotClosed,
    BracketNotKnown,
    CharacterNeedsQuotes,
    TooManySections,
    TextSectionNotLast,
    FourthSectionNotForText,
    ColorOutOfPlace,
    ConditionOutOfPlace,
    CurrencyOrLanguageNamedTwice,
    SectionMixesKinds,
    SecondDecimalPoint,
    CommaOutOfPlace,
    ExponentNotWellFormed,
    FractionNotWellFormed,
    TextPlacedTwice,
    SecondFill,
    ElapsedTimeNotWellFormed,
    TooManyDecimalsOfASecond,
}

impl Refusal {
    pub fn name(self) -> &'static str {
        match self {
            Refusal::PatternEmpty => "patternEmpty",
            Refusal::PatternTooLong => "patternTooLong",
            Refusal::PatternHoldsControlCharacter => "patternHoldsControlCharacter",
            Refusal::QuoteNotClosed => "quoteNotClosed",
            Refusal::NothingAfterEscape => "nothingAfterEscape",
            Refusal::BracketNotClosed => "bracketNotClosed",
            Refusal::BracketNotKnown => "bracketNotKnown",
            Refusal::CharacterNeedsQuotes => "characterNeedsQuotes",
            Refusal::TooManySections => "tooManySections",
            Refusal::TextSectionNotLast => "textSectionNotLast",
            Refusal::FourthSectionNotForText => "fourthSectionNotForText",
            Refusal::ColorOutOfPlace => "colorOutOfPlace",
            Refusal::ConditionOutOfPlace => "conditionOutOfPlace",
            Refusal::CurrencyOrLanguageNamedTwice => "currencyOrLanguageNamedTwice",
            Refusal::SectionMixesKinds => "sectionMixesKinds",
            Refusal::SecondDecimalPoint => "secondDecimalPoint",
            Refusal::CommaOutOfPlace => "commaOutOfPlace",
            Refusal::ExponentNotWellFormed => "exponentNotWellFormed",
            Refusal::FractionNotWellFormed => "fractionNotWellFormed",
            Refusal::TextPlacedTwice => "textPlacedTwice",
            Refusal::SecondFill => "secondFill",
            Refusal::ElapsedTimeNotWellFormed => "elapsedTimeNotWellFormed",
            Refusal::TooManyDecimalsOfASecond => "tooManyDecimalsOfASecond",
        }
    }
}

/// What a pattern shows, as its first section has it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    General,
    Number,
    Percent,
    Currency,
    Scientific,
    Fraction,
    Date,
    Time,
    DateAndTime,
    Duration,
    Text,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::General => "general",
            Kind::Number => "number",
            Kind::Percent => "percent",
            Kind::Currency => "currency",
            Kind::Scientific => "scientific",
            Kind::Fraction => "fraction",
            Kind::Date => "date",
            Kind::Time => "time",
            Kind::DateAndTime => "dateAndTime",
            Kind::Duration => "duration",
            Kind::Text => "text",
        }
    }
}

/// A section's colour: `[Red]` (named in lowercase) or `[Color12]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Color {
    Named(&'static str),
    Indexed(u8),
}

/// Why a number can't be shown with a pattern.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotShown {
    /// No section's condition takes the number.
    NoSectionApplies,
    /// A date or time before 0001-01-01 or after 9999-12-31, or a duration that long.
    OutsideTheCalendar,
    /// Fractions (`# ?/?`), and sections naming another calendar or numeral system (`[$-1010409]`).
    NotPrintedYet,
    /// More than 255 characters.
    TooLong,
}

impl NotShown {
    pub fn name(self) -> &'static str {
        match self {
            NotShown::NoSectionApplies => "noSectionApplies",
            NotShown::OutsideTheCalendar => "outsideTheCalendar",
            NotShown::NotPrintedYet => "notPrintedYet",
            NotShown::TooLong => "tooLong",
        }
    }
}

/// Where a value is shown: as text (what TEXT, copying and exporting give), or in a cell that holds at most so many
/// characters, which only General minds (`123456.789` in 7 is `123457`, in 5 `1E+05`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Room {
    AsText,
    InACell { most_characters: u32 },
}

/// A value as a pattern shows it.
#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub text: String,
    pub color: Option<Color>,
}

/// A pattern read.
#[derive(Clone, Debug)]
pub struct NumberFormat {
    sections: Vec<Section>,
    /// The section that shows texts, if any.
    text: Option<usize>,
}

/// The most characters a pattern may hold.
const LONGEST_PATTERN: usize = 254;
/// The most characters a number may be shown in.
const LONGEST_SHOWN: usize = 255;
/// The first and last days a date may fall on: 0001-01-01 and 9999-12-31.
const FIRST_SERIAL: i64 = -693_593;

impl NumberFormat {
    pub fn parse(pattern: &str) -> Result<NumberFormat, Refusal> {
        if pattern.is_empty() {
            return Err(Refusal::PatternEmpty);
        }
        let chars: Vec<char> = pattern.chars().collect();
        if chars.len() > LONGEST_PATTERN {
            return Err(Refusal::PatternTooLong);
        }
        if chars.iter().any(|c| c.is_control()) {
            return Err(Refusal::PatternHoldsControlCharacter);
        }
        let tokens = lex(&chars)?;
        let sections = tokens.split(|t| *t == Tok::Semicolon).map(section).collect::<Result<Vec<_>, _>>()?;
        if sections.len() > 4 {
            return Err(Refusal::TooManySections);
        }
        // In this order: a condition on the text section, a fourth section for numbers, `@` before the last section,
        // and a condition on a third section.
        let last = sections.len() - 1;
        let text = (sections.len() == 4 || sections[last].has_at).then_some(last);
        if text.is_some_and(|i| sections[i].condition.is_some()) {
            return Err(Refusal::ConditionOutOfPlace);
        }
        if sections.len() == 4 && sections[3].numeric {
            return Err(Refusal::FourthSectionNotForText);
        }
        if sections[..last].iter().any(|s| s.has_at) {
            return Err(Refusal::TextSectionNotLast);
        }
        if sections.iter().skip(2).any(|s| s.condition.is_some()) {
            return Err(Refusal::ConditionOutOfPlace);
        }
        Ok(NumberFormat { sections, text })
    }

    /// What a pattern shows, and whether it shows the hours of a half day: General and no for a pattern unread. The
    /// last pattern read is kept, as cells one after another mostly have the same.
    pub fn kind_of(pattern: &str) -> (Kind, bool) {
        thread_local! {
            static LAST: std::cell::RefCell<Option<(String, Kind, bool)>> = const { std::cell::RefCell::new(None) };
        }
        LAST.with_borrow_mut(|last| match last {
            Some((read, kind, half_days)) if read == pattern => (*kind, *half_days),
            _ => {
                let format = NumberFormat::parse(pattern).ok();
                let kind = format.as_ref().map_or(Kind::General, NumberFormat::kind);
                let half_days = format.as_ref().is_some_and(NumberFormat::shows_half_days);
                *last = Some((pattern.to_owned(), kind, half_days));
                (kind, half_days)
            }
        })
    }

    /// What the pattern shows: its first section's kind.
    pub fn kind(&self) -> Kind {
        self.sections[0].kind
    }

    /// A number as the first section shows it as a date or a time of day: the day (its serial) and the seconds into
    /// it, the time rounded to the fractions of a second the section shows. `None` for a section that shows neither
    /// (a duration among them), or a number outside the calendar.
    pub fn day_and_second(&self, n: f64) -> Option<(i64, i64)> {
        let Body::Date(shown) = &self.sections[0].body else { return None };
        if shown.kind == Kind::Duration || !(n > (FIRST_SERIAL - 1) as f64 && n < (dates::LAST_SERIAL + 2) as f64) {
            return None;
        }
        let unit = 10i64.pow(shown.decimals);
        let per_day = 86_400 * unit;
        let total = in_units(n, per_day);
        let day = total.div_euclid(per_day);
        (FIRST_SERIAL..=dates::LAST_SERIAL).contains(&day).then(|| (day, total.rem_euclid(per_day) / unit))
    }

    /// Whether the first section shows the hours of a half day (`AM/PM` or `A/P`).
    pub fn shows_half_days(&self) -> bool {
        matches!(&self.sections[0].body, Body::Date(dates) if dates.twelve_hours)
    }

    /// Whether a number is shown by a section of fractions (`# ?/?`, `0.00;# ?/?` for one below 0).
    pub fn shows_as_a_fraction(&self, n: f64) -> bool {
        let numbers: Vec<&Section> =
            self.sections.iter().enumerate().filter(|(i, _)| Some(*i) != self.text).map(|(_, s)| s).collect();
        !numbers.is_empty() && choose(&numbers, n).is_ok_and(|(section, _)| matches!(section.body, Body::Fraction(_)))
    }

    /// A number shown with the pattern as text, the en-US way: what TEXT gives.
    pub fn show_number(&self, n: f64) -> Result<Shown, NotShown> {
        self.show_number_in(n, locale::en_us(), Room::AsText)
    }

    /// A number shown with the pattern the way a locale shows it, in some room.
    pub fn show_number_in(&self, n: f64, locale: &Locale, room: Room) -> Result<Shown, NotShown> {
        let numbers: Vec<&Section> =
            self.sections.iter().enumerate().filter(|(i, _)| Some(*i) != self.text).map(|(_, s)| s).collect();
        if numbers.is_empty() {
            // Only a text section: numbers show as General.
            let sign = if n < 0.0 { "-" } else { "" };
            return fit(Shown { text: format!("{sign}{}", general(n.abs(), n < 0.0, locale, room)), color: None });
        }
        let (section, drop_sign) = choose(&numbers, n)?;
        if section.calendar {
            return Err(NotShown::NotPrintedYet);
        }
        let negative = n < 0.0 && !drop_sign;
        let text = match &section.body {
            Body::Fraction(fraction) => fraction.show(n.abs(), negative, locale),
            Body::Plain(pieces) => {
                let mut out = String::from(if negative { "-" } else { "" });
                for piece in pieces {
                    match piece {
                        Piece::Text(t) => out.push_str(t),
                        Piece::Value => out.push_str(&general(n.abs(), negative, locale, room)),
                    }
                }
                out
            }
            Body::Number(numbers) => numbers.show(n.abs(), negative, locale),
            Body::Date(dates) => dates.show(if drop_sign { n.abs() } else { n }, locale)?,
        };
        fit(Shown { text, color: section.color })
    }

    /// Whether every number the pattern may show is printed: none of its sections for numbers names another
    /// calendar or numeral system, or names months and days in a language dates aren't printed
    /// in. A cell is given only such a pattern (`numberFormatNotPrintedYet`).
    pub fn is_printed(&self) -> bool {
        self.sections.iter().enumerate().filter(|(i, _)| Some(*i) != self.text).all(|(_, s)| {
            !s.calendar && !matches!(&s.body, Body::Date(Dates { language: Language::Unknown, .. }))
        })
    }

    /// Whether a cell of another program pasted keeps the pattern as it is: it is printed, and it names months
    /// and days in no language but en-US (`[$-409]`, `[$-en-US]`) or the workbook's (`[$-407]dddd` and
    /// `[$-fr-FR]mmmm` are not kept, though printed).
    pub fn is_kept_when_pasted(&self) -> bool {
        self.is_printed()
            && self.sections.iter().enumerate().filter(|(i, _)| Some(*i) != self.text).all(|(_, s)| match &s.body {
                Body::Date(dates) => matches!(dates.language, Language::Workbook | Language::EnUs),
                _ => true,
            })
    }

    /// Whether the pattern has a section for texts: a fourth, or a last with `@`.
    pub fn shows_texts(&self) -> bool {
        self.text.is_some()
    }

    /// A text shown with the pattern: through its text section, else as it is.
    pub fn show_text(&self, t: &str) -> Shown {
        let Some(section) = self.text.map(|i| &self.sections[i]) else {
            return Shown { text: t.to_owned(), color: None };
        };
        let mut out = String::new();
        if let Body::Plain(pieces) = &section.body {
            for piece in pieces {
                match piece {
                    Piece::Text(s) => out.push_str(s),
                    Piece::Value => out.push_str(t),
                }
            }
        }
        Shown { text: out, color: section.color }
    }
}

/// A shown number, unless it is too long.
fn fit(shown: Shown) -> Result<Shown, NotShown> {
    if shown.text.chars().count() > LONGEST_SHOWN {
        return Err(NotShown::TooLong);
    }
    Ok(shown)
}

/// General's digits for `v` (not negative), with the locale's decimal sign. As text: 15 significant digits, written
/// out while that takes at most 20 characters, else with an exponent. In a cell: the most significant digits (15
/// down to 1) that fit, written out or else with an exponent (`1.2346E+14`); a `-` shown before them takes room too.
/// When even one digit doesn't fit, the shorter of the two ways with one digit.
fn general(v: f64, signed: bool, locale: &Locale, room: Room) -> String {
    let decimal = locale.decimal_sign.sign();
    let text = match room {
        Room::AsText => number_text(v),
        Room::InACell { most_characters } => {
            let room = (most_characters as usize).saturating_sub(usize::from(signed));
            fitted_general(v, room)
        }
    };
    if decimal == '.' {
        text
    } else {
        text.replace('.', &decimal.to_string())
    }
}

fn fitted_general(v: f64, room: usize) -> String {
    if v == 0.0 || !v.is_finite() {
        return "0".into();
    }
    // Fewer digits are rounded, half away from zero, from the 15 that General shows (so 2.4999999999999996, shown
    // as 2.5, is 3 in one character).
    let (_, all, exponent) = significant_digits(v, SIGNIFICANT_DIGITS);
    let ways = |count: usize| {
        let (digits, exponent) = rounded_digits(&all, exponent, count);
        (written_out(&digits, exponent), with_exponent(&digits, exponent))
    };
    for count in (1..=SIGNIFICANT_DIGITS).rev() {
        let (fixed, scientific) = ways(count);
        if fixed.chars().count() <= room {
            return fixed;
        }
        if scientific.chars().count() <= room {
            return scientific;
        }
    }
    let (fixed, scientific) = ways(1);
    if fixed.len() <= scientific.len() {
        fixed
    } else {
        scientific
    }
}

/// Significant digits (no trailing zeros) rounded half up to `count`, with the exponent they then have.
fn rounded_digits(digits: &str, exponent: i32, count: usize) -> (String, i32) {
    if digits.len() <= count {
        return (digits.to_owned(), exponent);
    }
    let mut kept: Vec<u8> = digits.as_bytes()[..count].to_vec();
    let mut exponent = exponent;
    if digits.as_bytes()[count] >= b'5' {
        let mut i = count;
        loop {
            if i == 0 {
                kept.insert(0, b'1');
                kept.pop();
                exponent += 1;
                break;
            }
            i -= 1;
            if kept[i] == b'9' {
                kept[i] = b'0';
            } else {
                kept[i] += 1;
                break;
            }
        }
    }
    while kept.len() > 1 && kept.last() == Some(&b'0') {
        kept.pop();
    }
    (String::from_utf8(kept).expect("digits"), exponent)
}

/// Digits written out with their point: `digits` × 10^(exponent - digits + 1).
fn written_out(digits: &str, exponent: i32) -> String {
    let len = digits.len() as i32;
    if exponent < 0 {
        format!("0.{}{}", "0".repeat((-exponent - 1) as usize), digits)
    } else if exponent + 1 >= len {
        format!("{}{}", digits, "0".repeat((exponent + 1 - len) as usize))
    } else {
        let (int, frac) = digits.split_at((exponent + 1) as usize);
        format!("{int}.{frac}")
    }
}

/// Digits with an exponent of at least two digits: `1.5E-20`, `1E+05`.
fn with_exponent(digits: &str, exponent: i32) -> String {
    let (first, rest) = digits.split_at(1);
    let mantissa = if rest.is_empty() { first.to_owned() } else { format!("{first}.{rest}") };
    format!("{mantissa}E{}{:02}", if exponent >= 0 { "+" } else { "-" }, exponent.abs())
}

/// The section that shows a number, and whether its sign is left out (a section for negative numbers).
fn choose<'a>(sections: &[&'a Section], n: f64) -> Result<(&'a Section, bool), NotShown> {
    let first = sections[0].condition;
    let second = sections.get(1).and_then(|s| s.condition);
    if first.is_none() && second.is_none() {
        return Ok(match sections.len() {
            1 => (sections[0], false),
            2 if n >= 0.0 => (sections[0], false),
            2 => (sections[1], true),
            _ if n > 0.0 => (sections[0], false),
            _ if n < 0.0 => (sections[1], true),
            _ => (sections[2], false),
        });
    }
    // With a condition, an unconditioned first section takes numbers above 0, an unconditioned second one all the
    // rest, and a third what neither took.
    let first = first.unwrap_or(Condition { op: Op::Gt, number: 0.0 });
    if first.holds(n) {
        return Ok((sections[0], first.means_negative()));
    }
    match (sections.get(1), second) {
        (None, _) => Err(NotShown::NoSectionApplies),
        (Some(s), None) => Ok((s, false)),
        (Some(s), Some(c)) if c.holds(n) => Ok((s, c.means_negative())),
        _ => sections.get(2).map(|s| (*s, false)).ok_or(NotShown::NoSectionApplies),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a pattern.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Op {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

/// A section's condition, `[>=100]`: numbers compare to 15 significant digits.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Condition {
    op: Op,
    number: f64,
}

impl Condition {
    fn holds(self, n: f64) -> bool {
        let order = coerce::compare_numbers(n, self.number);
        match self.op {
            Op::Eq => order == Ordering::Equal,
            Op::Ne => order != Ordering::Equal,
            Op::Lt => order == Ordering::Less,
            Op::Le => order != Ordering::Greater,
            Op::Gt => order == Ordering::Greater,
            Op::Ge => order != Ordering::Less,
        }
    }

    /// Whether only negative numbers meet it: their section shows them without the sign.
    fn means_negative(self) -> bool {
        match self.op {
            Op::Lt => self.number <= 0.0,
            Op::Le | Op::Eq => self.number < 0.0,
            _ => false,
        }
    }
}

/// A piece of a pattern.
#[derive(Clone, Debug, PartialEq)]
enum Tok {
    /// Shown as it is: `"text"`, `\x`, and characters that need no quotes (`-`, `(`, `$`, `€`, …).
    Literal(String),
    /// `_x`: a space as wide as x.
    Space,
    /// `*x`: x repeated to fill the cell; nothing in a text.
    Fill,
    Semicolon,
    Color(Color),
    Condition(Condition),
    /// `[h]`, `[mm]`, `[ss]`: elapsed hours, minutes or seconds, and how many digits at least.
    Elapsed(u8, usize),
    /// `[$cur-lang]`: the currency is shown where it stands; the language names months and days.
    Locale { currency: String, calendar: bool, language: Language },
    General,
    At,
    Zero,
    Hash,
    Question,
    Point,
    Comma,
    Percent,
    Slash,
    Exponent { upper: bool, plus: bool },
    /// 1 to 9, which only a fraction's denominator may hold.
    Digit(char),
    /// A date or time code: `y`, `m`, `d`, `h` or `s`, and how many.
    Code(u8, usize),
    AmPm,
    /// `A/P`, with the letters as written.
    AOrP(char, char),
}

/// The language a section names its months and days in.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Language {
    /// None named, or the system's (`[$-F800]`, `[$-F400]`, `[$-x-sysdate]`): the workbook's locale.
    Workbook,
    /// en-US's, named by its number or its tag (`[$-409]`, `[$-en-US]`).
    EnUs,
    Named(&'static Names),
    /// One dates aren't printed in.
    Unknown,
}

impl Language {
    fn names(self, locale: &Locale) -> Option<&'static Names> {
        match self {
            Language::Workbook => Some(locale.names()),
            Language::EnUs => Some(&names::EN_US),
            Language::Named(names) => Some(names),
            Language::Unknown => None,
        }
    }
}

fn is_placeholder(t: &Tok) -> bool {
    matches!(t, Tok::Zero | Tok::Hash | Tok::Question)
}

fn is_date_part(t: &Tok) -> bool {
    matches!(t, Tok::Code(..) | Tok::AmPm | Tok::AOrP(..) | Tok::Elapsed(..))
}

/// The pattern's pieces; the first error by position.
fn lex(chars: &[char]) -> Result<Vec<Tok>, Refusal> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        i += 1;
        let tok = match c {
            '"' => {
                let len = chars[i..].iter().position(|&d| d == '"').ok_or(Refusal::QuoteNotClosed)?;
                let t = chars[i..i + len].iter().collect();
                i += len + 1;
                Tok::Literal(t)
            }
            '\\' | '_' | '*' => {
                let next = *chars.get(i).ok_or(Refusal::NothingAfterEscape)?;
                i += 1;
                match c {
                    '\\' => Tok::Literal(next.into()),
                    '_' => Tok::Space,
                    _ => Tok::Fill,
                }
            }
            '[' => {
                let len = chars[i..].iter().position(|&d| d == ']').ok_or(Refusal::BracketNotClosed)?;
                let content: String = chars[i..i + len].iter().collect();
                i += len + 1;
                bracket(&content)?
            }
            ';' => Tok::Semicolon,
            '0' => Tok::Zero,
            '#' => Tok::Hash,
            '?' => Tok::Question,
            '.' => Tok::Point,
            ',' => Tok::Comma,
            '%' => Tok::Percent,
            '/' => Tok::Slash,
            '@' => Tok::At,
            '1'..='9' => Tok::Digit(c),
            ' ' | '!' | '&' | '\'' | '(' | ')' | '+' | '-' | ':' | '<' | '=' | '>' | '^' | '{' | '}' | '~' | '$' => {
                Tok::Literal(c.into())
            }
            c if !c.is_ascii() => Tok::Literal(c.into()),
            c if c.is_ascii_alphabetic() => {
                let rest = &chars[i - 1..];
                let starts = |word: &str| {
                    word.chars().enumerate().all(|(k, w)| rest.get(k).is_some_and(|r| r.eq_ignore_ascii_case(&w)))
                };
                let lower = c.to_ascii_lowercase();
                if starts("general") {
                    i += 6;
                    Tok::General
                } else if starts("am/pm") {
                    i += 4;
                    Tok::AmPm
                } else if starts("a/p") {
                    i += 2;
                    Tok::AOrP(rest[0], rest[2])
                } else if lower == 'e' && matches!(rest.get(1), Some('+' | '-')) {
                    i += 1;
                    Tok::Exponent { upper: c == 'E', plus: rest[1] == '+' }
                } else if "ymdhs".contains(lower) {
                    let run = rest.iter().take_while(|r| r.to_ascii_lowercase() == lower).count();
                    i += run - 1;
                    Tok::Code(lower as u8, run)
                } else {
                    return Err(Refusal::CharacterNeedsQuotes);
                }
            }
            // `]`, `` ` `` and `|`.
            _ => return Err(Refusal::CharacterNeedsQuotes),
        };
        out.push(tok);
    }
    Ok(out)
}

const COLORS: [&str; 8] = ["black", "blue", "cyan", "green", "magenta", "red", "white", "yellow"];

/// What a `[…]` holds: a colour, a condition, elapsed time, or a currency and language.
fn bracket(content: &str) -> Result<Tok, Refusal> {
    let lower = content.to_ascii_lowercase();
    if let Some(name) = COLORS.iter().find(|name| **name == lower) {
        return Ok(Tok::Color(Color::Named(name)));
    }
    if let Some(n) = lower.strip_prefix("color") {
        if !n.starts_with('0') && n.len() <= 2 {
            if let Ok(n @ 1..=56) = n.parse::<u8>() {
                return Ok(Tok::Color(Color::Indexed(n)));
            }
        }
    }
    if let Some(rest) = content.strip_prefix('$') {
        return locale(rest).ok_or(Refusal::BracketNotKnown);
    }
    let ops = [("<=", Op::Le), (">=", Op::Ge), ("<>", Op::Ne), ("<", Op::Lt), (">", Op::Gt), ("=", Op::Eq)];
    if let Some((op, rest)) = ops.iter().find_map(|(s, op)| content.strip_prefix(s).map(|rest| (*op, rest))) {
        let number = condition_number(rest).ok_or(Refusal::BracketNotKnown)?;
        return Ok(Tok::Condition(Condition { op, number }));
    }
    let first = lower.bytes().next();
    if matches!(first, Some(b'h' | b'm' | b's')) && lower.bytes().all(|b| Some(b) == first) {
        return Ok(Tok::Elapsed(first.unwrap_or(b'h'), lower.len()));
    }
    Err(Refusal::BracketNotKnown)
}

/// `[$€-409]`: a currency up to the first `-`, then a language tag of letters and digits. A tag of up to eight
/// hexadecimal digits is a language number: dates are printed only in 409 (en-US) and in F800 and F400 (the
/// workbook's), and an upper half that isn't 0 names a calendar or numeral system. Other tags print dates if
/// their names are known.
fn locale(rest: &str) -> Option<Tok> {
    let (currency, language) = match rest.split_once('-') {
        Some((currency, language)) => (currency, Some(language)),
        None => (rest, None),
    };
    let (calendar, language) = match language {
        None if currency.is_empty() => return None,
        None => (false, Language::Workbook),
        Some(tag) => {
            if tag.split('-').any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_alphanumeric())) {
                return None;
            }
            match u32::from_str_radix(tag, 16).ok().filter(|_| tag.len() <= 8) {
                Some(n) => (
                    n >> 16 != 0,
                    match n {
                        0x409 => Language::EnUs,
                        0xF800 | 0xF400 => Language::Workbook,
                        _ => Language::Unknown,
                    },
                ),
                None if tag.eq_ignore_ascii_case("x-sysdate") || tag.eq_ignore_ascii_case("x-systime") => {
                    (false, Language::Workbook)
                }
                None if tag.eq_ignore_ascii_case("en-US") => (false, Language::EnUs),
                None => (false, names::find(tag).map_or(Language::Unknown, Language::Named)),
            }
        }
    };
    Some(Tok::Locale { currency: currency.into(), calendar, language })
}

/// A condition's number: digits with an optional `-`, point and exponent (`-.5`, `1e3`), and finite.
fn condition_number(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let digits_from = |mut i: usize| {
        while b.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        i
    };
    let mut i = usize::from(b.first() == Some(&b'-'));
    let int_end = digits_from(i);
    let mut digits = int_end - i;
    i = int_end;
    if b.get(i) == Some(&b'.') {
        let end = digits_from(i + 1);
        digits += end - i - 1;
        i = end;
    }
    if digits == 0 {
        return None;
    }
    if matches!(b.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(b.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        let end = digits_from(i);
        if end == i {
            return None;
        }
        i = end;
    }
    if i != b.len() {
        return None;
    }
    s.parse::<f64>().ok().filter(|n| n.is_finite())
}

/// Whether a character is a currency symbol (Unicode's Sc).
fn is_currency_symbol(c: char) -> bool {
    matches!(c as u32,
        0x24 | 0xA2..=0xA5 | 0x58F | 0x60B | 0x7FE..=0x7FF | 0x9F2..=0x9F3 | 0x9FB | 0xAF1 | 0xBF9 | 0xE3F
        | 0x17DB | 0x20A0..=0x20C1 | 0xA838 | 0xFDFC | 0xFE69 | 0xFF04 | 0xFFE0..=0xFFE1 | 0xFFE5..=0xFFE6
        | 0x11FDD..=0x11FE0 | 0x1E2FF | 0x1ECB0)
}

// ---------------------------------------------------------------------------------------------------------------
// Sections.

#[derive(Clone, Debug)]
struct Section {
    color: Option<Color>,
    condition: Option<Condition>,
    /// It names a calendar or numeral system.
    calendar: bool,
    kind: Kind,
    /// It holds `@`.
    has_at: bool,
    /// It shows a number in digits or as a date: no use as a fourth section.
    numeric: bool,
    body: Body,
}

#[derive(Clone, Debug)]
enum Body {
    /// Text around General or `@` (or around nothing).
    Plain(Vec<Piece>),
    Number(Numbers),
    Fraction(Fraction),
    Date(Dates),
}

#[derive(Clone, Debug)]
enum Piece {
    Text(String),
    /// General's number, or `@`'s text.
    Value,
}

/// What kind of tokens a section holds; a section holds one kind.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Group {
    Text,
    General,
    Date,
    Number,
}

fn section(tokens: &[Tok]) -> Result<Section, Refusal> {
    let calendar = tokens.iter().any(|t| matches!(t, Tok::Locale { calendar: true, .. }));
    let language =
        tokens.iter().find_map(|t| if let Tok::Locale { language, .. } = t { Some(*language) } else { None });
    // A colour and a condition may only lead the section, one of each, and a currency or language comes once: the
    // first error by position. A language without a currency (`[$-409]`) stands nowhere.
    let (mut color, mut condition, mut leading, mut locales) = (None, None, true, 0);
    let mut body = Vec::new();
    for t in tokens {
        if let Tok::Locale { currency, .. } = t {
            locales += 1;
            if locales > 1 {
                return Err(Refusal::CurrencyOrLanguageNamedTwice);
            }
            if currency.is_empty() {
                continue;
            }
        }
        match t {
            Tok::Color(c) if leading && color.is_none() => color = Some(*c),
            Tok::Color(_) => return Err(Refusal::ColorOutOfPlace),
            Tok::Condition(c) if leading && condition.is_none() => condition = Some(*c),
            Tok::Condition(_) => return Err(Refusal::ConditionOutOfPlace),
            t => {
                leading = false;
                body.push(t.clone());
            }
        }
    }
    let count = |f: fn(&Tok) -> bool| body.iter().filter(|t| f(t)).count();
    if count(|t| *t == Tok::Fill) > 1 {
        return Err(Refusal::SecondFill);
    }
    if count(|t| *t == Tok::At) > 1 {
        return Err(Refusal::TextPlacedTwice);
    }
    let group = if body.contains(&Tok::At) {
        Group::Text
    } else if body.contains(&Tok::General) {
        Group::General
    } else if body.iter().any(is_date_part) {
        Group::Date
    } else {
        Group::Number
    };
    scan(&body, group)?;
    let mut section = Section {
        color,
        condition,
        calendar,
        kind: Kind::Number,
        has_at: group == Group::Text,
        numeric: false,
        body: Body::Plain(Vec::new()),
    };
    match group {
        Group::Text | Group::General => {
            section.kind = if group == Group::Text { Kind::Text } else { Kind::General };
            section.body = Body::Plain(plain(&body));
        }
        // Nothing but a colour or a condition: General.
        Group::Number if body.is_empty() && (color.is_some() || condition.is_some()) => {
            section.kind = Kind::General;
            section.body = Body::Plain(vec![Piece::Value]);
        }
        Group::Date => {
            let dates = Dates::read(&body, language.unwrap_or(Language::Workbook))?;
            section.kind = dates.kind;
            section.numeric = true;
            section.body = Body::Date(dates);
        }
        Group::Number => {
            let currency = body.iter().any(|t| match t {
                Tok::Literal(s) => s.chars().any(is_currency_symbol),
                Tok::Locale { currency, .. } => !currency.is_empty(),
                _ => false,
            });
            section.numeric = body.iter().any(|t| is_placeholder(t) || matches!(t, Tok::Point | Tok::Percent));
            if let Some(slash) = fraction_slash(&body) {
                section.body = Body::Fraction(Fraction::read(&body, slash)?);
                section.kind = Kind::Fraction;
                return Ok(section);
            }
            if body.iter().any(|t| matches!(t, Tok::Digit(_))) {
                return Err(Refusal::CharacterNeedsQuotes);
            }
            check_number(&body)?;
            section.kind = if body.contains(&Tok::Percent) {
                Kind::Percent
            } else if body.iter().any(|t| matches!(t, Tok::Exponent { .. })) {
                Kind::Scientific
            } else if currency {
                Kind::Currency
            } else {
                Kind::Number
            };
            section.body = if body.iter().any(|t| is_placeholder(t) || *t == Tok::Point) {
                Body::Number(Numbers::read(&body))
            } else {
                Body::Plain(plain(&body))
            };
        }
    }
    Ok(section)
}

/// The tokens' text, with `@` and General as the value.
fn plain(body: &[Tok]) -> Vec<Piece> {
    let mut out = Vec::new();
    for t in body {
        match t {
            Tok::At | Tok::General => out.push(Piece::Value),
            t => {
                if let Some(s) = literal_text(t) {
                    out.push(Piece::Text(s));
                }
            }
        }
    }
    out
}

/// The text a literal token shows: none for a fill.
fn literal_text(t: &Tok) -> Option<String> {
    match t {
        Tok::Literal(s) => Some(s.clone()),
        Tok::Locale { currency, .. } if !currency.is_empty() => Some(currency.clone()),
        Tok::Space => Some(" ".into()),
        Tok::Point => Some(".".into()),
        Tok::Comma => Some(",".into()),
        Tok::Slash => Some("/".into()),
        Tok::Percent => Some("%".into()),
        _ => None,
    }
}

/// Every token fits the section's kind, in order: one of another kind mixes kinds. In a date, `.0` after seconds
/// is a fraction of a second, and `.`, `,` and `/` are shown as they are.
fn scan(body: &[Tok], group: Group) -> Result<(), Refusal> {
    let mixes = Err(Refusal::SectionMixesKinds);
    let mut generals = 0;
    let mut i = 0;
    while i < body.len() {
        let t = &body[i];
        i += 1;
        if matches!(t, Tok::Literal(_) | Tok::Space | Tok::Fill | Tok::Locale { .. }) {
            continue;
        }
        match group {
            Group::Text if *t != Tok::At => return mixes,
            Group::General if *t != Tok::General => return mixes,
            Group::General => {
                generals += 1;
                if generals > 1 {
                    return mixes;
                }
            }
            Group::Date => match t {
                Tok::Point if i >= 2 && matches!(body[i - 2], Tok::Code(b's', _) | Tok::Elapsed(b's', _)) => {
                    let zeros = body[i..].iter().take_while(|t| **t == Tok::Zero).count();
                    if zeros > 3 {
                        return Err(Refusal::TooManyDecimalsOfASecond);
                    }
                    i += zeros;
                }
                Tok::Digit(_) => return Err(Refusal::CharacterNeedsQuotes),
                t if is_date_part(t) || matches!(t, Tok::Point | Tok::Comma | Tok::Slash) => {}
                _ => return mixes,
            },
            Group::Text | Group::Number => {}
        }
    }
    Ok(())
}

/// The `/` of a fraction: right after a placeholder, right before a placeholder or a digit.
fn fraction_slash(body: &[Tok]) -> Option<usize> {
    (1..body.len().saturating_sub(1)).find(|&i| {
        body[i] == Tok::Slash
            && is_placeholder(&body[i - 1])
            && (is_placeholder(&body[i + 1]) || matches!(body[i + 1], Tok::Digit(_)))
    })
}

/// One point, commas only after placeholders (grouping between them, scaling after the last), one exponent, and no
/// comma or percent with it, the first error by position; then the exponent between placeholders.
fn check_number(body: &[Tok]) -> Result<(), Refusal> {
    let exponents: Vec<usize> = (0..body.len()).filter(|&i| matches!(body[i], Tok::Exponent { .. })).collect();
    let (mut point, mut exponent) = (false, false);
    for (i, t) in body.iter().enumerate() {
        match t {
            Tok::Point if exponent => return Err(Refusal::ExponentNotWellFormed),
            Tok::Point if point => return Err(Refusal::SecondDecimalPoint),
            Tok::Point => point = true,
            Tok::Comma if !exponents.is_empty() || !comma_fits(body, i, point) => {
                return Err(Refusal::CommaOutOfPlace);
            }
            Tok::Exponent { .. } if exponent => return Err(Refusal::ExponentNotWellFormed),
            Tok::Exponent { .. } => exponent = true,
            Tok::Percent if !exponents.is_empty() => return Err(Refusal::SectionMixesKinds),
            _ => {}
        }
    }
    if let Some(&e) = exponents.first() {
        if !body[..e].iter().any(is_placeholder) || !body[e + 1..].iter().any(is_placeholder) {
            return Err(Refusal::ExponentNotWellFormed);
        }
    }
    Ok(())
}

/// A run of commas follows a placeholder; one comma before another placeholder of the integer groups thousands,
/// and commas after the last placeholder scale by a thousand each.
fn comma_fits(body: &[Tok], i: usize, after_point: bool) -> bool {
    let start = (0..=i).rev().take_while(|&k| body[k] == Tok::Comma).last().unwrap_or(i);
    let end = (i..body.len()).find(|&k| body[k] != Tok::Comma).unwrap_or(body.len());
    if start == 0 || !is_placeholder(&body[start - 1]) {
        return false;
    }
    match body.get(end) {
        Some(t) if is_placeholder(t) => end - start == 1 && !after_point,
        _ => !body[end..].iter().any(is_placeholder),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers in digits.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Ph {
    Zero,
    Hash,
    Question,
}

impl Ph {
    fn read(token: &Tok) -> Option<Ph> {
        match token {
            Tok::Zero => Some(Ph::Zero),
            Tok::Hash => Some(Ph::Hash),
            Tok::Question => Some(Ph::Question),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
enum Item {
    Text(String),
    /// An integer placeholder, counted from the right.
    Int(Ph, usize),
    Point,
    /// A decimal placeholder, counted from the left.
    Decimal(usize),
    Exponent { upper: bool, plus: bool },
    /// A placeholder of the exponent, counted from the right.
    Power(Ph, usize),
}

#[derive(Clone, Debug)]
struct Numbers {
    items: Vec<Item>,
    integers: usize,
    decimals: Vec<Ph>,
    powers: usize,
    grouping: bool,
    /// Powers of ten the number is moved by: 2 for each `%`, -3 for each scaling comma.
    shift: i32,
    exponent: bool,
}

impl Numbers {
    fn read(body: &[Tok]) -> Numbers {
        let mut n = Numbers {
            items: Vec::new(),
            integers: 0,
            decimals: Vec::new(),
            powers: 0,
            grouping: false,
            shift: 0,
            exponent: false,
        };
        let (mut point, mut exponent) = (false, false);
        for (i, t) in body.iter().enumerate() {
            if let Some(ph) = Ph::read(t) {
                n.items.push(if exponent {
                    n.powers += 1;
                    Item::Power(ph, 0)
                } else if point {
                    n.decimals.push(ph);
                    Item::Decimal(n.decimals.len() - 1)
                } else {
                    n.integers += 1;
                    Item::Int(ph, 0)
                });
                continue;
            }
            match t {
                Tok::Point if !exponent => {
                    point = true;
                    n.items.push(Item::Point);
                }
                Tok::Exponent { upper, plus } => {
                    exponent = true;
                    n.exponent = true;
                    n.items.push(Item::Exponent { upper: *upper, plus: *plus });
                }
                Tok::Comma => {
                    if body.get(i + 1).is_some_and(is_placeholder) {
                        n.grouping = true;
                    } else {
                        n.shift -= 3;
                    }
                }
                Tok::Percent => {
                    n.shift += 2;
                    n.items.push(Item::Text("%".into()));
                }
                t => {
                    if let Some(s) = literal_text(t) {
                        n.items.push(Item::Text(s));
                    }
                }
            }
        }
        // Count integer and exponent placeholders from the right.
        let (mut int, mut pow) = (n.integers, n.powers);
        for item in &mut n.items {
            match item {
                Item::Int(_, k) => {
                    int -= 1;
                    *k = int;
                }
                Item::Power(_, k) => {
                    pow -= 1;
                    *k = pow;
                }
                _ => {}
            }
        }
        n
    }

    /// `v` (not negative) shown, after a `-` when `negative` and it doesn't round to 0.
    fn show(&self, v: f64, negative: bool, locale: &Locale) -> String {
        let groups = Groups { sign: locale.group_sign.sign(), sizes: locale.sizes_of_groups, on: self.grouping };
        let decimal = locale.decimal_sign.sign();
        let (int, dec, power) = if self.exponent {
            scientific(v, self.integers.max(1), self.decimals.len())
        } else {
            let (int, dec) = fixed(v, self.shift, self.decimals.len());
            (int, dec, 0)
        };
        let zero = int.is_empty() && dec.bytes().all(|b| b == b'0');
        let mut out = String::from(if negative && !zero { "-" } else { "" });
        // A 0 with only 0s after it: `#` hides it and `?` shows a space.
        let last = dec.bytes().rposition(|b| b != b'0').map_or(0, |k| k + 1);
        let shown: Vec<Option<char>> = (self.decimals.iter().zip(dec.chars()).enumerate())
            .map(|(k, (ph, d))| match ph {
                Ph::Hash if k >= last => None,
                Ph::Question if k >= last => Some(' '),
                _ => Some(d),
            })
            .collect();
        let power_digits = if power == 0 { String::new() } else { power.unsigned_abs().to_string() };
        for item in &self.items {
            match item {
                Item::Text(s) => out.push_str(s),
                Item::Int(ph, k) => integer_digit(&mut out, *ph, *k, self.integers, int.as_bytes(), groups),
                Item::Point => {
                    if self.integers == 0 {
                        out.push_str(&int);
                    }
                    out.push(decimal);
                }
                Item::Decimal(k) => out.extend(shown[*k]),
                Item::Exponent { upper, plus } => {
                    out.push(if *upper { 'E' } else { 'e' });
                    if power < 0 {
                        out.push('-');
                    } else if *plus {
                        out.push('+');
                    }
                }
                Item::Power(ph, k) => {
                    let groups = Groups { on: false, ..groups };
                    integer_digit(&mut out, *ph, *k, self.powers, power_digits.as_bytes(), groups)
                }
            }
        }
        out
    }
}

/// How the whole part's digits are grouped: whether they are, with what sign, in what sizes.
#[derive(Clone, Copy)]
struct Groups {
    sign: char,
    sizes: locale::SizesOfGroups,
    on: bool,
}

/// The digit of the `k`th integer placeholder from the right, of `count`: the leftmost one also takes the digits
/// there's no placeholder for. Where there's no digit, `0` shows 0, `?` a space and `#` nothing. With grouping, the
/// group sign follows each group's first digit (a space after a `?`'s space, nothing after a `#`).
fn integer_digit(out: &mut String, ph: Ph, k: usize, count: usize, digits: &[u8], groups: Groups) {
    let len = digits.len();
    if k + 1 == count && len > count {
        for (i, d) in digits[..len - count].iter().enumerate() {
            out.push(*d as char);
            if groups.on && groups.sizes.sign_after(len - 1 - i) {
                out.push(groups.sign);
            }
        }
    }
    let (digit, separator) = if k < len {
        (Some(digits[len - 1 - k] as char), Some(groups.sign))
    } else {
        match ph {
            Ph::Zero => (Some('0'), Some(groups.sign)),
            Ph::Question => (Some(' '), Some(' ')),
            Ph::Hash => (None, None),
        }
    };
    out.extend(digit);
    if groups.on && groups.sizes.sign_after(k) {
        out.extend(separator);
    }
}

/// `v` rounded to `decimals` places after moving it `shift` powers of ten: its integer digits (none for 0) and its
/// decimals. The number is first rounded to 15 significant digits, then half away from 0 in decimal.
fn fixed(v: f64, shift: i32, decimals: usize) -> (String, String) {
    if v == 0.0 {
        return (String::new(), "0".repeat(decimals));
    }
    let (_, digits, exponent) = significant_digits(v, SIGNIFICANT_DIGITS);
    round_digits(&digits, exponent + shift, decimals)
}

/// Digits whose first is at 10^`exponent`, rounded half up to `decimals` places: the integer digits (no leading
/// zeros) and the decimals.
fn round_digits(digits: &str, exponent: i32, decimals: usize) -> (String, String) {
    let (e, d) = (exponent as i64, decimals as i64);
    let top = e.max(0);
    let mut out = vec![b'0'; (top + d + 1) as usize];
    for (k, b) in digits.bytes().enumerate() {
        let power = e - k as i64;
        if power >= -d {
            out[(top - power) as usize] = b;
        }
    }
    let dropped = e + d + 1;
    if dropped >= 0 && digits.as_bytes().get(dropped as usize).is_some_and(|b| *b >= b'5') {
        let mut i = out.len();
        loop {
            if i == 0 {
                out.insert(0, b'1');
                break;
            }
            i -= 1;
            if out[i] == b'9' {
                out[i] = b'0';
            } else {
                out[i] += 1;
                break;
            }
        }
    }
    let split = out.len() - decimals;
    let int = String::from_utf8_lossy(&out[..split]).trim_start_matches('0').to_owned();
    let dec = String::from_utf8_lossy(&out[split..]).into_owned();
    (int, dec)
}

/// `v` as a mantissa and a power of ten that is a multiple of `integers` (the integer placeholders), the mantissa
/// rounded to `decimals` places.
fn scientific(v: f64, integers: usize, decimals: usize) -> (String, String, i32) {
    if v == 0.0 {
        return (String::new(), "0".repeat(decimals), 0);
    }
    let (_, digits, mut e) = significant_digits(v, SIGNIFICANT_DIGITS);
    let n = integers as i32;
    let mut power = e.div_euclid(n) * n;
    let (mut int, mut dec) = round_digits(&digits, e - power, decimals);
    if int.len() as i32 > e - power + 1 {
        // Rounded up to the next power of ten.
        e += 1;
        power = e.div_euclid(n) * n;
        (int, dec) = round_digits("1", e - power, decimals);
    }
    (int, dec, power)
}

// ---------------------------------------------------------------------------------------------------------------
// Dates, times and durations.

#[derive(Clone, Debug)]
enum DateItem {
    Text(String),
    Year(usize),
    Month(usize),
    Day(usize),
    Hour(usize),
    Minute(usize),
    Second(usize),
    /// Digits of a fraction of a second.
    Fraction(usize),
    AmPm,
    AOrP(char, char),
    /// Elapsed hours, minutes or seconds, and how many digits at least.
    Elapsed(u8, usize),
    /// A `/` (not `\/` or `"/"`): it joins codes into `m/d/yyyy` and `m/d`.
    Slash,
    /// `m/d/yyyy`, shown as the locale shows a short date.
    ShortDate,
    /// `m/d`, shown as the locale shows a month and a day.
    MonthAndDay,
}

impl DateItem {
    fn is_code(&self) -> bool {
        !matches!(self, DateItem::Text(_) | DateItem::Fraction(_) | DateItem::Slash)
    }
}

/// Days as a whole count of `per_day` units, rounded half up from the count's first 15 significant digits (so that
/// 215089.2266072333 days is 18583709178.87 seconds, from 18583709178.8650, not .86).
fn in_units(days: f64, per_day: i64) -> i64 {
    let count: f64 = format!("{:.*e}", SIGNIFICANT_DIGITS - 1, days * per_day as f64).parse().expect("a number");
    count.round() as i64
}

/// `m/d/yyyy` (with three or more `y`) and `m/d`, codes joined by `/` and nothing else around them, become the
/// locale's short date and month and day: unless the next code after them is seconds, which takes
/// their `m` for minutes there (though not when showing it).
fn localize_dates(items: Vec<DateItem>) -> Vec<DateItem> {
    let mut out = Vec::with_capacity(items.len());
    let mut i = 0;
    while i < items.len() {
        if !items[i].is_code() || (i > 0 && matches!(items[i - 1], DateItem::Slash)) {
            out.push(items[i].clone());
            i += 1;
            continue;
        }
        // A run of codes joined by single slashes, not followed by a slash.
        let mut end = i + 1;
        while end + 1 < items.len() && matches!(items[end], DateItem::Slash) && items[end + 1].is_code() {
            end += 2;
        }
        let run = &items[i..end];
        let dangling = matches!(items.get(end), Some(DateItem::Slash));
        let next_is_seconds = items[end..]
            .iter()
            .find(|it| it.is_code())
            .is_some_and(|it| matches!(it, DateItem::Second(_) | DateItem::Elapsed(b's', _)));
        let shape = match run {
            [DateItem::Month(1), DateItem::Slash, DateItem::Day(1), DateItem::Slash, DateItem::Year(y)] if *y >= 3 => {
                Some(DateItem::ShortDate)
            }
            [DateItem::Month(1), DateItem::Slash, DateItem::Day(1)] => Some(DateItem::MonthAndDay),
            _ => None,
        };
        match shape {
            Some(shape) if !dangling && !next_is_seconds => out.push(shape),
            _ => out.extend(run.iter().cloned()),
        }
        i = end;
    }
    out
}

#[derive(Clone, Debug)]
struct Dates {
    items: Vec<DateItem>,
    kind: Kind,
    /// The most digits of a fraction of a second: the time is rounded to them.
    decimals: u32,
    twelve_hours: bool,
    /// The language months and days are named in.
    language: Language,
    /// It shows the day of the month: some languages name months differently then (`1 сентября`).
    with_day: bool,
    /// What the smallest unit of time shown is worth in rounded units: a negative duration that rounds to less than
    /// it is shown without its `-`.
    smallest: i64,
}

/// The `n`th name in a list joined with `|`.
fn nth(list: &str, n: usize) -> &str {
    list.split('|').nth(n).unwrap_or("")
}

impl Dates {
    fn read(body: &[Tok], language: Language) -> Result<Dates, Refusal> {
        let parts: Vec<usize> = (0..body.len()).filter(|&i| is_date_part(&body[i])).collect();
        let mut items = Vec::new();
        let mut i = 0;
        while i < body.len() {
            let t = &body[i];
            i += 1;
            let item = match t {
                Tok::Code(b'y', n) => DateItem::Year(*n),
                Tok::Code(b'd', n) => DateItem::Day(*n),
                Tok::Code(b'h', n) => DateItem::Hour(*n),
                Tok::Code(b's', n) => DateItem::Second(*n),
                Tok::Code(_, n) => {
                    // `m` and `mm` are minutes after hours or before seconds, else the month.
                    let at = parts.iter().position(|&p| p == i - 1).unwrap_or(0);
                    let before = at.checked_sub(1).map(|k| &body[parts[k]]);
                    let after = parts.get(at + 1).map(|&k| &body[k]);
                    let minutes = *n <= 2
                        && (matches!(before, Some(Tok::Code(b'h', _) | Tok::Elapsed(b'h', _)))
                            || matches!(after, Some(Tok::Code(b's', _) | Tok::Elapsed(b's', _))));
                    if minutes {
                        DateItem::Minute(*n)
                    } else {
                        DateItem::Month(*n)
                    }
                }
                Tok::AmPm => DateItem::AmPm,
                Tok::AOrP(a, p) => DateItem::AOrP(*a, *p),
                Tok::Elapsed(unit, n) => DateItem::Elapsed(*unit, *n),
                Tok::Point if i >= 2 && matches!(body[i - 2], Tok::Code(b's', _) | Tok::Elapsed(b's', _)) => {
                    let zeros = body[i..].iter().take_while(|t| **t == Tok::Zero).count();
                    if zeros == 0 {
                        DateItem::Text(".".into())
                    } else {
                        i += zeros;
                        DateItem::Fraction(zeros)
                    }
                }
                Tok::Slash => DateItem::Slash,
                t => match literal_text(t) {
                    Some(s) => DateItem::Text(s),
                    None => continue,
                },
            };
            items.push(item);
        }
        // Elapsed time: one unit, and only smaller units of time with it.
        let rank = |item: &DateItem| match item {
            DateItem::Hour(_) | DateItem::Elapsed(b'h', _) => Some(3),
            DateItem::Minute(_) | DateItem::Elapsed(b'm', _) => Some(2),
            DateItem::Second(_) | DateItem::Elapsed(_, _) => Some(1),
            DateItem::Year(_) | DateItem::Month(_) | DateItem::Day(_) | DateItem::AmPm | DateItem::AOrP(..) => Some(9),
            _ => None,
        };
        let elapsed: Vec<&DateItem> = items.iter().filter(|it| matches!(it, DateItem::Elapsed(..))).collect();
        if elapsed.len() > 1 {
            return Err(Refusal::ElapsedTimeNotWellFormed);
        }
        if let Some(e) = elapsed.first() {
            let top = rank(e);
            let fits = items.iter().all(|it| matches!(it, DateItem::Elapsed(..)) || rank(it).is_none_or(|r| Some(r) < top));
            if !fits {
                return Err(Refusal::ElapsedTimeNotWellFormed);
            }
        }
        let has = |f: fn(&DateItem) -> bool| items.iter().any(f);
        let date = has(|it| matches!(it, DateItem::Year(_) | DateItem::Month(_) | DateItem::Day(_)));
        let time = has(|it| {
            matches!(it, DateItem::Hour(_) | DateItem::Minute(_) | DateItem::Second(_) | DateItem::AmPm | DateItem::AOrP(..))
        });
        let kind = if !elapsed.is_empty() {
            Kind::Duration
        } else if date && time {
            Kind::DateAndTime
        } else if date {
            Kind::Date
        } else {
            Kind::Time
        };
        let decimals =
            items.iter().filter_map(|it| if let DateItem::Fraction(n) = it { Some(*n as u32) } else { None }).max();
        let twelve_hours = has(|it| matches!(it, DateItem::AmPm | DateItem::AOrP(..)));
        let with_day = has(|it| matches!(it, DateItem::Day(n) if *n <= 2));
        let decimals = decimals.unwrap_or(0);
        let unit = 10i64.pow(decimals);
        let smallest = items
            .iter()
            .filter_map(|it| match it {
                DateItem::Hour(_) | DateItem::Elapsed(b'h', _) => Some(3600 * unit),
                DateItem::Minute(_) | DateItem::Elapsed(b'm', _) => Some(60 * unit),
                DateItem::Second(_) | DateItem::Elapsed(..) => Some(unit),
                DateItem::Fraction(n) => Some(10i64.pow(decimals - *n as u32)),
                _ => None,
            })
            .min()
            .unwrap_or(1);
        let items = localize_dates(items);
        Ok(Dates { items, kind, decimals, twelve_hours, language, with_day, smallest })
    }

    /// `v` shown as a date or time (a negative one counts back from 1899-12-30), or as a duration (its size, after a
    /// `-` when it is negative and doesn't round to 0).
    fn show(&self, v: f64, locale: &Locale) -> Result<String, NotShown> {
        let Some(names) = self.language.names(locale) else {
            return Err(NotShown::NotPrintedYet);
        };
        let unit = 10i64.pow(self.decimals);
        let per_day = 86_400 * unit;
        let duration = self.kind == Kind::Duration;
        let mut out = String::new();
        let (total, day) = if duration {
            if v.abs() >= (dates::LAST_SERIAL + 1) as f64 {
                return Err(NotShown::OutsideTheCalendar);
            }
            let total = in_units(v.abs(), per_day);
            if v < 0.0 && total / self.smallest != 0 {
                out.push('-');
            }
            (total, 0)
        } else {
            if !(v > (FIRST_SERIAL - 1) as f64 && v < (dates::LAST_SERIAL + 2) as f64) {
                return Err(NotShown::OutsideTheCalendar);
            }
            let total = in_units(v, per_day);
            let day = total.div_euclid(per_day);
            if !(FIRST_SERIAL..=dates::LAST_SERIAL).contains(&day) {
                return Err(NotShown::OutsideTheCalendar);
            }
            (total.rem_euclid(per_day), day)
        };
        let seconds = total / unit;
        let (year, month, day_of_month) = dates::date_from_serial(day);
        let hour = (seconds / 3600) % 24;
        let two = |n: i64| format!("{n:02}");
        for item in &self.items {
            match item {
                DateItem::Text(s) => out.push_str(s),
                DateItem::Year(n) if *n <= 2 => out.push_str(&two(year % 100)),
                DateItem::Year(_) => out.push_str(&format!("{year:04}")),
                DateItem::Month(n) => {
                    let pick = |plain: &'static str, with_day: &'static str| {
                        if self.with_day && !with_day.is_empty() { with_day } else { plain }
                    };
                    let list = match n {
                        1 | 2 => "",
                        3 => pick(names.short, names.short_with_day),
                        5 => names.narrow,
                        _ => pick(names.long, names.long_with_day),
                    };
                    match n {
                        1 => out.push_str(&month.to_string()),
                        2 => out.push_str(&two(month as i64)),
                        _ => out.push_str(nth(list, month as usize - 1)),
                    }
                }
                DateItem::Day(n) => {
                    let weekday = (day + 6).rem_euclid(7) as usize;
                    match n {
                        1 => out.push_str(&day_of_month.to_string()),
                        2 => out.push_str(&two(day_of_month as i64)),
                        3 => out.push_str(nth(names.days_short, weekday)),
                        _ => out.push_str(nth(names.days_long, weekday)),
                    }
                }
                DateItem::Hour(n) => {
                    let h = if self.twelve_hours { (hour + 11) % 12 + 1 } else { hour };
                    out.push_str(&if *n == 1 { h.to_string() } else { two(h) });
                }
                DateItem::Minute(n) => {
                    let m = (seconds / 60) % 60;
                    out.push_str(&if *n == 1 { m.to_string() } else { two(m) });
                }
                DateItem::Second(n) => {
                    let s = seconds % 60;
                    out.push_str(&if *n == 1 { s.to_string() } else { two(s) });
                }
                DateItem::Fraction(n) => {
                    // A fraction with fewer digits than the time was rounded to is cut off.
                    let digits = (total % unit) / 10i64.pow(self.decimals - *n as u32);
                    out.push(locale.decimal_sign.sign());
                    out.push_str(&format!("{digits:0width$}", width = *n));
                }
                DateItem::Slash => out.push('/'),
                DateItem::ShortDate => out.push_str(&locale.short_date.show(year, month, day_of_month)),
                DateItem::MonthAndDay => out.push_str(&locale.month_and_day.show(month, day_of_month)),
                DateItem::AmPm => out.push_str(if hour < 12 { "AM" } else { "PM" }),
                DateItem::AOrP(a, p) => out.push(if hour < 12 { *a } else { *p }),
                DateItem::Elapsed(u, n) => {
                    let count = match u {
                        b'h' => seconds / 3600,
                        b'm' => seconds / 60,
                        _ => seconds,
                    };
                    out.push_str(&format!("{count:0width$}", width = *n));
                }
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn show(pattern: &str, n: f64) -> String {
        match NumberFormat::parse(pattern) {
            Ok(f) => match f.show_number(n) {
                Ok(s) => s.text,
                Err(e) => e.name().into(),
            },
            Err(r) => r.name().into(),
        }
    }

    #[test]
    fn numbers() {
        assert_eq!(show("#,##0.00", 1234567.891), "1,234,567.89");
        assert_eq!(show("0.00", 1.005), "1.01");
        assert_eq!(show("0.0%", 0.1234), "12.3%");
        assert_eq!(show("#,##0,", 1234567.0), "1,235");
        assert_eq!(show("0.#?", 1.0), "1. ");
        assert_eq!(show("000-0000", 123456789.0), "12345-6789");
        assert_eq!(show("0;(0)", -5.0), "(5)");
        assert_eq!(show("\"a\"", -0.0001), "-a");
        assert_eq!(show(".", -0.0001), ".");
        assert_eq!(show("[>100]0;[<0]0", 5.0), "noSectionApplies");
    }

    #[test]
    fn scientific_numbers() {
        assert_eq!(show("0.0E+0", 9.96), "1.0E+1");
        assert_eq!(show("##0.0E+0", 12345.0), "12.3E+3");
        assert_eq!(show("##0.0E+0", 0.0001), "100.0E-6");
        assert_eq!(show("0.0E+0;0.0E-0", -12345.0), "1.2E4");
    }

    #[test]
    fn dates() {
        assert_eq!(show("yyyy-mm-dd hh:mm:ss", 45000.5), "2023-03-15 12:00:00");
        assert_eq!(show("dddd mmmm d, yyyy h AM/PM", 45000.0), "Wednesday March 15, 2023 12 AM");
        assert_eq!(show("[h]:mm", 1.5), "36:00");
        assert_eq!(show("h:mm", -0.25), "18:00");
        assert_eq!(show("s.0 s.00", 0.96 / 86400.0), "0.9 0.96");
        assert_eq!(show("yyyy", 1e7), "outsideTheCalendar");
        assert_eq!(show("[h]", -0.001), "0");
        assert_eq!(show("[h]:mm", -0.001), "-0:01");
    }

    #[test]
    fn languages() {
        assert_eq!(show("[$-fr-FR]dddd d mmmm", 45170.0), "vendredi 1 septembre");
        assert_eq!(show("[$-ru-RU]mmmm", 45170.0), "сентябрь");
        assert_eq!(show("[$-ru-RU]d mmmm", 45170.0), "1 сентября");
        assert_eq!(show("[$-en-gb]mmm", 45170.0), "Sept");
        assert_eq!(show("[$-F800]mmm;[$-de-DE]mmm", -45170.0), "Sep");
        assert_eq!(show("[$-407]mmm", 45170.0), "notPrintedYet");
        assert_eq!(show("[$-407]0.0", 45170.0), "45170.0");
        assert_eq!(show("[$-zz-ZZ]h:mm", 0.5), "notPrintedYet");
    }

    #[test]
    fn fractions() {
        assert_eq!(show("# ?/?", -0.01), "0    ");
        assert_eq!(show("# ?/?", 0.95), "1    ");
        assert_eq!(show("# ?/?", -1.5), "-1 1/2");
        assert_eq!(show("# ?/16", 1.125), "1 2/16");
        assert_eq!(show("??/??", 0.051), " 5/98");
        assert_eq!(show("??/??", 1.5), " 3/2 ");
        assert_eq!(show("??/??0", 0.5), " 1/02 ");
        assert_eq!(show("?/????????", 1e-7), "1/9999999 ");
        assert_eq!(show("0/4294967295", 0.5), "2147483648/4294967295");
        assert_eq!(show("0/10", 1.234567890123456e21), "12345678901234600000000/10");
    }

    #[test]
    fn refusals() {
        assert_eq!(show("0.0.0", 1.0), "secondDecimalPoint");
        assert_eq!(show("x", 1.0), "characterNeedsQuotes");
        assert_eq!(show("@;0", 1.0), "textSectionNotLast");
        assert_eq!(show("h 0", 1.0), "sectionMixesKinds");
        assert_eq!(show("[h] [m]", 1.0), "elapsedTimeNotWellFormed");
        assert_eq!(show("# ?/4294967296", 1.0), "fractionNotWellFormed");
    }
}
