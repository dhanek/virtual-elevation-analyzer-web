use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use byteorder::{ByteOrder, LittleEndian};
use crate::fitparser_wrapper::FitParserWrapper;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct FitData {
    timestamps: Vec<f64>,
    power: Vec<f64>,
    velocity: Vec<f64>,
    position_lat: Vec<f64>,
    position_long: Vec<f64>,
    altitude: Vec<f64>,
    distance: Vec<f64>,
    air_speed: Vec<f64>,
    wind_speed: Vec<f64>,
    battery_soc: Vec<f64>,
    heart_rate: Vec<f64>,
    cadence: Vec<f64>,
    temperature: Vec<f64>,
}

#[wasm_bindgen]
impl FitData {
    #[wasm_bindgen(getter)]
    pub fn timestamps(&self) -> Vec<f64> {
        self.timestamps.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn power(&self) -> Vec<f64> {
        self.power.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn velocity(&self) -> Vec<f64> {
        self.velocity.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn position_lat(&self) -> Vec<f64> {
        self.position_lat.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn position_long(&self) -> Vec<f64> {
        self.position_long.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn altitude(&self) -> Vec<f64> {
        self.altitude.clone()
    }

    /// Set altitude values (for DEM correction)
    #[wasm_bindgen]
    pub fn set_altitude(&mut self, altitude: Vec<f64>) {
        self.altitude = altitude;
    }

    #[wasm_bindgen(getter)]
    pub fn distance(&self) -> Vec<f64> {
        self.distance.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn air_speed(&self) -> Vec<f64> {
        self.air_speed.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn wind_speed(&self) -> Vec<f64> {
        self.wind_speed.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn battery_soc(&self) -> Vec<f64> {
        self.battery_soc.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn heart_rate(&self) -> Vec<f64> {
        self.heart_rate.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn cadence(&self) -> Vec<f64> {
        self.cadence.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn temperature(&self) -> Vec<f64> {
        self.temperature.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn record_count(&self) -> usize {
        self.timestamps.len()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct LapData {
    start_time: f64,
    end_time: f64,
    total_elapsed_time: f64,
    total_distance: f64,
    avg_power: f64,
    avg_speed: f64,
    max_speed: f64,
    start_position_lat: f64,
    start_position_long: f64,
}

#[wasm_bindgen]
impl LapData {
    #[wasm_bindgen(getter)]
    pub fn start_time(&self) -> f64 {
        self.start_time
    }

    #[wasm_bindgen(getter)]
    pub fn end_time(&self) -> f64 {
        self.end_time
    }

    #[wasm_bindgen(getter)]
    pub fn total_elapsed_time(&self) -> f64 {
        self.total_elapsed_time
    }

    #[wasm_bindgen(getter)]
    pub fn total_distance(&self) -> f64 {
        self.total_distance
    }

    #[wasm_bindgen(getter)]
    pub fn avg_power(&self) -> f64 {
        self.avg_power
    }

    #[wasm_bindgen(getter)]
    pub fn avg_speed(&self) -> f64 {
        self.avg_speed
    }

    #[wasm_bindgen(getter)]
    pub fn max_speed(&self) -> f64 {
        self.max_speed
    }

    #[wasm_bindgen(getter)]
    pub fn start_position_lat(&self) -> f64 {
        self.start_position_lat
    }

    #[wasm_bindgen(getter)]
    pub fn start_position_long(&self) -> f64 {
        self.start_position_long
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct ParsedFitFile {
    fit_data: FitData,
    laps: Vec<LapData>,
    parsing_statistics: ParsingStatistics,
}

#[wasm_bindgen]
impl ParsedFitFile {
    #[wasm_bindgen(getter)]
    pub fn fit_data(&self) -> FitData {
        self.fit_data.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn laps(&self) -> Vec<LapData> {
        self.laps.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn parsing_statistics(&self) -> ParsingStatistics {
        self.parsing_statistics.clone()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct ParsingStatistics {
    file_size: usize,
    record_count: usize,
    lap_count: usize,
    has_power_data: bool,
    has_gps_data: bool,
    duration_seconds: f64,
    total_distance_m: f64,
    avg_power: f64,
    max_power: f64,
    avg_speed_ms: f64,
    max_speed_ms: f64,
}

#[wasm_bindgen]
impl ParsingStatistics {
    #[wasm_bindgen(getter)]
    pub fn file_size(&self) -> usize {
        self.file_size
    }

    #[wasm_bindgen(getter)]
    pub fn record_count(&self) -> usize {
        self.record_count
    }

    #[wasm_bindgen(getter)]
    pub fn lap_count(&self) -> usize {
        self.lap_count
    }

    #[wasm_bindgen(getter)]
    pub fn has_power_data(&self) -> bool {
        self.has_power_data
    }

    #[wasm_bindgen(getter)]
    pub fn has_gps_data(&self) -> bool {
        self.has_gps_data
    }

    #[wasm_bindgen(getter)]
    pub fn duration_seconds(&self) -> f64 {
        self.duration_seconds
    }

    #[wasm_bindgen(getter)]
    pub fn total_distance_m(&self) -> f64 {
        self.total_distance_m
    }

    #[wasm_bindgen(getter)]
    pub fn avg_power(&self) -> f64 {
        self.avg_power
    }

    #[wasm_bindgen(getter)]
    pub fn max_power(&self) -> f64 {
        self.max_power
    }

    #[wasm_bindgen(getter)]
    pub fn avg_speed_ms(&self) -> f64 {
        self.avg_speed_ms
    }

    #[wasm_bindgen(getter)]
    pub fn max_speed_ms(&self) -> f64 {
        self.max_speed_ms
    }
}

// Simple FIT file parser - basic implementation
// Note: This is a simplified parser focused on the first implementation
// A full FIT parser would require handling all message types and field definitions
#[wasm_bindgen]
pub fn parse_fit_file(file_data: &[u8]) -> Result<ParsedFitFile, JsValue> {
    // Validate file header
    crate::security::SecurityValidator::new().validate_fit_data(file_data)
        .map_err(|e| JsValue::from_str(&format!("Validation error: {:?}", e)))?;

    if file_data.len() < 12 {
        return Err(JsValue::from_str("File too small to be a valid FIT file"));
    }

    // Parse FIT header (variables prefixed with _ as they're read but not currently used)
    let _header_size = file_data[0] as usize;
    let _protocol_version = file_data[1];
    let _profile_version = LittleEndian::read_u16(&file_data[2..4]);
    let _data_size = LittleEndian::read_u32(&file_data[4..8]) as usize;

    // Check for FIT file signature ".FIT"
    if &file_data[8..12] != b".FIT" {
        return Err(JsValue::from_str("Invalid FIT file signature"));
    }

    // Parse the actual FIT data using the fitparser crate
    let parser = FitParserWrapper::new(file_data.to_vec())
        .map_err(|e| JsValue::from_str(&format!("Failed to create FIT parser: {}", e)))?;

    let (fit_records, fit_laps) = parser.parse()
        .map_err(|e| JsValue::from_str(&format!("Failed to parse FIT data: {}", e)))?;

    // Convert FIT records to our data structure
    let mut timestamps = Vec::new();
    let mut power = Vec::new();
    let mut velocity = Vec::new();
    let mut position_lat = Vec::new();
    let mut position_long = Vec::new();
    let mut altitude = Vec::new();
    let mut distance = Vec::new();
    let mut air_speed = Vec::new();
    let mut wind_speed = Vec::new();
    let mut battery_soc = Vec::new();
    let mut heart_rate = Vec::new();
    let mut cadence = Vec::new();
    let mut temperature = Vec::new();

    for record in &fit_records {
        timestamps.push(record.timestamp);
        power.push(record.power.unwrap_or(0.0));
        velocity.push(record.speed.unwrap_or(0.0));
        position_lat.push(record.position_lat.unwrap_or(0.0));
        position_long.push(record.position_long.unwrap_or(0.0));
        altitude.push(record.altitude.unwrap_or(0.0));
        distance.push(record.distance.unwrap_or(0.0));
        air_speed.push(record.air_speed.unwrap_or(0.0));
        wind_speed.push(record.wind_speed.unwrap_or(0.0));
        battery_soc.push(record.battery_soc.unwrap_or(0.0));
        heart_rate.push(record.heart_rate.unwrap_or(0.0));
        cadence.push(record.cadence.unwrap_or(0.0));
        temperature.push(record.temperature.unwrap_or(0.0));
    }

    let fit_data = FitData {
        timestamps,
        power: power.clone(),
        velocity: velocity.clone(),
        position_lat,
        position_long,
        altitude,
        distance: distance.clone(),
        air_speed,
        wind_speed,
        battery_soc,
        heart_rate: heart_rate.clone(),
        cadence: cadence.clone(),
        temperature,
    };

    // Convert FIT laps to our data structure
    let mut laps = Vec::new();
    for fit_lap in &fit_laps {
        laps.push(LapData {
            start_time: fit_lap.start_time,
            end_time: fit_lap.end_time,
            total_elapsed_time: fit_lap.total_elapsed_time,
            total_distance: fit_lap.total_distance,
            avg_power: fit_lap.avg_power,
            avg_speed: fit_lap.avg_speed,
            max_speed: fit_lap.max_speed,
            start_position_lat: fit_lap.start_position_lat.unwrap_or(0.0),
            start_position_long: fit_lap.start_position_long.unwrap_or(0.0),
        });
    }

    // Calculate statistics from real data
    let record_count = fit_records.len();
    let lap_count = fit_laps.len();
    let has_power_data = power.iter().any(|&p| p > 0.0);
    let has_gps_data = fit_data.position_lat.iter().any(|&lat| lat != 0.0);

    let duration = if record_count > 0 {
        fit_data.timestamps.last().unwrap() - fit_data.timestamps.first().unwrap()
    } else {
        0.0
    };

    let total_distance = distance.last().unwrap_or(&0.0) - distance.first().unwrap_or(&0.0);

    let parsing_statistics = ParsingStatistics {
        file_size: file_data.len(),
        record_count,
        lap_count,
        has_power_data,
        has_gps_data,
        duration_seconds: duration,
        total_distance_m: total_distance,
        avg_power: if has_power_data {
            let valid_power: Vec<f64> = power.iter().filter(|&&p| p > 0.0).cloned().collect();
            if valid_power.is_empty() { 0.0 } else { valid_power.iter().sum::<f64>() / valid_power.len() as f64 }
        } else { 0.0 },
        max_power: power.iter().fold(0.0, |a, &b| a.max(b)),
        avg_speed_ms: if !velocity.is_empty() {
            velocity.iter().sum::<f64>() / velocity.len() as f64
        } else { 0.0 },
        max_speed_ms: velocity.iter().fold(0.0, |a, &b| a.max(b)),
    };

    Ok(ParsedFitFile {
        fit_data,
        laps,
        parsing_statistics,
    })
}

// Real FIT parsing now implemented - no more estimation needed