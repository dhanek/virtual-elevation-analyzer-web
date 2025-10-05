use wasm_bindgen::prelude::*;

mod dem_processor;
mod fit_parser;
mod fitparser_wrapper;
mod security;
mod utils;
mod virtual_elevation;

pub use dem_processor::*;
pub use fit_parser::*;
pub use fitparser_wrapper::*;
pub use security::*;
pub use virtual_elevation::*;

// Initialize WASM module
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    web_sys::console::log_1(&"Virtual Elevation Analyzer WASM module initialized".into());
}