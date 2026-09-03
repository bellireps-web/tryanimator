//! Minimal JSON value model + parser/serializer (std-only).
//!
//! Only what the contracts need: objects, arrays, strings (with escapes,
//! including `\uXXXX`), numbers as f64, bools, null. The parser rejects
//! trailing garbage, control characters in strings, and malformed numbers.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Value>),
    Obj(BTreeMap<String, Value>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Obj(map) => map.get(key),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Num(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_u32(&self) -> Option<u32> {
        self.as_f64()
            .filter(|n| n.is_finite() && *n >= 0.0)
            .map(|n| n as u32)
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_arr(&self) -> Option<&[Value]> {
        match self {
            Value::Arr(items) => Some(items),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub offset: usize,
    pub message: String,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "invalid JSON at byte {}: {}", self.offset, self.message)
    }
}

impl std::error::Error for ParseError {}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Parser {
            bytes: input.as_bytes(),
            pos: 0,
        }
    }

    fn err<T>(&self, message: &str) -> Result<T, ParseError> {
        Err(ParseError {
            offset: self.pos,
            message: message.to_string(),
        })
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn bump(&mut self) {
        self.pos += 1;
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.bump();
        }
    }

    fn expect(&mut self, byte: u8, what: &str) -> Result<(), ParseError> {
        match self.peek() {
            Some(b) if b == byte => {
                self.bump();
                Ok(())
            }
            _ => self.err(what),
        }
    }

    fn parse_value(&mut self) -> Result<Value, ParseError> {
        self.skip_ws();
        match self.peek() {
            Some(b'{') => self.parse_object(),
            Some(b'[') => self.parse_array(),
            Some(b'"') => Ok(Value::Str(self.parse_string()?)),
            Some(b't') => self.parse_literal("true", Value::Bool(true)),
            Some(b'f') => self.parse_literal("false", Value::Bool(false)),
            Some(b'n') => self.parse_literal("null", Value::Null),
            Some(b'-') | Some(b'0'..=b'9') => Ok(Value::Num(self.parse_number()?)),
            _ => self.err("expected value"),
        }
    }

    fn parse_literal(&mut self, word: &str, value: Value) -> Result<Value, ParseError> {
        if self.bytes.len() >= self.pos + word.len()
            && &self.bytes[self.pos..self.pos + word.len()] == word.as_bytes()
        {
            self.pos += word.len();
            Ok(value)
        } else {
            self.err("invalid literal")
        }
    }

    fn parse_object(&mut self) -> Result<Value, ParseError> {
        self.expect(b'{', "expected '{'")?;
        let mut map = BTreeMap::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.bump();
            return Ok(Value::Obj(map));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return self.err("expected string key");
            }
            let key = self.parse_string()?;
            self.skip_ws();
            self.expect(b':', "expected ':'")?;
            let value = self.parse_value()?;
            map.insert(key, value);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.bump();
                }
                Some(b'}') => {
                    self.bump();
                    return Ok(Value::Obj(map));
                }
                _ => return self.err("expected ',' or '}'"),
            }
        }
    }

    fn parse_array(&mut self) -> Result<Value, ParseError> {
        self.expect(b'[', "expected '['")?;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.bump();
            return Ok(Value::Arr(items));
        }
        loop {
            items.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.bump();
                }
                Some(b']') => {
                    self.bump();
                    return Ok(Value::Arr(items));
                }
                _ => return self.err("expected ',' or ']'"),
            }
        }
    }

    fn hex_val(byte: u8) -> Option<u32> {
        match byte {
            b'0'..=b'9' => Some((byte - b'0') as u32),
            b'a'..=b'f' => Some((byte - b'a' + 10) as u32),
            b'A'..=b'F' => Some((byte - b'A' + 10) as u32),
            _ => None,
        }
    }

    fn parse_escape(&mut self, out: &mut String) -> Result<(), ParseError> {
        // Called after consuming the backslash; peek is the escape kind.
        match self.peek() {
            Some(b'"') => {
                out.push('"');
                self.bump();
                Ok(())
            }
            Some(b'\\') => {
                out.push('\\');
                self.bump();
                Ok(())
            }
            Some(b'/') => {
                out.push('/');
                self.bump();
                Ok(())
            }
            Some(b'b') => {
                out.push('\u{0008}');
                self.bump();
                Ok(())
            }
            Some(b'f') => {
                out.push('\u{000C}');
                self.bump();
                Ok(())
            }
            Some(b'n') => {
                out.push('\n');
                self.bump();
                Ok(())
            }
            Some(b'r') => {
                out.push('\r');
                self.bump();
                Ok(())
            }
            Some(b't') => {
                out.push('\t');
                self.bump();
                Ok(())
            }
            Some(b'u') => {
                self.bump();
                let mut code: u32 = 0;
                for _ in 0..4 {
                    match self.peek().and_then(Self::hex_val) {
                        Some(v) => {
                            code = code * 16 + v;
                            self.bump();
                        }
                        None => return self.err("invalid \\u escape"),
                    }
                }
                match char::from_u32(code) {
                    Some(ch) => {
                        out.push(ch);
                        Ok(())
                    }
                    None => self.err("invalid unicode scalar"),
                }
            }
            _ => self.err("invalid escape"),
        }
    }

    fn parse_string(&mut self) -> Result<String, ParseError> {
        self.expect(b'"', "expected '\"'")?;
        let mut out = String::new();
        loop {
            match self.peek() {
                None => return self.err("unterminated string"),
                Some(b'"') => {
                    self.bump();
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.bump();
                    self.parse_escape(&mut out)?;
                }
                Some(b) if b < 0x20 => return self.err("unescaped control character"),
                Some(_) => {
                    // Copy one UTF-8 code point.
                    let rest = &self.bytes[self.pos..];
                    let s = std::str::from_utf8(rest).map_err(|_| ParseError {
                        offset: self.pos,
                        message: "invalid utf-8".to_string(),
                    })?;
                    let ch = s.chars().next().ok_or(ParseError {
                        offset: self.pos,
                        message: "unterminated string".to_string(),
                    })?;
                    out.push(ch);
                    self.pos += ch.len_utf8();
                }
            }
        }
    }

    fn parse_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.bump();
        }
        match self.peek() {
            Some(b'0') => {
                self.bump();
            }
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.bump();
                }
            }
            _ => return self.err("invalid number"),
        }
        if self.peek() == Some(b'.') {
            self.bump();
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return self.err("invalid number fraction");
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.bump();
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.bump();
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.bump();
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return self.err("invalid number exponent");
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.bump();
            }
        }
        let text = std::str::from_utf8(&self.bytes[start..self.pos]).map_err(|_| ParseError {
            offset: start,
            message: "invalid number".to_string(),
        })?;
        text.parse::<f64>().map_err(|_| ParseError {
            offset: start,
            message: "number out of range".to_string(),
        })
    }
}

/// Parse a full JSON document; trailing garbage is an error.
pub fn parse(input: &str) -> Result<Value, ParseError> {
    let mut parser = Parser::new(input);
    let value = parser.parse_value()?;
    parser.skip_ws();
    if parser.peek().is_some() {
        return parser.err("trailing characters");
    }
    Ok(value)
}

fn escape_into(out: &mut String, text: &str) {
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Serialize a value in canonical form (object keys sorted).
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value);
    out
}

fn write_value(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Num(n) => {
            if n.is_finite() {
                out.push_str(&format!("{n:?}"));
            } else {
                out.push_str("null");
            }
        }
        Value::Str(s) => escape_into(out, s),
        Value::Arr(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(out, item);
            }
            out.push(']');
        }
        Value::Obj(map) => {
            out.push('{');
            for (i, (key, val)) in map.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                escape_into(out, key);
                out.push(':');
                write_value(out, val);
            }
            out.push('}');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_document() {
        let doc = r#"{"a":[1,2.5,-3e2],"b":{"c":"x\ny\"q\"","d":true,"e":null}}"#;
        let value = parse(doc).expect("parses");
        assert_eq!(
            value
                .get("b")
                .and_then(|b| b.get("c"))
                .and_then(|c| c.as_str()),
            Some("x\ny\"q\"")
        );
        let again = parse(&stringify(&value)).expect("reparses");
        assert_eq!(value, again);
    }

    #[test]
    fn rejects_garbage() {
        for bad in [
            "",
            "{",
            "{\"a\":}",
            "[1,]",
            "{\"a\" 1}",
            "tru",
            "01",
            "1.",
            "[1]x",
            "nul",
            "\"\\x\"",
        ] {
            assert!(parse(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn unicode_escape() {
        assert_eq!(
            parse(r#""caf\u00e9""#).unwrap(),
            Value::Str("café".to_string())
        );
    }
}
