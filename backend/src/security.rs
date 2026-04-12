use wasm_bindgen::prelude::*;
use web_sys::console;

const MIN_FIT_FILE_BYTES: usize = 12;
const MAX_FIT_FILE_BYTES: usize = 50_000_000;
const MAX_KNOWN_PROTOCOL_VERSION: u8 = 20;
const FIT_SIGNATURE_OFFSET: usize = 8;
const FIT_SIGNATURE: &[u8; 4] = b".FIT";

pub fn validate_fit_data(data: &[u8]) -> Result<(), JsValue> {
    if data.len() < MIN_FIT_FILE_BYTES {
        return Err(JsValue::from_str("Invalid FIT file: too small"));
    }

    let header_size = data[0] as usize;
    if header_size < MIN_FIT_FILE_BYTES || header_size > data.len() {
        return Err(JsValue::from_str("Invalid FIT file: corrupted header"));
    }

    let protocol_version = data[1];
    if protocol_version > MAX_KNOWN_PROTOCOL_VERSION {
        console::warn_1(&"Unknown FIT protocol version".into());
    }

    if &data[FIT_SIGNATURE_OFFSET..FIT_SIGNATURE_OFFSET + FIT_SIGNATURE.len()] != FIT_SIGNATURE {
        return Err(JsValue::from_str("Invalid FIT file: missing signature"));
    }

    if data.len() > MAX_FIT_FILE_BYTES {
        return Err(JsValue::from_str("FIT file too large"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_fit_header() -> Vec<u8> {
        vec![14, 1, 0, 0, 0, 0, 0, 0, b'.', b'F', b'I', b'T', 0, 0]
    }

    #[test]
    fn valid_fit_header_passes_validation() {
        assert!(validate_fit_data(&valid_fit_header()).is_ok());
    }
}
