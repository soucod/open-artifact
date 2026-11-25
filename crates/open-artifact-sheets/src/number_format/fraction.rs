use super::{
    integer_digit, literal_text, round_digits, significant_digits, Groups, Item, Locale, Numbers,
    Ph, Refusal, Tok, SIGNIFICANT_DIGITS,
};

#[derive(Clone, Debug)]
pub(super) struct Fraction {
    whole: Numbers,
    separator: String,
    numerator: Vec<Ph>,
    denominator: Denominator,
    suffix: String,
}

#[derive(Clone, Debug)]
enum Denominator {
    Fixed(u32),
    Variable(Vec<Ph>),
}

impl Fraction {
    pub(super) fn read(body: &[Tok], slash: usize) -> Result<Self, Refusal> {
        let bad = Refusal::FractionNotWellFormed;
        let fits = |token: &Tok| {
            !matches!(
                token,
                Tok::Point | Tok::Comma | Tok::Percent | Tok::Exponent { .. } | Tok::Slash
            )
        };
        for token in &body[..slash] {
            if matches!(token, Tok::Digit(_)) {
                return Err(Refusal::CharacterNeedsQuotes);
            }
            if !fits(token) {
                return Err(bad);
            }
        }

        let top_start = body[..slash]
            .iter()
            .rposition(|t| Ph::read(t).is_none())
            .map_or(0, |i| i + 1);
        let whole_end = body[..top_start]
            .iter()
            .rposition(|t| Ph::read(t).is_some())
            .map_or(top_start, |i| i + 1);
        let numerator = body[top_start..slash].iter().filter_map(Ph::read).collect();
        let leading_denominator = &body[slash + 1..];
        let (denominator, width) = if matches!(leading_denominator[0], Tok::Digit(_)) {
            let digits: String = leading_denominator
                .iter()
                .map_while(|t| match t {
                    Tok::Digit(digit) => Some(*digit),
                    Tok::Zero => Some('0'),
                    _ => None,
                })
                .collect();
            (
                Denominator::Fixed(digits.parse().map_err(|_| bad)?),
                digits.len(),
            )
        } else {
            let digits: Vec<Ph> = leading_denominator.iter().map_while(Ph::read).collect();
            let width = digits.len();
            (Denominator::Variable(digits), width)
        };
        let suffix = &leading_denominator[width..];
        if suffix
            .iter()
            .any(|t| Ph::read(t).is_some() || matches!(t, Tok::Digit(_)) || !fits(t))
        {
            return Err(bad);
        }
        Ok(Self {
            whole: Numbers::read(&body[..whole_end]),
            separator: body[whole_end..top_start]
                .iter()
                .filter_map(literal_text)
                .collect(),
            numerator,
            denominator,
            suffix: suffix.iter().filter_map(literal_text).collect(),
        })
    }

    pub(super) fn show(&self, value: f64, negative: bool, locale: &Locale) -> String {
        let (_, digits, exponent) = significant_digits(value, SIGNIFICANT_DIGITS);
        // This retains enough places for a u32 denominator and bounds the exact arithmetic below.
        let decimals = (digits.len() as i32 - 1 - exponent).clamp(0, 24) as usize;
        let (mut whole, fractional) = round_digits(&digits, exponent, decimals);
        let part = fractional.parse::<u128>().unwrap_or(0);
        let scale = 10u128.pow(decimals as u32);
        let (mut top, bottom) = match &self.denominator {
            Denominator::Fixed(bottom) => (
                ((part * *bottom as u128 + scale / 2) / scale) as u32,
                *bottom,
            ),
            // Wider patterns can pad the result but do not increase the denominator limit.
            Denominator::Variable(digits) => {
                closest(part, scale, 10u32.pow(digits.len().min(7) as u32) - 1)
            }
        };
        let mixed = self.whole.integers != 0;
        if mixed && top == bottom {
            whole = multiply_add(&whole, 1, 1);
            top = 0;
        }
        let zero = whole.is_empty() && top == 0;
        let show_whole = !whole.is_empty()
            || self
                .whole
                .items
                .iter()
                .any(|item| matches!(item, Item::Int(Ph::Zero, _)));
        let keep_fraction = !mixed
            || top != 0
            || self.numerator.contains(&Ph::Zero)
            || self.denominator.has(Ph::Zero);
        let align = self.numerator.contains(&Ph::Question) || self.denominator.has(Ph::Question);
        if mixed && !keep_fraction && zero {
            whole.push('0');
        }

        let groups = Groups {
            sign: locale.group_sign.sign(),
            sizes: locale.sizes_of_groups,
            on: false,
        };
        let mut result = String::from(if negative && !zero { "-" } else { "" });
        for item in &self.whole.items {
            match item {
                Item::Text(text) => result.push_str(text),
                Item::Int(ph, position) => integer_digit(
                    &mut result,
                    *ph,
                    *position,
                    self.whole.integers,
                    whole.as_bytes(),
                    groups,
                ),
                _ => unreachable!("fraction integer parts only contain digits and text"),
            }
        }
        if show_whole && keep_fraction {
            result.push_str(&self.separator);
        } else if align {
            result.extend(std::iter::repeat_n(' ', self.separator.chars().count()));
        }
        if keep_fraction {
            let digits = if mixed {
                top.to_string()
            } else {
                multiply_add(&whole, bottom, top)
            };
            self.write_numerator(&mut result, &digits, groups);
            result.push('/');
            self.denominator.write(&mut result, bottom);
        } else if align {
            let mut example = String::new();
            self.write_numerator(&mut example, "1", groups);
            example.push('/');
            self.denominator.write(&mut example, 1);
            result.extend(std::iter::repeat_n(' ', example.len()));
        }
        result.push_str(&self.suffix);
        result
    }

    fn write_numerator(&self, out: &mut String, digits: &str, groups: Groups) {
        for (index, ph) in self.numerator.iter().enumerate() {
            integer_digit(
                out,
                *ph,
                self.numerator.len() - 1 - index,
                self.numerator.len(),
                digits.as_bytes(),
                groups,
            );
        }
    }
}

impl Denominator {
    fn has(&self, placeholder: Ph) -> bool {
        matches!(self, Denominator::Variable(digits) if digits.contains(&placeholder))
    }

    fn write(&self, out: &mut String, value: u32) {
        match self {
            Denominator::Fixed(bottom) => out.push_str(&bottom.to_string()),
            Denominator::Variable(pattern) => {
                let digits = value.to_string();
                let padding = pattern.get(digits.len()..).unwrap_or_default();
                out.extend(padding.iter().filter(|ph| **ph == Ph::Zero).map(|_| '0'));
                out.push_str(&digits);
                out.extend(
                    padding
                        .iter()
                        .filter(|ph| **ph == Ph::Question)
                        .map(|_| ' '),
                );
            }
        }
    }
}

/// The nearest fraction with a bounded denominator. Continued fractions narrow the search to a convergent
/// and its best intermediate fraction at the bound. Use the displayed decimal to compare distances exactly.
fn closest(numerator: u128, denominator: u128, bound: u32) -> (u32, u32) {
    let (mut n, mut d) = (numerator, denominator);
    let (mut first_n, mut first_d, mut last_n, mut last_d) = (0, 1, 1, 0);
    let bound = bound as u128;
    while d != 0 {
        let quotient = n / d;
        let next_d = first_d + quotient * last_d;
        if next_d > bound {
            let step = (bound - first_d) / last_d;
            let other_n = first_n + step * last_n;
            let other_d = first_d + step * last_d;
            let other_error = (numerator * other_d).abs_diff(denominator * other_n);
            let last_error = (numerator * last_d).abs_diff(denominator * last_n);
            if other_error * last_d < last_error * other_d {
                return (other_n as u32, other_d as u32);
            }
            break;
        }
        (first_n, last_n) = (last_n, first_n + quotient * last_n);
        (first_d, last_d) = (last_d, next_d);
        (n, d) = (d, n % d);
    }
    (last_n as u32, last_d as u32)
}

/// The integer part may be larger than an integer type, but the factor and carry are bounded by the denominator.
fn multiply_add(digits: &str, factor: u32, add: u32) -> String {
    let mut carry = u64::from(add);
    let mut output = Vec::with_capacity(digits.len() + 10);
    for digit in digits.bytes().rev() {
        carry += u64::from(factor) * u64::from(digit - b'0');
        output.push((carry % 10) as u8 + b'0');
        carry /= 10;
    }
    while carry != 0 {
        output.push((carry % 10) as u8 + b'0');
        carry /= 10;
    }
    if output.is_empty() {
        output.push(b'0');
    }
    output.into_iter().rev().map(char::from).collect()
}
