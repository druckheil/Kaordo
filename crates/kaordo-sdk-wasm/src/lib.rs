#![forbid(unsafe_code)]

use wasm_bindgen::prelude::wasm_bindgen;

/// Returns the stability level of the format exposed by the SDK.
#[must_use]
#[wasm_bindgen]
pub fn format_status() -> String {
    kaordo_core::FORMAT_STATUS.to_owned()
}

#[cfg(test)]
mod tests {
    use super::format_status;

    #[test]
    fn exposes_format_status() {
        assert_eq!(format_status(), "internal-draft-0.x");
    }
}
