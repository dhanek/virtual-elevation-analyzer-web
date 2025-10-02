use wasm_bindgen::prelude::*;
use web_sys::console;

#[wasm_bindgen]
pub struct SecurityValidator;

#[wasm_bindgen]
impl SecurityValidator {
    pub fn new() -> SecurityValidator {
        SecurityValidator
    }

    pub fn validate_fit_data(&self, data: &[u8]) -> Result<(), JsValue> {
        if data.len() < 12 {
            return Err(JsValue::from_str("Invalid FIT file: too small"));
        }

        // Check file header and size constraints
        let header_size = data[0] as usize;
        if header_size < 12 || header_size > data.len() {
            return Err(JsValue::from_str("Invalid FIT file: corrupted header"));
        }

        // Validate protocol version
        let protocol_version = data[1];
        if protocol_version > 20 {
            console::warn_1(&"Unknown FIT protocol version".into());
        }

        // Check for FIT signature
        if data.len() >= 12 && &data[8..12] != b".FIT" {
            return Err(JsValue::from_str("Invalid FIT file: missing signature"));
        }

        // File size validation (reasonable limits)
        if data.len() > 50_000_000 {  // 50MB limit
            return Err(JsValue::from_str("FIT file too large"));
        }

        Ok(())
    }

    pub fn sanitize_numeric_input(&self, value: f64) -> f64 {
        if !value.is_finite() {
            return 0.0;
        }
        // Clamp to reasonable ranges for cycling data
        value.max(-1000.0).min(10000.0)
    }
}