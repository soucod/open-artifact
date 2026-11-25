//! Reading a stored formula: its pieces of text, with its references between them, into an expression.
//!
//! The grammar is a spreadsheet's, with Excel's precedence (loosest first):
//!
//! ```text
//! comparison  = concat (("=" | "<>" | "<" | ">" | "<=" | ">=") concat)*
//! concat      = additive ("&" additive)*
//! additive    = term (("+" | "-") term)*
//! term        = power (("*" | "/") power)*
//! power       = percent ("^" percent)*
//! percent     = unary "%"*
//! unary       = ("+" | "-")* primary
//! primary     = number | string | error | reference | "(" comparison ")" | array | call | name
//! call        = name "(" [argument ("," argument)*] ")"     an argument may be left out: SUM(1,,2)
//! array       = "{" row (";" row)* "}"      row = constant ("," constant)*
//! ```
//!
//! What a formula cannot hold: a range made with `:` between other things than two cell ends (the stored
//! reference already joins `A1:B2`), the space that intersects two ranges, `A1#`. A formula that does not read is
//! answered #ERROR!.

use std::rc::Rc;

use crate::functions::{self, FunctionId};
use crate::value::{Array, CellError, Value};

/// An operator between two operands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinaryOp {
    Add,
    Subtract,
    Multiply,
    Divide,
    Power,
    Concat,
    Equal,
    NotEqual,
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnaryOp {
    Plus,
    Negate,
    Percent,
}

/// A formula as the evaluator reads it.
#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Number(f64),
    Text(Rc<str>),
    Boolean(bool),
    Error(CellError),
    /// The formula's nth reference.
    Reference(usize),
    /// A name: one a LET gives a value to, or one nobody knows (#NAME?). Kept in upper case.
    Name(Rc<str>),
    /// A call of a function: a known one (`function`), or a name nobody knows (#NAME?). `index` numbers the calls of
    /// the formula as they are written, from 0 (an outer call before the calls in its arguments): RAND draws by it.
    Call { name: Rc<str>, function: Option<FunctionId>, arguments: Vec<Expr>, index: u32 },
    /// An argument left out: `SUM(1,,2)`.
    Missing,
    Unary(UnaryOp, Box<Expr>),
    Binary(BinaryOp, Box<Expr>, Box<Expr>),
    /// An array written in the formula: `{1,2;3,4}`.
    Array(Rc<Array>),
}

/// Why a formula does not read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError(pub &'static str);

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    Text(Rc<str>),
    Error(CellError),
    Reference(usize),
    Name(String),
    Operator(&'static str),
    OpenParen,
    CloseParen,
    OpenBrace,
    CloseBrace,
    Comma,
    Semicolon,
    /// Whitespace between two tokens: allowed around operators, an intersection between two operands.
    Space,
}

/// Reads a stored formula: its pieces of text, with reference `i` between piece `i` and piece `i + 1`.
/// Whether a name is written as a cell's address within the largest sheet (`XFD1048576`): a name of a cell past the
/// sheet's end, which a LET may not give a value to and a cause of error tells as `noSuchCell`.
pub fn looks_like_a_cell(name: &str) -> bool {
    let letters = name.bytes().take_while(u8::is_ascii_alphabetic).count();
    let (column, row) = name.split_at(letters);
    if !(1..=3).contains(&letters) || row.is_empty() || !row.bytes().all(|b| b.is_ascii_digit()) || row.starts_with('0') {
        return false;
    }
    let column = column.bytes().fold(0u32, |n, b| n * 26 + u32::from(b.to_ascii_uppercase() - b'A' + 1));
    column <= 16_384 && row.len() <= 7 && row.parse::<u32>().is_ok_and(|row| row <= 1_048_576)
}

pub fn parse(pieces: &[String]) -> Result<Expr, ParseError> {
    let mut tokens = Vec::new();
    for (i, piece) in pieces.iter().enumerate() {
        let text = if i == 0 {
            piece.strip_prefix('=').ok_or(ParseError("a formula starts with ="))?
        } else {
            piece
        };
        lex(text, &mut tokens)?;
        if i + 1 < pieces.len() {
            tokens.push(Token::Reference(i));
        }
    }
    let tokens = drop_spaces(tokens)?;
    let mut parser = Parser { tokens, at: 0, calls: 0, depth: 0 };
    if parser.tokens.is_empty() {
        return Err(ParseError("a formula says something"));
    }
    let expr = parser.comparison()?;
    if parser.at != parser.tokens.len() {
        return Err(ParseError("the formula ends there"));
    }
    if parser.depth > MOST_DEPTH {
        return Err(ParseError("a formula nests at most 255 deep"));
    }
    Ok(expr)
}

/// How deep a formula may nest, counted so: each operator, call and pair of parentheses one deeper than
/// what it holds (`=1+1+1` is 2 deep, `=((1))` 2, `=ABS(-1)` 2). A formula deeper does not read (#ERROR!).
const MOST_DEPTH: u32 = 255;

fn lex(text: &str, tokens: &mut Vec<Token>) -> Result<(), ParseError> {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            ' ' | '\t' | '\n' | '\r' => {
                while i < chars.len() && matches!(chars[i], ' ' | '\t' | '\n' | '\r') {
                    i += 1;
                }
                tokens.push(Token::Space);
                continue;
            }
            '"' => {
                let mut s = String::new();
                i += 1;
                loop {
                    match chars.get(i) {
                        None => return Err(ParseError("a text ends with \"")),
                        Some('"') if chars.get(i + 1) == Some(&'"') => {
                            s.push('"');
                            i += 2;
                        }
                        Some('"') => {
                            i += 1;
                            break;
                        }
                        Some(&ch) => {
                            s.push(ch);
                            i += 1;
                        }
                    }
                }
                tokens.push(Token::Text(s.into()));
                continue;
            }
            '#' => {
                let rest: String = chars[i..].iter().collect();
                let error = CellError::ALL
                    .into_iter()
                    .filter(|e| rest.get(..e.text().len()).is_some_and(|head| head.eq_ignore_ascii_case(e.text())))
                    .max_by_key(|e| e.text().len())
                    .ok_or(ParseError("an error is one the sheet knows"))?;
                i += error.text().chars().count();
                tokens.push(Token::Error(error));
                continue;
            }
            '0'..='9' | '.' => {
                let start = i;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
                if i < chars.len() && chars[i] == '.' {
                    i += 1;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                }
                if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') {
                    let mut j = i + 1;
                    if j < chars.len() && (chars[j] == '+' || chars[j] == '-') {
                        j += 1;
                    }
                    if j < chars.len() && chars[j].is_ascii_digit() {
                        while j < chars.len() && chars[j].is_ascii_digit() {
                            j += 1;
                        }
                        i = j;
                    }
                }
                let literal: String = chars[start..i].iter().collect();
                if literal == "." {
                    return Err(ParseError("a number has digits"));
                }
                let n: f64 = literal.parse().map_err(|_| ParseError("a number reads"))?;
                tokens.push(Token::Number(n));
                continue;
            }
            '(' => tokens.push(Token::OpenParen),
            ')' => tokens.push(Token::CloseParen),
            '{' => tokens.push(Token::OpenBrace),
            '}' => tokens.push(Token::CloseBrace),
            ',' => tokens.push(Token::Comma),
            ';' => tokens.push(Token::Semicolon),
            '+' => tokens.push(Token::Operator("+")),
            '-' => tokens.push(Token::Operator("-")),
            '*' => tokens.push(Token::Operator("*")),
            '/' => tokens.push(Token::Operator("/")),
            '^' => tokens.push(Token::Operator("^")),
            '&' => tokens.push(Token::Operator("&")),
            '%' => tokens.push(Token::Operator("%")),
            '=' => tokens.push(Token::Operator("=")),
            '<' => {
                if chars.get(i + 1) == Some(&'=') {
                    tokens.push(Token::Operator("<="));
                    i += 1;
                } else if chars.get(i + 1) == Some(&'>') {
                    tokens.push(Token::Operator("<>"));
                    i += 1;
                } else {
                    tokens.push(Token::Operator("<"));
                }
            }
            '>' => {
                if chars.get(i + 1) == Some(&'=') {
                    tokens.push(Token::Operator(">="));
                    i += 1;
                } else {
                    tokens.push(Token::Operator(">"));
                }
            }
            // A name: ASCII letters, `_`, and any character beyond ASCII (`x€`, `½`, the no-break space), then digits
            // and `.` as well.
            c if c.is_ascii_alphabetic() || c == '_' || !c.is_ascii() => {
                let start = i;
                let in_name = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '.') || !c.is_ascii();
                while i < chars.len() && in_name(chars[i]) {
                    i += 1;
                }
                tokens.push(Token::Name(chars[start..i].iter().collect()));
                continue;
            }
            _ => return Err(ParseError("a character a formula does not use")),
        }
        i += 1;
    }
    Ok(())
}

/// Whitespace may sit around operators, parentheses and separators. Between two operands it would intersect them,
/// which a formula here cannot do.
fn drop_spaces(tokens: Vec<Token>) -> Result<Vec<Token>, ParseError> {
    let ends_operand = |t: &Token| {
        matches!(t, Token::Number(_) | Token::Text(_) | Token::Error(_) | Token::Reference(_) | Token::Name(_) | Token::CloseParen | Token::CloseBrace)
            || *t == Token::Operator("%")
    };
    let starts_operand = |t: &Token| {
        matches!(t, Token::Number(_) | Token::Text(_) | Token::Error(_) | Token::Reference(_) | Token::Name(_) | Token::OpenParen | Token::OpenBrace)
    };
    let mut out: Vec<Token> = Vec::with_capacity(tokens.len());
    for (i, token) in tokens.iter().enumerate() {
        if *token != Token::Space {
            out.push(token.clone());
            continue;
        }
        let before = out.last();
        let after = tokens[i + 1..].iter().find(|t| **t != Token::Space);
        if let (Some(b), Some(a)) = (before, after) {
            // A name before spaces and then "(" is still a call: `SUM (1)` sums, `NOPE (1)` is #NAME?.
            if matches!(b, Token::Name(_)) && *a == Token::OpenParen {
                continue;
            }
            if ends_operand(b) && starts_operand(a) {
                return Err(ParseError("two operands with only a space between them"));
            }
        }
    }
    Ok(out)
}

struct Parser {
    tokens: Vec<Token>,
    at: usize,
    /// The calls read so far.
    calls: u32,
    /// How deep the expression read last nests (`MOST_DEPTH`).
    depth: u32,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at)
    }

    fn next(&mut self) -> Option<Token> {
        let t = self.tokens.get(self.at).cloned();
        self.at += 1;
        t
    }

    fn eat(&mut self, token: &Token) -> bool {
        if self.peek() == Some(token) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn eat_operator(&mut self, ops: &[&'static str]) -> Option<&'static str> {
        if let Some(Token::Operator(op)) = self.peek() {
            if let Some(found) = ops.iter().find(|o| *o == op) {
                self.at += 1;
                return Some(found);
            }
        }
        None
    }

    /// Reads an operand of a binary operator, the depth of what is read so far (`left`) taken into the depth.
    fn right_operand(
        &mut self,
        left: u32,
        read: fn(&mut Self) -> Result<Expr, ParseError>,
    ) -> Result<Expr, ParseError> {
        let right = read(self)?;
        self.depth = 1 + left.max(self.depth);
        Ok(right)
    }

    fn comparison(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.concat()?;
        while let Some(op) = self.eat_operator(&["=", "<>", "<", ">", "<=", ">="]) {
            let right = self.right_operand(self.depth, Self::concat)?;
            let op = match op {
                "=" => BinaryOp::Equal,
                "<>" => BinaryOp::NotEqual,
                "<" => BinaryOp::Less,
                ">" => BinaryOp::Greater,
                "<=" => BinaryOp::LessOrEqual,
                _ => BinaryOp::GreaterOrEqual,
            };
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn concat(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.additive()?;
        while self.eat_operator(&["&"]).is_some() {
            let right = self.right_operand(self.depth, Self::additive)?;
            left = Expr::Binary(BinaryOp::Concat, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn additive(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.term()?;
        while let Some(op) = self.eat_operator(&["+", "-"]) {
            let right = self.right_operand(self.depth, Self::term)?;
            let op = if op == "+" { BinaryOp::Add } else { BinaryOp::Subtract };
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn term(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.power()?;
        while let Some(op) = self.eat_operator(&["*", "/"]) {
            let right = self.right_operand(self.depth, Self::power)?;
            let op = if op == "*" { BinaryOp::Multiply } else { BinaryOp::Divide };
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn power(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.percent()?;
        while self.eat_operator(&["^"]).is_some() {
            let right = self.right_operand(self.depth, Self::percent)?;
            left = Expr::Binary(BinaryOp::Power, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn percent(&mut self) -> Result<Expr, ParseError> {
        let mut expr = self.unary()?;
        while self.eat_operator(&["%"]).is_some() {
            self.depth += 1;
            expr = Expr::Unary(UnaryOp::Percent, Box::new(expr));
        }
        Ok(expr)
    }

    fn unary(&mut self) -> Result<Expr, ParseError> {
        if let Some(op) = self.eat_operator(&["+", "-"]) {
            let operand = self.unary()?;
            self.depth += 1;
            let op = if op == "-" { UnaryOp::Negate } else { UnaryOp::Plus };
            return Ok(Expr::Unary(op, Box::new(operand)));
        }
        self.primary()
    }

    fn primary(&mut self) -> Result<Expr, ParseError> {
        self.depth = 0;
        match self.next().ok_or(ParseError("the formula goes on"))? {
            Token::Number(n) => Ok(Expr::Number(n)),
            Token::Text(s) => Ok(Expr::Text(s)),
            Token::Error(e) => Ok(Expr::Error(e)),
            Token::Reference(i) => Ok(Expr::Reference(i)),
            Token::OpenParen => {
                let inner = self.comparison()?;
                if !self.eat(&Token::CloseParen) {
                    return Err(ParseError("a parenthesis closes"));
                }
                self.depth += 1;
                Ok(inner)
            }
            Token::OpenBrace => self.array(),
            Token::Name(name) => {
                if self.eat(&Token::OpenParen) {
                    return self.call(name);
                }
                let upper = name.to_uppercase();
                match upper.as_str() {
                    "TRUE" => Ok(Expr::Boolean(true)),
                    "FALSE" => Ok(Expr::Boolean(false)),
                    _ => Ok(Expr::Name(upper.into())),
                }
            }
            _ => Err(ParseError("an operand")),
        }
    }

    fn call(&mut self, name: String) -> Result<Expr, ParseError> {
        let upper: Rc<str> = name.to_uppercase().into();
        let function = functions::find(&upper);
        let index = self.calls;
        self.calls += 1;
        let mut arguments = Vec::new();
        let mut deepest = 0;
        if !self.eat(&Token::CloseParen) {
            loop {
                if matches!(self.peek(), Some(Token::Comma) | Some(Token::CloseParen)) {
                    arguments.push(Expr::Missing);
                } else {
                    arguments.push(self.comparison()?);
                    deepest = deepest.max(self.depth);
                }
                if self.eat(&Token::Comma) {
                    continue;
                }
                if self.eat(&Token::CloseParen) {
                    break;
                }
                return Err(ParseError("an argument ends with , or )"));
            }
        }
        self.depth = deepest + 1;
        Ok(Expr::Call { name: upper, function, arguments, index })
    }

    fn array(&mut self) -> Result<Expr, ParseError> {
        let mut rows: Vec<Vec<Value>> = vec![Vec::new()];
        loop {
            let value = self.array_constant()?;
            rows.last_mut().expect("a row").push(value);
            match self.next() {
                Some(Token::Comma) => {}
                Some(Token::Semicolon) => rows.push(Vec::new()),
                Some(Token::CloseBrace) => break,
                _ => return Err(ParseError("an array's values are separated by , and ;")),
            }
        }
        let columns = rows[0].len();
        if rows.iter().any(|r| r.len() != columns) {
            return Err(ParseError("an array's rows are as long as each other"));
        }
        Ok(Expr::Array(Rc::new(Array::from_rows(rows))))
    }

    fn array_constant(&mut self) -> Result<Value, ParseError> {
        let negative = match self.eat_operator(&["-", "+"]) {
            Some("-") => true,
            _ => false,
        };
        let value = match self.next() {
            Some(Token::Number(n)) => Value::number(if negative { -n } else { n }),
            Some(Token::Text(s)) if !negative => Value::Text(s),
            Some(Token::Error(e)) if !negative => Value::Error(e),
            Some(Token::Name(n)) if !negative && n.eq_ignore_ascii_case("TRUE") => Value::Boolean(true),
            Some(Token::Name(n)) if !negative && n.eq_ignore_ascii_case("FALSE") => Value::Boolean(false),
            _ => return Err(ParseError("an array holds constants")),
        };
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Result<Expr, ParseError> {
        parse(&[s.to_owned()])
    }

    #[test]
    fn precedence() {
        // -2^2 = 4: negation binds tighter than ^
        assert_eq!(
            p("=-2^2").unwrap(),
            Expr::Binary(BinaryOp::Power, Box::new(Expr::Unary(UnaryOp::Negate, Box::new(Expr::Number(2.0)))), Box::new(Expr::Number(2.0)))
        );
        assert!(p("=1+").is_err());
        assert!(p("=  1 + 2 ").is_ok());
        assert!(p("=1 2").is_err());
    }

    #[test]
    fn references_between_pieces() {
        let e = parse(&["=SUM(".into(), ")*2".into()]).unwrap();
        match e {
            Expr::Binary(BinaryOp::Multiply, call, _) => match *call {
                Expr::Call { arguments, .. } => assert_eq!(arguments, vec![Expr::Reference(0)]),
                other => panic!("{other:?}"),
            },
            other => panic!("{other:?}"),
        }
    }
}
