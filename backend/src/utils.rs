use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn format_duration(seconds: f64) -> String {
    let hours = (seconds / 3600.0).floor() as u32;
    let minutes = ((seconds % 3600.0) / 60.0).floor() as u32;
    let secs = (seconds % 60.0).floor() as u32;

    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{}:{:02}", minutes, secs)
    }
}

#[wasm_bindgen]
pub fn format_distance(meters: f64) -> String {
    if meters >= 1000.0 {
        format!("{:.1} km", meters / 1000.0)
    } else {
        format!("{:.0} m", meters)
    }
}

#[wasm_bindgen]
pub fn format_speed(ms: f64) -> String {
    let kmh = ms * 3.6;
    format!("{:.1} km/h", kmh)
}

#[wasm_bindgen]
pub fn format_power(watts: f64) -> String {
    format!("{:.0} W", watts)
}