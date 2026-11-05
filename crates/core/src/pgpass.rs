use std::path::Path;

/// ~/.pgpass the way psql reads it, so a server never has to carry a password that is already kept there.
#[derive(Debug, Clone, Default)]
pub struct PassFile {
    lines: Vec<[String; 5]>,
}

/// Splits at colons that are not escaped, keeping the escapes for `unescape` to deal with.
fn split_fields(line: &str) -> Option<[String; 5]> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut characters = line.chars();
    while let Some(character) = characters.next() {
        match character {
            '\\' => {
                if let Some(next) = characters.next() {
                    current.push(next);
                }
            }
            ':' if fields.len() < 4 => fields.push(std::mem::take(&mut current)),
            other => current.push(other),
        }
    }
    fields.push(current);
    fields.try_into().ok()
}

impl PassFile {
    pub fn parse(text: &str) -> Self {
        let lines = text
            .lines()
            .filter(|line| !line.trim().is_empty() && !line.trim_start().starts_with('#'))
            .filter_map(split_fields)
            .collect();
        Self { lines }
    }

    pub fn read(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .map(|text| Self::parse(&text))
            .unwrap_or_default()
    }

    /// The password for a user on a server, whichever database the line names. Every database of one server takes the same
    /// password, which is why pgAdmin needs it only once, and why a line for one database serves them all.
    pub fn lookup_for_server(&self, host: &str, port: u16, user: &str) -> Option<String> {
        let port = port.to_string();
        let matches = |pattern: &str, value: &str| pattern == "*" || pattern == value;
        self.lines
            .iter()
            .find(|[h, p, _, u, _]| matches(h, host) && matches(p, &port) && matches(u, user))
            .map(|line| line[4].clone())
    }

    pub fn lookup(&self, host: &str, port: u16, database: &str, user: &str) -> Option<String> {
        let port = port.to_string();
        let matches = |pattern: &str, value: &str| pattern == "*" || pattern == value;
        self.lines
            .iter()
            .find(|[h, p, d, u, _]| {
                matches(h, host) && matches(p, &port) && matches(d, database) && matches(u, user)
            })
            .map(|line| line[4].clone())
    }
}
