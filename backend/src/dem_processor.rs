use std::io::Cursor;
use wasm_bindgen::prelude::*;
use tiff::decoder::{Decoder, DecodingResult};
use proj4rs::Proj;

#[wasm_bindgen]
pub struct DEMProcessor {
    width: u32,
    height: u32,
    transform: GeoTransform,
    nodata_value: f64,
    data: Vec<f32>, // Full raster data
    wgs84_proj: Option<Proj>, // WGS84 projection
    dem_proj: Option<Proj>,   // DEM CRS projection
}

/// GeoTransform contains the affine transformation parameters
/// to convert from pixel coordinates to geographic coordinates
#[derive(Debug, Clone)]
struct GeoTransform {
    /// X-coordinate of the upper-left corner of the upper-left pixel
    origin_x: f64,
    /// Y-coordinate of the upper-left corner of the upper-left pixel
    origin_y: f64,
    /// Pixel width in geographic units
    pixel_width: f64,
    /// Pixel height in geographic units (typically negative)
    pixel_height: f64,
    /// Rotation parameter (usually 0)
    rotation_x: f64,
    /// Rotation parameter (usually 0)
    rotation_y: f64,
}

impl GeoTransform {
    /// Convert pixel coordinates to geographic coordinates
    fn pixel_to_geo(&self, col: f64, row: f64) -> (f64, f64) {
        let x = self.origin_x + col * self.pixel_width + row * self.rotation_x;
        let y = self.origin_y + col * self.rotation_y + row * self.pixel_height;
        (x, y)
    }

    /// Convert geographic coordinates to pixel coordinates
    fn geo_to_pixel(&self, x: f64, y: f64) -> (f64, f64) {
        // Inverse affine transformation
        let det = self.pixel_width * self.pixel_height - self.rotation_x * self.rotation_y;
        if det.abs() < 1e-10 {
            return (0.0, 0.0);
        }

        let col = (self.pixel_height * (x - self.origin_x) - self.rotation_x * (y - self.origin_y)) / det;
        let row = (self.pixel_width * (y - self.origin_y) - self.rotation_y * (x - self.origin_x)) / det;
        (col, row)
    }
}

#[wasm_bindgen]
impl DEMProcessor {
    /// Create a new DEMProcessor from GeoTIFF file bytes
    #[wasm_bindgen(constructor)]
    pub fn new(file_data: &[u8], filename: Option<String>) -> Result<DEMProcessor, JsValue> {
        let cursor = Cursor::new(file_data);
        let mut decoder = Decoder::new(cursor)
            .map_err(|e| JsValue::from_str(&format!("Failed to create TIFF decoder: {}", e)))?;

        // Get image dimensions
        let (width, height) = decoder.dimensions()
            .map_err(|e| JsValue::from_str(&format!("Failed to get image dimensions: {}", e)))?;

        // Read the image data
        let image_data = decoder.read_image()
            .map_err(|e| JsValue::from_str(&format!("Failed to read image: {}", e)))?;

        // Convert to f32 array
        let data = Self::convert_to_f32(image_data, width as usize * height as usize)?;

        // Parse GeoTIFF tags for geospatial metadata
        let transform = Self::parse_geotransform(&mut decoder, filename.as_deref(), width, height)?;

        // Get nodata value (default to -9999 if not specified)
        let nodata_value = Self::parse_nodata(&mut decoder).unwrap_or(-9999.0);

        // Initialize coordinate transformers based on detected projection
        let (wgs84_proj, dem_proj) = Self::setup_projection(&transform)?;

        Ok(DEMProcessor {
            width,
            height,
            transform,
            nodata_value,
            data,
            wgs84_proj,
            dem_proj,
        })
    }

    /// Perform batch elevation lookup for multiple lat/lon coordinates
    #[wasm_bindgen]
    pub fn batch_lookup(&mut self, lats: Vec<f64>, lons: Vec<f64>) -> Result<Vec<f64>, JsValue> {
        if lats.len() != lons.len() {
            return Err(JsValue::from_str("lats and lons must have the same length"));
        }

        let mut altitudes = Vec::with_capacity(lats.len());

        for i in 0..lats.len() {
            let lat = lats[i];
            let lon = lons[i];

            // Transform coordinates if DEM uses a different CRS
            let (x, y) = if let (Some(ref wgs84), Some(ref dem)) = (&self.wgs84_proj, &self.dem_proj) {
                // Transform from WGS84 to DEM CRS
                let mut point = (lon.to_radians(), lat.to_radians(), 0.0);
                match proj4rs::transform::transform(wgs84, dem, &mut point) {
                    Ok(_) => (point.0, point.1),
                    Err(_) => {
                        altitudes.push(f64::NAN);
                        continue;
                    }
                }
            } else {
                // DEM is already in WGS84
                (lon, lat)
            };

            // Convert geographic coordinates to pixel coordinates
            let (col, row) = self.transform.geo_to_pixel(x, y);

            // Check if coordinates are within bounds
            if col < 0.0 || row < 0.0 || col >= self.width as f64 || row >= self.height as f64 {
                altitudes.push(f64::NAN);
                continue;
            }

            // Get elevation value
            let elevation = self.get_pixel_value(col as usize, row as usize);

            // Check for nodata
            if (elevation - self.nodata_value as f32).abs() < 0.01 {
                altitudes.push(f64::NAN);
            } else {
                altitudes.push(elevation as f64);
            }
        }

        Ok(altitudes)
    }

    /// Get the elevation error rate (percentage of failed lookups)
    #[wasm_bindgen]
    pub fn get_bounds(&self) -> Vec<f64> {
        let (min_x, max_y) = self.transform.pixel_to_geo(0.0, 0.0);
        let (max_x, min_y) = self.transform.pixel_to_geo(self.width as f64, self.height as f64);
        vec![min_x, min_y, max_x, max_y]
    }

    /// Get metadata about the DEM
    #[wasm_bindgen]
    pub fn get_metadata(&self) -> String {
        format!(
            "{{\"width\": {}, \"height\": {}, \"nodata\": {}}}",
            self.width, self.height, self.nodata_value
        )
    }

    // Helper methods (not exposed to JS)

    fn get_pixel_value(&self, col: usize, row: usize) -> f32 {
        let idx = row * self.width as usize + col;
        if idx < self.data.len() {
            self.data[idx]
        } else {
            self.nodata_value as f32
        }
    }

    fn convert_to_f32(data: DecodingResult, _size: usize) -> Result<Vec<f32>, JsValue> {
        match data {
            DecodingResult::U8(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::U16(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::U32(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::U64(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::I8(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::I16(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::I32(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::I64(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::F32(values) => Ok(values),
            DecodingResult::F64(values) => Ok(values.iter().map(|&v| v as f32).collect()),
        }
    }

    fn parse_geotransform(
        _decoder: &mut Decoder<Cursor<&[u8]>>,
        filename: Option<&str>,
        width: u32,
        height: u32
    ) -> Result<GeoTransform, JsValue> {
        // Try to parse SRTM-style filename (e.g., N47E007.tif or n47_e007_1arc_v3.tif)
        if let Some(fname) = filename {
            if let Some(transform) = Self::parse_srtm_filename(fname, width, height) {
                web_sys::console::log_1(&format!(
                    "Parsed SRTM filename: origin=({}, {}), pixel_size=({}, {})",
                    transform.origin_x, transform.origin_y, transform.pixel_width, transform.pixel_height
                ).into());
                return Ok(transform);
            }
        }

        // Fallback: use 1-degree grid based on dimensions
        let pixel_width = 1.0 / width as f64;
        let pixel_height = -1.0 / height as f64;

        web_sys::console::warn_1(&"Using generic 1-degree grid transform".into());
        Ok(GeoTransform {
            origin_x: 0.0,
            origin_y: 1.0,
            pixel_width,
            pixel_height,
            rotation_x: 0.0,
            rotation_y: 0.0,
        })
    }

    fn parse_srtm_filename(filename: &str, width: u32, height: u32) -> Option<GeoTransform> {
        // Parse filename format: N47E007 (geographic) or N325E455 (projected ETRS89LAEA)
        let upper = filename.to_uppercase();

        // Extract lat/lon from filename like "N47E007" or "S12W034"
        let mut lat_start = None;
        let mut lon_start = None;

        for (i, ch) in upper.chars().enumerate() {
            if ch == 'N' || ch == 'S' {
                lat_start = Some(i);
            } else if ch == 'E' || ch == 'W' {
                lon_start = Some(i);
                break;
            }
        }

        if let (Some(lat_idx), Some(lon_idx)) = (lat_start, lon_start) {
            let lat_str = &upper[lat_idx..lon_idx];
            let lon_str = &upper[lon_idx..];

            // Parse latitude (N/S)
            let lat = Self::parse_coord(lat_str)?;
            // Parse longitude (E/W)
            let lon = Self::parse_coord(lon_str)?;

            // Detect if these are projected coordinates (>180) or geographic coordinates
            if lat.abs() > 180.0 || lon.abs() > 180.0 {
                // Projected coordinates: N325E455 means northing=3.25M, easting=4.55M meters
                let northing = lat * 10000.0; // 325 -> 3,250,000
                let easting = lon * 10000.0;  // 455 -> 4,550,000

                // Calculate pixel size (50km tile / pixels)
                let tile_size_m = 50000.0; // 50km per tile
                let pixel_size = tile_size_m / width as f64;

                web_sys::console::log_1(&format!(
                    "Projected coordinates: northing={}, easting={}, pixel={}m",
                    northing, easting, pixel_size
                ).into());

                return Some(GeoTransform {
                    origin_x: easting,
                    origin_y: northing + tile_size_m, // Upper edge
                    pixel_width: pixel_size,
                    pixel_height: -pixel_size,
                    rotation_x: 0.0,
                    rotation_y: 0.0,
                });
            } else {
                // Geographic coordinates: Standard SRTM (1° tiles)
                let pixel_width = 1.0 / width as f64;
                let pixel_height = -1.0 / height as f64;

                return Some(GeoTransform {
                    origin_x: lon,
                    origin_y: lat + 1.0, // Upper edge
                    pixel_width,
                    pixel_height,
                    rotation_x: 0.0,
                    rotation_y: 0.0,
                });
            }
        }

        None
    }

    fn parse_coord(s: &str) -> Option<f64> {
        if s.is_empty() {
            return None;
        }

        let dir = s.chars().next()?;
        let num_str = &s[1..].split(|c: char| !c.is_numeric()).next()?;
        let num: f64 = num_str.parse().ok()?;

        let value = match dir {
            'N' | 'E' => num,
            'S' | 'W' => -num,
            _ => return None,
        };

        Some(value)
    }

    fn parse_nodata(_decoder: &mut Decoder<Cursor<&[u8]>>) -> Option<f64> {
        // Try to read GDAL_NODATA tag
        // For now, return default
        Some(-9999.0)
    }

    fn setup_projection(transform: &GeoTransform) -> Result<(Option<Proj>, Option<Proj>), JsValue> {
        // Detect if DEM uses projected coordinates (ETRS89LAEA) vs geographic (WGS84)
        // ETRS89LAEA coordinates are in meters, typically in millions for Europe
        if transform.origin_x.abs() > 1000.0 || transform.origin_y.abs() > 1000.0 {
            // Projected coordinates detected (likely ETRS89LAEA)
            web_sys::console::log_1(&"Detected projected CRS, setting up WGS84→ETRS89LAEA transformation".into());

            // ETRS89 / LAEA Europe (EPSG:3035)
            let wgs84 = Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs")
                .map_err(|e| JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e)))?;

            let etrs89laea = Proj::from_proj_string("+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs")
                .map_err(|e| JsValue::from_str(&format!("Failed to create ETRS89LAEA projection: {:?}", e)))?;

            Ok((Some(wgs84), Some(etrs89laea)))
        } else {
            // Geographic coordinates (WGS84)
            web_sys::console::log_1(&"Detected geographic CRS (WGS84), no transformation needed".into());
            Ok((None, None))
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_geotransform() {
        let transform = GeoTransform {
            origin_x: 0.0,
            origin_y: 100.0,
            pixel_width: 1.0,
            pixel_height: -1.0,
            rotation_x: 0.0,
            rotation_y: 0.0,
        };

        let (x, y) = transform.pixel_to_geo(10.0, 20.0);
        assert_eq!(x, 10.0);
        assert_eq!(y, 80.0);

        let (col, row) = transform.geo_to_pixel(10.0, 80.0);
        assert!((col - 10.0).abs() < 1e-6);
        assert!((row - 20.0).abs() < 1e-6);
    }
}
