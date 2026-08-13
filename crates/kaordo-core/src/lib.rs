#![forbid(unsafe_code)]

/// Current stability level of the internal Kaordo format.
pub const FORMAT_STATUS: &str = "internal-draft-0.x";

#[cfg(test)]
mod tests {
    use super::FORMAT_STATUS;

    #[test]
    fn format_is_explicitly_internal() {
        assert_eq!(FORMAT_STATUS, "internal-draft-0.x");
    }
}
