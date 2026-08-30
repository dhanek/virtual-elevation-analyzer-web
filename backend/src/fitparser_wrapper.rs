use fitparser::{self, Value, de::DecodeOption};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FitRecord {
    pub timestamp: f64,
    pub distance: Option<f64>,
    pub position_lat: Option<f64>,
    pub position_long: Option<f64>,
    pub altitude: Option<f64>,
    pub speed: Option<f64>,
    pub power: Option<f64>,
    pub heart_rate: Option<f64>,
    pub cadence: Option<f64>,
    pub grade: Option<f64>,
    pub temperature: Option<f64>,
    pub gps_accuracy: Option<f64>,
    pub calories: Option<f64>,
    pub air_speed: Option<f64>,
    pub wind_speed: Option<f64>,
    pub battery_soc: Option<f64>,
    pub wind_yaw: Option<f64>,
    pub air_density: Option<f64>,
    pub road_speed: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FitLap {
    pub start_time: f64,
    pub end_time: f64,
    pub total_elapsed_time: f64,
    // Every summary field below is optional in the FIT profile, and `None` has
    // to stay distinguishable from a genuine zero: a lap that simply omits
    // `total_distance` gets it derived from the records, whereas one that
    // reports 0 m is reporting a measurement. Collapsing the two with
    // `unwrap_or(0.0)` here is what made GoldenCheetah exports render as
    // "0 m / N/A".
    pub total_distance: Option<f64>,
    pub avg_speed: Option<f64>,
    pub max_speed: Option<f64>,
    pub avg_power: Option<f64>,
    pub max_power: Option<f64>,
    pub start_position_lat: Option<f64>,
    pub start_position_long: Option<f64>,
    pub avg_heart_rate: Option<f64>,
    pub max_heart_rate: Option<f64>,
    pub total_calories: Option<f64>,
    pub avg_cadence: Option<f64>,
    pub max_cadence: Option<f64>,
}

pub struct FitParserWrapper {
    data: Vec<u8>,
}

impl FitParserWrapper {
    pub fn new(data: Vec<u8>) -> Result<Self, String> {
        if data.len() < 12 {
            return Err("File too small to be a valid FIT file".to_string());
        }

        // Basic FIT signature check
        if &data[8..12] != b".FIT" {
            return Err("Invalid FIT file signature".to_string());
        }

        Ok(FitParserWrapper { data })
    }

    pub fn parse(&self) -> Result<(Vec<FitRecord>, Vec<FitLap>), String> {
        // Parse FIT file using the fitparser crate
        let mut cursor = Cursor::new(&self.data);

        // Use decode options to extract developer fields properly
        let mut opts = HashSet::new();
        opts.insert(DecodeOption::SkipHeaderCrcValidation);
        opts.insert(DecodeOption::SkipDataCrcValidation);
        // Explicitly preserve all fields including developer fields
        // DO NOT insert DropUnknownFields or DropUnknownMessages - we need developer fields!

        let fit_data = fitparser::de::from_reader_with_options(&mut cursor, &opts)
            .map_err(|e| format!("Failed to parse FIT file: {}", e))?;

        let mut records = Vec::new();
        let mut laps = Vec::new();

        for (_i, data_record) in fit_data.iter().enumerate() {
            match data_record.kind() {
                fitparser::profile::MesgNum::Record => {
                    if let Some(record) = self.extract_record(data_record) {
                        records.push(record);
                    }
                }
                fitparser::profile::MesgNum::Lap => {
                    if let Some(lap) = self.extract_lap(data_record) {
                        laps.push(lap);
                    }
                }
                _ => {} // Skip other message types
            }
        }

        Ok((records, laps))
    }

    fn extract_record(&self, message: &fitparser::FitDataRecord) -> Option<FitRecord> {
        let mut timestamp = None;
        let mut distance = None;
        let mut position_lat = None;
        let mut position_long = None;
        let mut altitude = None;
        let mut speed = None;
        let mut power = None;
        let mut heart_rate = None;
        let mut cadence = None;
        let mut grade = None;
        let mut temperature = None;
        let mut gps_accuracy = None;
        let mut calories = None;
        let mut air_speed = None;
        let mut wind_speed = None;
        let mut battery_soc = None;
        let mut wind_yaw = None;
        let mut air_density = None;
        let mut road_speed = None;

        // Check for developer fields - they might be included in the regular fields() iterator
        // with special names or we need to access them differently

        for field in message.fields() {
            match field.name() {
                "timestamp" => {
                    timestamp = self.extract_f64_value(field.value());
                }
                "distance" => {
                    distance = self.extract_f64_value(field.value());
                }
                "position_lat" => {
                    position_lat = self.extract_position_value(field.value());
                }
                "position_long" => {
                    position_long = self.extract_position_value(field.value());
                }
                "altitude" | "enhanced_altitude" => {
                    altitude = self.extract_f64_value(field.value());
                }
                "speed" | "enhanced_speed" => {
                    // Only use if road_speed is not present
                    if road_speed.is_none() {
                        speed = self.extract_f64_value(field.value());
                    }
                }
                "power" => {
                    power = self.extract_f64_value(field.value());
                }
                "heart_rate" => {
                    heart_rate = self.extract_f64_value(field.value());
                }
                "cadence" => {
                    cadence = self.extract_f64_value(field.value());
                }
                "grade" => {
                    grade = self.extract_f64_value(field.value());
                }
                "temperature" => {
                    temperature = self.extract_f64_value(field.value());
                }
                "gps_accuracy" => {
                    gps_accuracy = self.extract_f64_value(field.value());
                }
                "calories" => {
                    calories = self.extract_f64_value(field.value());
                }
                "battery_soc" => {
                    battery_soc = self.extract_f64_value(field.value());
                }
                // Handle ONLY the specific developer fields requested
                // air_speed_0_11 and wind_speed_0_6
                "air_speed_0_11" => {
                    if let Some(value) = self.extract_f64_value(field.value()) {
                        // Scale by 1000 as indicated in the expected values
                        air_speed = Some(value / 1000.0);
                    }
                }
                // Also check for the plain field names in case they appear without the prefix
                "air_speed" => {
                    // Only use if we haven't found the specific _0_11 field
                    if air_speed.is_none() {
                        if let Some(value) = self.extract_f64_value(field.value()) {
                            air_speed = Some(value / 1000.0);
                        }
                    }
                }
                // Accept both prefixed and unprefixed - last one wins
                "wind_speed" | "0_1_wind_speed" => {
                    let val = self.extract_f64_value(field.value());
                    // Only accept non-zero values, or if we don't have a value yet
                    if val.is_some() && (val.unwrap() != 0.0 || wind_speed.is_none()) {
                        wind_speed = val;
                    }
                }
                "wind_yaw" | "0_0_wind_yaw" => {
                    let val = self.extract_f64_value(field.value());
                    // Accept any value including zero (yaw can be zero)
                    if val.is_some() {
                        wind_yaw = val;
                    }
                }
                "air_density" | "0_3_air_density" => {
                    let val = self.extract_f64_value(field.value());
                    // Only accept non-zero values, or if we don't have a value yet
                    if val.is_some() && (val.unwrap() != 0.0 || air_density.is_none()) {
                        air_density = val;
                    }
                }
                "road_speed" | "0_13_road_speed" => {
                    let val = self.extract_f64_value(field.value());
                    // Only accept non-zero values, or if we don't have a value yet
                    if val.is_some() && (val.unwrap() != 0.0 || road_speed.is_none()) {
                        road_speed = val;
                        speed = val; // Also set as speed for compatibility
                    }
                }
                _ => {
                    // Silently ignore unhandled fields
                }
            }
        }

        // Only create record if we have a timestamp
        timestamp.map(|ts| {
            FitRecord {
                timestamp: ts,
                distance,
                position_lat,
                position_long,
                altitude,
                speed,
                power,
                heart_rate,
                cadence,
                grade,
                temperature,
                gps_accuracy,
                calories,
                air_speed,
                wind_speed,
                battery_soc,
                wind_yaw,
                air_density,
                road_speed,
            }
        })
    }

    fn extract_lap(&self, message: &fitparser::FitDataRecord) -> Option<FitLap> {
    let mut start_time = None;
    // Keep lap_timestamp as a fallback if present (some FIT files place a lap timestamp
    // that isn't the canonical start). We'll prefer start_time + total_elapsed_time
    // for end_time when possible.
    let mut lap_timestamp = None;
        let mut total_elapsed_time = None;
        let mut total_distance = None;
        let mut avg_speed = None;
        let mut max_speed = None;
        let mut avg_power = None;
        let mut max_power = None;
        let mut start_position_lat = None;
        let mut start_position_long = None;
        let mut avg_heart_rate = None;
        let mut max_heart_rate = None;
        let mut total_calories = None;
        let mut avg_cadence = None;
        let mut max_cadence = None;

        for field in message.fields() {
            match field.name() {
                "start_time" => {
                    start_time = self.extract_f64_value(field.value());
                }
                "timestamp" => {
                    // Do not treat the Lap.message timestamp as the canonical lap end.
                    // Capture it as a fallback value instead.
                    lap_timestamp = self.extract_f64_value(field.value());
                }
                "total_elapsed_time" => {
                    total_elapsed_time = self.extract_f64_value(field.value());
                }
                "total_distance" => {
                    total_distance = self.extract_f64_value(field.value());
                }
                "avg_speed" | "enhanced_avg_speed" => {
                    avg_speed = self.extract_f64_value(field.value());
                }
                "max_speed" | "enhanced_max_speed" => {
                    max_speed = self.extract_f64_value(field.value());
                }
                "avg_power" => {
                    avg_power = self.extract_f64_value(field.value());
                }
                "max_power" => {
                    max_power = self.extract_f64_value(field.value());
                }
                "start_position_lat" => {
                    start_position_lat = self.extract_f64_value(field.value());
                }
                "start_position_long" => {
                    start_position_long = self.extract_f64_value(field.value());
                }
                "avg_heart_rate" => {
                    avg_heart_rate = self.extract_f64_value(field.value());
                }
                "max_heart_rate" => {
                    max_heart_rate = self.extract_f64_value(field.value());
                }
                "total_calories" => {
                    total_calories = self.extract_f64_value(field.value());
                }
                "avg_cadence" => {
                    avg_cadence = self.extract_f64_value(field.value());
                }
                "max_cadence" => {
                    max_cadence = self.extract_f64_value(field.value());
                }
                _ => {} // Ignore other fields
            }
        }

        // Resolve the lap's time span. Every field involved is optional in the FIT
        // profile, so take whichever pair actually pins the span down:
        //   - start_time + total_elapsed_time: the canonical case, end is derived.
        //   - timestamp + total_elapsed_time: a few producers set only a timestamp
        //     on the lap message; it is the end, so the start is derived.
        //   - start_time + timestamp: no elapsed field at all, which is what
        //     GoldenCheetah writes when it exports a selection out of a ride. The
        //     span between the two IS the elapsed time.
        // A lap that pins down none of these carries no usable range and is dropped.
        let (raw_start, raw_end, explicit_elapsed) =
            match (start_time, lap_timestamp, total_elapsed_time) {
                (Some(st), _, Some(elapsed)) => (st, st + elapsed, Some(elapsed)),
                (None, Some(ts), Some(elapsed)) => (ts - elapsed, ts, Some(elapsed)),
                (Some(st), Some(ts), None) => (st, ts, None),
                _ => return None,
            };

        // Ensure ordering start <= end
        let (start_time_final, end_time_final) = if raw_start <= raw_end {
            (raw_start, raw_end)
        } else {
            (raw_end, raw_start)
        };

        Some(FitLap {
            start_time: start_time_final,
            end_time: end_time_final,
            total_elapsed_time: explicit_elapsed
                .unwrap_or(end_time_final - start_time_final),
            total_distance,
            avg_speed,
            max_speed,
            avg_power,
            max_power,
            start_position_lat,
            start_position_long,
            avg_heart_rate,
            max_heart_rate,
            total_calories,
            avg_cadence,
            max_cadence,
        })
    }

    fn extract_f64_value(&self, value: &Value) -> Option<f64> {
        match value {
            Value::Timestamp(ts) => Some(ts.timestamp() as f64),
            Value::SInt8(v) => Some(*v as f64),
            Value::UInt8(v) => Some(*v as f64),
            Value::SInt16(v) => Some(*v as f64),
            Value::UInt16(v) => Some(*v as f64),
            Value::SInt32(v) => Some(*v as f64),
            Value::UInt32(v) => Some(*v as f64),
            Value::SInt64(v) => Some(*v as f64),
            Value::UInt64(v) => Some(*v as f64),
            Value::Float32(v) => Some(*v as f64),
            Value::Float64(v) => Some(*v),
            Value::Array(arr) => {
                // Handle array values by taking the first element
                if !arr.is_empty() {
                    self.extract_f64_value(&arr[0])
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn extract_position_value(&self, value: &Value) -> Option<f64> {
        // Convert FIT semicircles to degrees
        match value {
            Value::SInt32(semicircles) => {
                if *semicircles != 0x7FFFFFFF {  // Check for invalid position
                    // Convert semicircles to degrees: semicircles * (180 / 2^31)
                    Some(*semicircles as f64 * (180.0 / 2147483648.0))
                } else {
                    None
                }
            }
            Value::UInt32(semicircles) => {
                if *semicircles != 0xFFFFFFFF {  // Check for invalid position
                    // Convert semicircles to degrees: semicircles * (180 / 2^31)
                    // Handle as signed 32-bit for position conversion
                    let signed_val = *semicircles as i32;
                    Some(signed_val as f64 * (180.0 / 2147483648.0))
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}