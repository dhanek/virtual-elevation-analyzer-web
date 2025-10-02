use byteorder::{ByteOrder, LittleEndian};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

// FIT file constants
const FIT_HEADER_MIN_SIZE: usize = 12;
const FIT_HEADER_MAX_SIZE: usize = 14;

// FIT message types
const FIT_MESSAGE_FILE_ID: u8 = 0;
const FIT_MESSAGE_RECORD: u8 = 20;
const FIT_MESSAGE_LAP: u8 = 19;
const FIT_MESSAGE_SESSION: u8 = 18;

// Field numbers for record messages
const FIELD_TIMESTAMP: u8 = 253;
const FIELD_POSITION_LAT: u8 = 0;
const FIELD_POSITION_LONG: u8 = 1;
const FIELD_ALTITUDE: u8 = 2;
const FIELD_ENHANCED_ALTITUDE: u8 = 78;
const FIELD_SPEED: u8 = 6;
const FIELD_ENHANCED_SPEED: u8 = 73;
const FIELD_POWER: u8 = 7;
const FIELD_DISTANCE: u8 = 5;

// Field numbers for lap messages
const FIELD_LAP_START_TIME: u8 = 2;
const FIELD_LAP_TOTAL_ELAPSED_TIME: u8 = 7;
const FIELD_LAP_TOTAL_DISTANCE: u8 = 9;
const FIELD_LAP_AVG_SPEED: u8 = 14;
const FIELD_LAP_MAX_SPEED: u8 = 15;
const FIELD_LAP_AVG_POWER: u8 = 21;
const FIELD_LAP_START_POSITION_LAT: u8 = 3;
const FIELD_LAP_START_POSITION_LONG: u8 = 4;

// FIT base type definitions
const FIT_BASE_TYPE_UINT8: u8 = 2;
const FIT_BASE_TYPE_SINT16: u8 = 131;
const FIT_BASE_TYPE_UINT16: u8 = 132;
const FIT_BASE_TYPE_SINT32: u8 = 133;
const FIT_BASE_TYPE_UINT32: u8 = 134;

// FIT time epoch (Dec 31, 1989 00:00:00 UTC)
const FIT_TIME_EPOCH: i64 = 631065600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FitRecord {
    pub timestamp: f64,
    pub distance: Option<f64>,
    pub position_lat: Option<f64>,
    pub position_long: Option<f64>,
    pub altitude: Option<f64>,
    pub speed: Option<f64>,
    pub power: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FitLap {
    pub start_time: f64,
    pub end_time: f64,
    pub total_elapsed_time: f64,
    pub total_distance: f64,
    pub avg_speed: f64,
    pub max_speed: f64,
    pub avg_power: f64,
    pub start_position_lat: Option<f64>,
    pub start_position_long: Option<f64>,
}

pub struct FitDecoder {
    data: Vec<u8>,
    position: usize,
    definitions: HashMap<u8, FieldDefinition>,
}

#[derive(Debug, Clone)]
struct FieldDefinition {
    message_type: u8,
    fields: Vec<Field>,
}

#[derive(Debug, Clone)]
struct Field {
    field_number: u8,
    size: u8,
    base_type: u8,
}

impl FitDecoder {
    pub fn new(data: Vec<u8>) -> Result<Self, String> {
        if data.len() < FIT_HEADER_MIN_SIZE {
            return Err("File too small to be a valid FIT file".to_string());
        }

        // Verify FIT signature
        if &data[8..12] != b".FIT" {
            return Err("Invalid FIT file signature".to_string());
        }

        // Parse and validate header
        let header_size = data[0] as usize;
        let protocol_version = data[1];
        let profile_version = LittleEndian::read_u16(&data[2..4]);
        let data_size = LittleEndian::read_u32(&data[4..8]) as usize;

        web_sys::console::log_1(&format!(
            "FIT Header: size={}, protocol={}, profile={}, data_size={}, total_file_size={}",
            header_size, protocol_version, profile_version, data_size, data.len()
        ).into());

        // Validate header size
        if header_size < FIT_HEADER_MIN_SIZE || header_size > data.len() {
            return Err(format!("Invalid header size: {}", header_size));
        }

        // Validate data size
        let expected_total_size = header_size + data_size + 2; // +2 for CRC
        if expected_total_size != data.len() {
            web_sys::console::warn_1(&format!(
                "Warning: Expected file size {} but got {}", expected_total_size, data.len()
            ).into());
        }

        Ok(FitDecoder {
            data,
            position: 0,
            definitions: HashMap::new(),
        })
    }

    pub fn parse(&mut self) -> Result<(Vec<FitRecord>, Vec<FitLap>), String> {
        // Skip header
        let header_size = self.data[0] as usize;
        self.position = header_size.max(FIT_HEADER_MIN_SIZE);

        web_sys::console::log_1(&format!(
            "Starting FIT parsing at position {}, file size: {}",
            self.position, self.data.len()
        ).into());

        let mut records = Vec::new();
        let mut laps = Vec::new();
        let mut message_count = 0;
        let mut error_count = 0;

        // Parse data records
        while self.position < self.data.len() - 2 { // -2 for CRC
            message_count += 1;

            // Log progress periodically
            if message_count % 100 == 0 {
                web_sys::console::log_1(&format!(
                    "Processed {} messages, position: {}/{}, records: {}, laps: {}",
                    message_count, self.position, self.data.len(), records.len(), laps.len()
                ).into());
            }

            match self.read_message() {
                Ok(Some(message)) => {
                    match message {
                        FitMessage::Record(record) => {
                            if records.len() < 5 {  // Log first few records for debugging
                                web_sys::console::log_1(&format!(
                                    "Record {}: timestamp={:.1}, power={:?}",
                                    records.len() + 1, record.timestamp, record.power
                                ).into());
                            }
                            records.push(record);
                        },
                        FitMessage::Lap(lap) => {
                            web_sys::console::log_1(&format!(
                                "Lap {}: start={:.1}, duration={:.1}s",
                                laps.len() + 1, lap.start_time, lap.total_elapsed_time
                            ).into());
                            laps.push(lap);
                        }
                    }
                }
                Ok(None) => {} // Skip unknown messages
                Err(e) => {
                    error_count += 1;
                    if error_count <= 10 {  // Limit error logging
                        web_sys::console::warn_1(&format!("Warning parsing message {}: {}", message_count, e).into());
                    }

                    // Try to continue parsing by skipping one byte
                    self.position += 1;
                    if self.position >= self.data.len() {
                        break;
                    }
                }
            }
        }

        web_sys::console::log_1(&format!(
            "Parsing complete: {} messages processed, {} records, {} laps, {} errors",
            message_count, records.len(), laps.len(), error_count
        ).into());

        // Sort records by timestamp
        records.sort_by(|a, b| a.timestamp.partial_cmp(&b.timestamp).unwrap());

        Ok((records, laps))
    }

    fn read_message(&mut self) -> Result<Option<FitMessage>, String> {
        if self.position >= self.data.len() {
            return Ok(None);
        }

        let record_header = self.data[self.position];
        self.position += 1;

        // Check for compressed timestamp header (bit 7 set)
        if (record_header & 0x80) != 0 {
            // Compressed timestamp header - extract local message type and time offset
            let local_message_type = (record_header & 0x60) >> 5; // bits 5-6
            let time_offset = record_header & 0x1F; // bits 0-4

            web_sys::console::log_1(&format!(
                "Compressed timestamp: local_type={}, time_offset={}",
                local_message_type, time_offset
            ).into());

            // For now, try to read as a regular data message
            return self.read_data_message(local_message_type);
        }

        let is_definition = (record_header & 0x40) != 0;
        let local_message_type = record_header & 0x0F;

        web_sys::console::log_1(&format!(
            "Message header: 0x{:02x}, definition={}, local_type={}",
            record_header, is_definition, local_message_type
        ).into());

        if is_definition {
            self.read_definition_message(local_message_type)?;
            Ok(None)
        } else {
            self.read_data_message(local_message_type)
        }
    }

    fn read_definition_message(&mut self, local_message_type: u8) -> Result<(), String> {
        // Ensure we have at least the minimum definition message size
        if self.position + 5 > self.data.len() {
            return Err(format!("Definition message header too short: need 5 bytes, have {}",
                self.data.len() - self.position));
        }

        let _reserved = self.data[self.position];
        let _architecture = self.data[self.position + 1];
        let global_message_number = LittleEndian::read_u16(&self.data[self.position + 2..]);
        let field_count = self.data[self.position + 4];
        self.position += 5;

        // Validate field count is reasonable (prevent memory issues)
        if field_count > 100 {
            return Err(format!("Unreasonable field count: {}", field_count));
        }

        // Check if we have enough data for all field definitions (3 bytes per field)
        let fields_data_needed = field_count as usize * 3;
        if self.position + fields_data_needed > self.data.len() {
            return Err(format!("Not enough data for {} field definitions: need {} bytes, have {}",
                field_count, fields_data_needed, self.data.len() - self.position));
        }

        let mut fields = Vec::new();
        for i in 0..field_count {
            // Double check we still have enough data for this field
            if self.position + 3 > self.data.len() {
                return Err(format!("Not enough data for field {} definition", i));
            }

            let field_number = self.data[self.position];
            let size = self.data[self.position + 1];
            let base_type = self.data[self.position + 2];
            self.position += 3;

            // Validate field size is reasonable (FIT fields should be small)
            if size > 8 {
                web_sys::console::warn_1(&format!(
                    "Warning: Suspicious field size {} for field {} - possible parsing error",
                    size, field_number
                ).into());
                // Skip this field definition as it's likely corrupted
                continue;
            }

            // Validate base type is valid (0-15 are valid FIT base types)
            if (base_type & 0x0F) > 15 {
                web_sys::console::warn_1(&format!(
                    "Warning: Invalid base type {} for field {} - skipping",
                    base_type, field_number
                ).into());
                continue;
            }

            fields.push(Field {
                field_number,
                size,
                base_type,
            });

            // Log field definitions for debugging key message types
            if global_message_number == FIT_MESSAGE_RECORD as u16 || global_message_number == FIT_MESSAGE_LAP as u16 {
                web_sys::console::log_1(&format!(
                    "Field {}: number={}, size={}, base_type={} (0x{:02x})",
                    i, field_number, size, base_type & 0x0F, base_type
                ).into());
            }
        }

        let definition = FieldDefinition {
            message_type: global_message_number as u8,
            fields,
        };

        web_sys::console::log_1(&format!(
            "Defined message type {} (local {}) with {} fields",
            global_message_number, local_message_type, field_count
        ).into());

        self.definitions.insert(local_message_type, definition);
        Ok(())
    }

    fn read_data_message(&mut self, local_message_type: u8) -> Result<Option<FitMessage>, String> {
        let definition = self.definitions.get(&local_message_type)
            .ok_or_else(|| format!("No definition for local message type {}", local_message_type))?
            .clone();

        let mut field_values = HashMap::new();

        for field in &definition.fields {
            let value = self.read_field_value(field)?;
            field_values.insert(field.field_number, value);
        }

        match definition.message_type {
            FIT_MESSAGE_RECORD => {
                if let Some(record) = self.create_record(&field_values) {
                    Ok(Some(FitMessage::Record(record)))
                } else {
                    Ok(None)
                }
            }
            FIT_MESSAGE_LAP => {
                if let Some(lap) = self.create_lap(&field_values) {
                    Ok(Some(FitMessage::Lap(lap)))
                } else {
                    Ok(None)
                }
            }
            _ => Ok(None) // Ignore other message types
        }
    }

    fn read_field_value(&mut self, field: &Field) -> Result<FieldValue, String> {
        // Ensure we have enough data to read this field
        if self.position + field.size as usize > self.data.len() {
            return Err(format!("Not enough data to read field {}: need {} bytes, have {}",
                field.field_number, field.size, self.data.len() - self.position));
        }

        // Handle zero-size fields
        if field.size == 0 {
            return Ok(FieldValue::Invalid);
        }

        let base_type_clean = field.base_type & 0x0F;  // Mask to get base type

        // Debug log field reading for important fields
        if field.field_number == FIELD_POWER || field.field_number == FIELD_TIMESTAMP ||
           field.field_number == FIELD_POSITION_LAT || field.field_number == FIELD_DISTANCE {
            web_sys::console::log_1(&format!(
                "Reading field {}: base_type={} (0x{:02x}), size={}, position={}",
                field.field_number, base_type_clean, field.base_type, field.size, self.position
            ).into());
        }

        let value = match base_type_clean {
            0 => { // ENUM (same as UINT8)
                if field.size >= 1 {
                    let val = self.data[self.position];
                    self.position += field.size as usize;
                    if val == 0xFF { FieldValue::Invalid } else { FieldValue::UInt8(val) }
                } else {
                    self.position += field.size as usize;
                    FieldValue::Invalid
                }
            }
            1 => { // SINT8
                if field.size >= 1 {
                    let val = self.data[self.position] as i8;
                    self.position += field.size as usize;
                    if val == 0x7F { FieldValue::Invalid } else { FieldValue::SInt16(val as i16) }
                } else {
                    self.position += field.size as usize;
                    FieldValue::Invalid
                }
            }
            2 => { // UINT8
                if field.size >= 1 {
                    let val = self.data[self.position];
                    self.position += field.size as usize;
                    if val == 0xFF { FieldValue::Invalid } else { FieldValue::UInt8(val) }
                } else {
                    self.position += field.size as usize;
                    FieldValue::Invalid
                }
            }
            3 => { // SINT16
                if field.size >= 2 {
                    let val = LittleEndian::read_i16(&self.data[self.position..]);
                    self.position += field.size as usize;
                    if val == 0x7FFF { FieldValue::Invalid } else { FieldValue::SInt16(val) }
                } else {
                    self.position += field.size as usize;
                    FieldValue::Invalid
                }
            }
            4 => { // UINT16
                if field.size >= 2 {
                    let val = LittleEndian::read_u16(&self.data[self.position..]);
                    self.position += field.size as usize;
                    if val == 0xFFFF { FieldValue::Invalid } else { FieldValue::UInt16(val) }
                } else {
                    self.position += field.size as usize;
                    FieldValue::Invalid
                }
            }
            5 => { // SINT32
                if field.size >= 4 {
                    let val = LittleEndian::read_i32(&self.data[self.position..]);
                    self.position += field.size as usize;
                    if val == 0x7FFFFFFF { FieldValue::Invalid } else { FieldValue::SInt32(val) }
                } else {
                    self.position += field.size as usize;
                    FieldValue::Invalid
                }
            }
            6 => { // UINT32
                if field.size >= 4 {
                    let val = LittleEndian::read_u32(&self.data[self.position..]);
                    self.position += field.size as usize;
                    if val == 0xFFFFFFFF { FieldValue::Invalid } else { FieldValue::UInt32(val) }
                } else {
                    self.position += field.size as usize;
                    FieldValue::Invalid
                }
            }
            7 => { // STRING
                // Skip string fields for now
                self.position += field.size as usize;
                FieldValue::Invalid
            }
            _ => {
                // Log unknown field types for debugging
                web_sys::console::log_1(&format!(
                    "Unknown field type {} for field {}", base_type_clean, field.field_number
                ).into());
                self.position += field.size as usize;
                FieldValue::Invalid
            }
        };

        // Debug log the parsed value for important fields
        if field.field_number == FIELD_POWER || field.field_number == FIELD_TIMESTAMP ||
           field.field_number == FIELD_POSITION_LAT || field.field_number == FIELD_DISTANCE {
            web_sys::console::log_1(&format!(
                "Field {} parsed value: {:?}", field.field_number, value
            ).into());
        }

        Ok(value)
    }

    fn create_record(&self, fields: &HashMap<u8, FieldValue>) -> Option<FitRecord> {
        let timestamp = fields.get(&FIELD_TIMESTAMP)?.as_timestamp()?;

        // Debug log field values for the first few records
        static mut RECORD_COUNT: u32 = 0;
        unsafe {
            RECORD_COUNT += 1;
            if RECORD_COUNT <= 3 {
                web_sys::console::log_1(&format!(
                    "Record {} field analysis:", RECORD_COUNT
                ).into());
                for (field_num, value) in fields {
                    web_sys::console::log_1(&format!(
                        "  Field {}: {:?}", field_num, value
                    ).into());
                }
            }
        }

        Some(FitRecord {
            timestamp,
            distance: fields.get(&FIELD_DISTANCE).and_then(|v| v.as_distance()),
            position_lat: fields.get(&FIELD_POSITION_LAT).and_then(|v| v.as_position()),
            position_long: fields.get(&FIELD_POSITION_LONG).and_then(|v| v.as_position()),
            altitude: fields.get(&FIELD_ENHANCED_ALTITUDE)
                .or_else(|| fields.get(&FIELD_ALTITUDE))
                .and_then(|v| v.as_altitude()),
            speed: fields.get(&FIELD_ENHANCED_SPEED)
                .or_else(|| fields.get(&FIELD_SPEED))
                .and_then(|v| v.as_speed()),
            power: fields.get(&FIELD_POWER).and_then(|v| v.as_power()),
        })
    }

    fn create_lap(&self, fields: &HashMap<u8, FieldValue>) -> Option<FitLap> {
        let start_timestamp = fields.get(&FIELD_TIMESTAMP)?.as_timestamp()?;
        let start_time = fields.get(&FIELD_LAP_START_TIME)?.as_timestamp()?;
        let elapsed_time = fields.get(&FIELD_LAP_TOTAL_ELAPSED_TIME)?.as_duration()?;

        Some(FitLap {
            start_time,
            end_time: start_timestamp,
            total_elapsed_time: elapsed_time,
            total_distance: fields.get(&FIELD_LAP_TOTAL_DISTANCE)
                .and_then(|v| v.as_distance()).unwrap_or(0.0),
            avg_speed: fields.get(&FIELD_LAP_AVG_SPEED)
                .and_then(|v| v.as_speed()).unwrap_or(0.0),
            max_speed: fields.get(&FIELD_LAP_MAX_SPEED)
                .and_then(|v| v.as_speed()).unwrap_or(0.0),
            avg_power: fields.get(&FIELD_LAP_AVG_POWER)
                .and_then(|v| v.as_power()).unwrap_or(0.0),
            start_position_lat: fields.get(&FIELD_LAP_START_POSITION_LAT)
                .and_then(|v| v.as_position()),
            start_position_long: fields.get(&FIELD_LAP_START_POSITION_LONG)
                .and_then(|v| v.as_position()),
        })
    }
}

#[derive(Debug, Clone)]
enum FieldValue {
    UInt8(u8),
    SInt16(i16),
    UInt16(u16),
    SInt32(i32),
    UInt32(u32),
    Invalid,
}

impl FieldValue {
    fn as_timestamp(&self) -> Option<f64> {
        match self {
            FieldValue::UInt32(val) => {
                if *val == 0xFFFFFFFF {
                    None
                } else {
                    // FIT time is seconds since Dec 31, 1989 00:00:00 UTC
                    // Convert to Unix timestamp (seconds since Jan 1, 1970)
                    Some(*val as f64 + FIT_TIME_EPOCH as f64)
                }
            },
            FieldValue::UInt16(val) => {
                if *val == 0xFFFF {
                    None
                } else {
                    // Handle smaller timestamp fields
                    Some(*val as f64 + FIT_TIME_EPOCH as f64)
                }
            },
            _ => None,
        }
    }

    fn as_position(&self) -> Option<f64> {
        match self {
            FieldValue::SInt32(val) => {
                // Check for invalid position marker
                if *val == 0x7FFFFFFF {
                    None
                } else {
                    // Convert semicircles to degrees: semicircles * (180 / 2^31)
                    Some(*val as f64 * (180.0 / 2147483648.0))
                }
            }
            _ => None,
        }
    }

    fn as_altitude(&self) -> Option<f64> {
        match self {
            // Enhanced altitude (field 78) - usually uint16 in meters with 5x scaling + 500m offset
            FieldValue::UInt16(val) => {
                if *val == 0xFFFF {
                    None
                } else {
                    Some((*val as f64 / 5.0) - 500.0)
                }
            },
            // Regular altitude (field 2) - usually uint16 in meters with 5x scaling + 500m offset
            FieldValue::SInt16(val) => {
                if *val == 0x7FFF {
                    None
                } else {
                    Some((*val as f64 / 5.0) - 500.0)
                }
            },
            _ => None,
        }
    }

    fn as_speed(&self) -> Option<f64> {
        match self {
            FieldValue::UInt16(val) => {
                if *val == 0xFFFF {
                    None
                } else {
                    // FIT speed is in mm/s, convert to m/s
                    Some(*val as f64 / 1000.0)
                }
            },
            _ => None,
        }
    }

    fn as_distance(&self) -> Option<f64> {
        match self {
            FieldValue::UInt32(val) => {
                if *val == 0xFFFFFFFF {
                    None
                } else {
                    // FIT distance is in cm, convert to meters
                    Some(*val as f64 / 100.0)
                }
            },
            _ => None,
        }
    }

    fn as_power(&self) -> Option<f64> {
        match self {
            FieldValue::UInt16(val) => {
                if *val == 0xFFFF {
                    None
                } else {
                    Some(*val as f64) // Power is already in watts
                }
            },
            FieldValue::UInt8(val) => {
                if *val == 0xFF {
                    None
                } else {
                    Some(*val as f64) // Power from 8-bit field
                }
            },
            _ => None,
        }
    }

    fn as_duration(&self) -> Option<f64> {
        match self {
            FieldValue::UInt32(val) => {
                if *val == 0xFFFFFFFF {
                    None
                } else {
                    // FIT duration is in milliseconds, convert to seconds
                    Some(*val as f64 / 1000.0)
                }
            },
            _ => None,
        }
    }
}

#[derive(Debug)]
enum FitMessage {
    Record(FitRecord),
    Lap(FitLap),
}