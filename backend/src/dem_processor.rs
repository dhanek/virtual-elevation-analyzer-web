use std::io::Cursor;
use wasm_bindgen::prelude::*;
use tiff::decoder::{Decoder, DecodingResult, Limits};
use tiff::tags::Tag;
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
        Self::new_with_world_file(file_data, filename, None, None)
    }

    /// Create a new DEMProcessor from TIFF file bytes with optional world file and projection file
    #[wasm_bindgen]
    pub fn new_with_world_file(
        file_data: &[u8],
        filename: Option<String>,
        world_file_data: Option<String>,
        proj_file_data: Option<String>
    ) -> Result<DEMProcessor, JsValue> {
        // Create custom limits for large DEM files (328MB file)
        let mut limits = Limits::default();
        limits.decoding_buffer_size = 2_000_000_000; // 2GB
        limits.ifd_value_size = 500_000_000; // 500MB for large arrays
        limits.intermediate_buffer_size = 500_000_000; // 500MB

        let cursor = Cursor::new(file_data);
        let mut decoder = Decoder::new(cursor)
            .map_err(|e| {
                let error_msg = format!("{}", e);
                JsValue::from_str(&format!(
                    "⚠️ Failed to Read DEM File\n\n\
                    The file does not appear to be a valid TIFF/GeoTIFF format.\n\n\
                    Supported formats:\n\
                    • GeoTIFF (.tif, .tiff)\n\
                    • Uncompressed or LZW/Deflate compression\n\
                    • With optional .tfw (world file) and .prj (projection file)\n\n\
                    If you have a different format:\n\
                    • HFA (.img) files: Convert with GDAL\n\
                    • ASCII Grid (.asc): Convert with GDAL\n\
                    • HGT (SRTM): Convert with GDAL\n\n\
                    Conversion command:\n\
                    gdal_translate -of GTiff input.img output.tif\n\n\
                    Technical error: {}",
                    error_msg
                ))
            })?
            .with_limits(limits);

        // Get image dimensions
        let (width, height) = decoder.dimensions()
            .map_err(|e| JsValue::from_str(&format!("Failed to get image dimensions: {}", e)))?;

        // Read the image data
        let image_data = decoder.read_image()
            .map_err(|e| {
                let error_msg = format!("{}", e);

                // Check for unsupported compression
                if error_msg.contains("Compression method Unknown") || error_msg.contains("unsupported") {
                    // Extract compression code if present (e.g., "Unknown(50000)")
                    let compression_info = if let Some(start) = error_msg.find("Unknown(") {
                        if let Some(end) = error_msg[start..].find(')') {
                            let code = &error_msg[start+8..start+end];
                            match code {
                                "50000" => " (LERC compression)",
                                "34712" => " (JPEG2000 compression)",
                                "50001" => " (WEBP compression)",
                                _ => ""
                            }
                        } else { "" }
                    } else { "" };

                    JsValue::from_str(&format!(
                        "⚠️ Unsupported TIFF Compression Format{}\n\n\
                        This DEM file uses a compression method not supported by the web browser.\n\n\
                        📋 SOLUTION OPTIONS:\n\n\
                        1️⃣ Convert using GDAL (Recommended):\n\
                           gdal_translate -co COMPRESS=NONE input.tif output.tif\n\n\
                        2️⃣ Convert using QGIS (GUI option):\n\
                           • Install QGIS (free): https://qgis.org/download/\n\
                           • Right-click layer → Export → Save As → Set 'Compression: None'\n\n\
                        3️⃣ Install GDAL command-line:\n\
                           • macOS: brew install gdal\n\
                           • Windows: https://gdal.org/download.html#windows\n\
                           • Linux: sudo apt install gdal-bin\n\n\
                        📚 Need help? See GDAL documentation: https://gdal.org/programs/gdal_translate.html\n\n\
                        Technical details: {}",
                        compression_info,
                        error_msg
                    ))
                } else {
                    JsValue::from_str(&format!("Failed to read image: {}", error_msg))
                }
            })?;

        // Log the data type
        let is_u8 = matches!(&image_data, tiff::decoder::DecodingResult::U8(_));
        let data_type_name = match &image_data {
            tiff::decoder::DecodingResult::U8(_) => "U8 (8-bit unsigned)",
            tiff::decoder::DecodingResult::U16(_) => "U16 (16-bit unsigned)",
            tiff::decoder::DecodingResult::U32(_) => "U32 (32-bit unsigned)",
            tiff::decoder::DecodingResult::U64(_) => "U64 (64-bit unsigned)",
            tiff::decoder::DecodingResult::I8(_) => "I8 (8-bit signed)",
            tiff::decoder::DecodingResult::I16(_) => "I16 (16-bit signed)",
            tiff::decoder::DecodingResult::I32(_) => "I32 (32-bit signed)",
            tiff::decoder::DecodingResult::I64(_) => "I64 (64-bit signed)",
            tiff::decoder::DecodingResult::F32(_) => "F32 (32-bit float)",
            tiff::decoder::DecodingResult::F64(_) => "F64 (64-bit float)",
        };
        web_sys::console::log_1(&format!("TIFF data type: {}", data_type_name).into());

        if is_u8 {
            web_sys::console::warn_1(&"Warning: U8 DEM detected (8-bit, 0-255 range). This is a low-quality format with limited elevation range.".into());
        }

        // Convert to f32 array
        let data = Self::convert_to_f32(image_data, width as usize * height as usize)?;

        // Note: We do NOT filter 255 values for U8 DEMs.
        // The TIFF has a proper nodata value (-9999), and 255m is a valid elevation.
        // If the DEM has invalid data, it should be marked with the proper nodata value.

        // Parse GeoTIFF tags for geospatial metadata
        // If world file is provided, use it; otherwise try GeoTIFF tags
        let transform = if let Some(ref world_file) = world_file_data {
            Self::parse_world_file(world_file)?
        } else {
            Self::parse_geotransform(&mut decoder, filename.as_deref(), width, height)?
        };

        // Get nodata value (default to -9999 if not specified)
        let nodata_value = Self::parse_nodata(&mut decoder).unwrap_or(-9999.0);

        // Validate: if world file is provided without .prj file, warn user
        if world_file_data.is_some() && proj_file_data.is_none() {
            web_sys::console::warn_1(&
                "World file loaded without projection file (.prj). Coordinate system is ambiguous. \
                Assuming coordinates are in the projection detected from world file values, or WGS84 if geographic."
            .into());
        }

        // Validate bounds - check if coordinates look suspicious (e.g., [0,0,1,1])
        let max_x = transform.origin_x + (width as f64 * transform.pixel_width);
        let max_y = transform.origin_y + (height as f64 * transform.pixel_height);

        // If bounds are suspiciously small (like [0,0,1,1]), the GeoTIFF tags are likely missing
        if transform.origin_x.abs() < 10.0 && transform.origin_y.abs() < 10.0 &&
           max_x.abs() < 10.0 && max_y.abs() < 10.0 {
            web_sys::console::warn_1(&format!(
                "⚠️ Warning: DEM bounds look incorrect [{:.1}, {:.1}, {:.1}, {:.1}]\n\
                This usually means the GeoTIFF file is missing geospatial tags.\n\n\
                To fix this:\n\
                1. Look for companion files (.tfw world file, .prj projection file)\n\
                2. Load them together with the .tif file\n\
                3. Or use gdalinfo to check if the file has embedded georeferencing:\n\
                   gdalinfo your_file.tif",
                transform.origin_x, transform.origin_y, max_x, max_y
            ).into());
        }

        // Initialize coordinate transformers based on detected projection
        let (wgs84_proj, dem_proj) = if let Some(ref prj_content) = proj_file_data {
            Self::setup_projection_from_prj(&transform, prj_content)?
        } else {
            Self::setup_projection(&transform)?
        };

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

            // Get elevation value with robust interpolation
            let elevation = self.get_interpolated_value(col, row);

            // Check for nodata
            if elevation.is_nan() || (elevation - self.nodata_value as f32).abs() < 0.01 {
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

    fn get_interpolated_value(&self, col: f64, row: f64) -> f32 {
        // Nearest-neighbor lookup (matches Python rasterio implementation)
        // For high-resolution DEMs with 1-second GPS sampling, taking the exact
        // pixel value is simpler and often better than interpolation
        let col_nearest = col.round() as usize;
        let row_nearest = row.round() as usize;

        // Bounds check
        if col_nearest >= self.width as usize || row_nearest >= self.height as usize {
            return f32::NAN;
        }

        let value = self.get_pixel_value(col_nearest, row_nearest);
        let nodata = self.nodata_value as f32;

        // Return NaN if this is a nodata pixel
        if (value - nodata).abs() < 0.01 {
            f32::NAN
        } else {
            value
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
        decoder: &mut Decoder<Cursor<&[u8]>>,
        filename: Option<&str>,
        width: u32,
        height: u32
    ) -> Result<GeoTransform, JsValue> {
        // First, try to read GeoTIFF tags (ModelPixelScaleTag and ModelTiepointTag)
        if let Some(transform) = Self::parse_geotiff_tags(decoder, width, height) {
            web_sys::console::log_1(&format!(
                "Parsed GeoTIFF tags: origin=({}, {}), pixel_size=({}, {})",
                transform.origin_x, transform.origin_y, transform.pixel_width, transform.pixel_height
            ).into());
            return Ok(transform);
        }

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

    fn parse_geotiff_tags(
        decoder: &mut Decoder<Cursor<&[u8]>>,
        _width: u32,
        _height: u32
    ) -> Option<GeoTransform> {
        // GeoTIFF Tag IDs:
        // 33550 = ModelPixelScaleTag (pixel size in geo units)
        // 33922 = ModelTiepointTag (tie points: pixel -> geo coord mapping)
        // 34264 = ModelTransformationTag (full affine transformation)
        // 34735 = GeoKeyDirectoryTag
        // 34736 = GeoDoubleParamsTag
        // 34737 = GeoAsciiParamsTag

        // Try to read GDAL_METADATA tag (42112) which might contain transformation info
        if let Ok(metadata) = decoder.get_tag_ascii_string(Tag::Unknown(42112)) {
            web_sys::console::log_1(&format!("Found GDAL_METADATA: {}", metadata).into());
        }

        // Try ModelTransformationTag (34264) first - this is a direct affine matrix
        if let Ok(transform_matrix) = decoder.get_tag_f64_vec(Tag::Unknown(34264)) {
            if transform_matrix.len() == 16 {
                web_sys::console::log_1(&format!("Found ModelTransformationTag (34264): {:?}", transform_matrix).into());
                // Transform matrix is in column-major order:
                // [0,4,8,12] = first column (X transformation)
                // [1,5,9,13] = second column (Y transformation)
                // [2,6,10,14] = third column (Z transformation)
                // [3,7,11,15] = fourth column (translation)
                return Some(GeoTransform {
                    origin_x: transform_matrix[3],      // Translation X
                    origin_y: transform_matrix[7],      // Translation Y
                    pixel_width: transform_matrix[0],   // Scale X
                    pixel_height: transform_matrix[5],  // Scale Y (already negative in most cases)
                    rotation_x: transform_matrix[4],    // Rotation X
                    rotation_y: transform_matrix[1],    // Rotation Y
                });
            }
        }

        // Try to read ModelPixelScaleTag (33550) - contains [ScaleX, ScaleY, ScaleZ]
        let pixel_scale = match decoder.get_tag_f64_vec(Tag::Unknown(33550)) {
            Ok(scale) if scale.len() >= 2 => {
                web_sys::console::log_1(&format!("Found ModelPixelScaleTag: {:?}", scale).into());
                scale
            },
            Err(e) => {
                web_sys::console::log_1(&format!("Failed to read ModelPixelScaleTag (33550): {:?}", e).into());
                return None;
            },
            Ok(scale) => {
                web_sys::console::log_1(&format!("ModelPixelScaleTag has insufficient data: len={}", scale.len()).into());
                return None;
            }
        };

        // Try to read ModelTiepointTag (33922) - contains [I, J, K, X, Y, Z, ...]
        // where (I,J,K) is pixel coordinate and (X,Y,Z) is geographic coordinate
        let tiepoints = match decoder.get_tag_f64_vec(Tag::Unknown(33922)) {
            Ok(points) if points.len() >= 6 => {
                web_sys::console::log_1(&format!("Found ModelTiepointTag: {:?}", points).into());
                points
            },
            Err(e) => {
                web_sys::console::log_1(&format!("Failed to read ModelTiepointTag (33922): {:?}", e).into());
                return None;
            },
            Ok(points) => {
                web_sys::console::log_1(&format!("ModelTiepointTag has insufficient data: len={}", points.len()).into());
                return None;
            }
        };

        // Extract pixel coordinates (I, J) and geo coordinates (X, Y)
        let pixel_i = tiepoints[0];
        let pixel_j = tiepoints[1];
        let geo_x = tiepoints[3];
        let geo_y = tiepoints[4];

        // Extract pixel scale
        let scale_x = pixel_scale[0];
        let scale_y = pixel_scale[1];

        // Calculate origin (top-left corner of top-left pixel)
        // For X: origin_x = geo_x - (pixel_i * scale_x)
        //   Moving left (decreasing pixel_i) increases geo_x, so we subtract
        // For Y: origin_y = geo_y + (pixel_j * scale_y)
        //   Moving up (decreasing pixel_j) increases geo_y, so we add
        //   (scale_y is positive, but we'll negate it when storing as pixel_height)
        let origin_x = geo_x - (pixel_i * scale_x);
        let origin_y = geo_y + (pixel_j * scale_y);

        web_sys::console::log_1(&format!(
            "GeoTIFF tags - Tiepoint: pixel({}, {})->geo({}, {}), Scale: ({}, {})",
            pixel_i, pixel_j, geo_x, geo_y, scale_x, scale_y
        ).into());

        Some(GeoTransform {
            origin_x,
            origin_y,
            pixel_width: scale_x,
            pixel_height: -scale_y, // Negative because Y decreases as we go down in raster
            rotation_x: 0.0,
            rotation_y: 0.0,
        })
    }

    fn parse_world_file(world_file_content: &str) -> Result<GeoTransform, JsValue> {
        // World file format (.tfw, .tiff.aux.xml, etc.):
        // Line 1: pixel width (A)
        // Line 2: rotation Y (D)
        // Line 3: rotation X (B)
        // Line 4: pixel height (E) - typically negative
        // Line 5: X coordinate of upper-left corner (C)
        // Line 6: Y coordinate of upper-left corner (F)

        let lines: Vec<&str> = world_file_content.lines().collect();
        if lines.len() < 6 {
            return Err(JsValue::from_str(&format!(
                "⚠️ Invalid World File Format\n\n\
                World files (.tfw, .tifw, .jgw, etc.) must contain exactly 6 lines.\n\
                Found {} lines in the provided world file.\n\n\
                Expected format:\n\
                Line 1: Pixel width (X scale)\n\
                Line 2: Rotation about Y-axis\n\
                Line 3: Rotation about X-axis\n\
                Line 4: Pixel height (Y scale, typically negative)\n\
                Line 5: X coordinate of upper-left corner\n\
                Line 6: Y coordinate of upper-left corner\n\n\
                📚 Learn more: https://en.wikipedia.org/wiki/World_file",
                lines.len()
            )));
        }

        let pixel_width = lines[0].trim().parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse pixel width: {}", e)))?;
        let rotation_y = lines[1].trim().parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse rotation Y: {}", e)))?;
        let rotation_x = lines[2].trim().parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse rotation X: {}", e)))?;
        let pixel_height = lines[3].trim().parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse pixel height: {}", e)))?;
        let origin_x = lines[4].trim().parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse origin X: {}", e)))?;
        let origin_y = lines[5].trim().parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse origin Y: {}", e)))?;

        web_sys::console::log_1(&format!(
            "Parsed world file: origin=({}, {}), pixel_size=({}, {}), rotation=({}, {})",
            origin_x, origin_y, pixel_width, pixel_height, rotation_x, rotation_y
        ).into());

        Ok(GeoTransform {
            origin_x,
            origin_y,
            pixel_width,
            pixel_height,
            rotation_x,
            rotation_y,
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
        // Detect if DEM uses projected coordinates vs geographic (WGS84)
        if transform.origin_x.abs() > 1000.0 || transform.origin_y.abs() > 1000.0 {
            // Projected coordinates detected
            // Try to determine which projection based on coordinate ranges

            let x = transform.origin_x;
            let y = transform.origin_y;

            // UTM zones for North America: X ~200,000-800,000, Y ~0-10,000,000
            // ETRS89LAEA for Europe: X ~2,500,000-7,500,000, Y ~1,300,000-5,500,000

            if x > 2_000_000.0 && x < 8_000_000.0 && y > 1_000_000.0 && y < 6_000_000.0 {
                // Likely European projection (ETRS89LAEA)
                web_sys::console::log_1(&"Detected projected CRS, setting up WGS84→ETRS89LAEA transformation".into());

                let wgs84 = Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs")
                    .map_err(|e| JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e)))?;

                let etrs89laea = Proj::from_proj_string("+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs")
                    .map_err(|e| JsValue::from_str(&format!("Failed to create ETRS89LAEA projection: {:?}", e)))?;

                Ok((Some(wgs84), Some(etrs89laea)))
            } else if x > 100_000.0 && x < 900_000.0 && y > 0.0 && y < 10_000_000.0 {
                // Likely UTM projection (North America)
                // Estimate UTM zone from easting value
                // UTM zones 10-19 cover most of USA
                let zone = Self::estimate_utm_zone_from_coords(x, y);

                web_sys::console::log_1(&format!(
                    "Detected projected CRS (likely UTM Zone {}N), setting up WGS84→UTM transformation",
                    zone
                ).into());

                let wgs84 = Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs")
                    .map_err(|e| JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e)))?;

                // UTM projection with estimated zone
                let utm_proj_string = format!("+proj=utm +zone={} +datum=WGS84 +units=m +no_defs", zone);
                let utm = Proj::from_proj_string(&utm_proj_string)
                    .map_err(|e| JsValue::from_str(&format!("Failed to create UTM projection: {:?}", e)))?;

                Ok((Some(wgs84), Some(utm)))
            } else {
                // Unknown projected CRS - warn user
                web_sys::console::warn_1(&format!(
                    "Unknown projected CRS detected (X={}, Y={}). Elevation lookups may fail.",
                    x, y
                ).into());
                Ok((None, None))
            }
        } else {
            // Geographic coordinates (WGS84)
            web_sys::console::log_1(&"Detected geographic CRS (WGS84), no transformation needed".into());
            Ok((None, None))
        }
    }

    fn estimate_utm_zone_from_coords(easting: f64, northing: f64) -> u8 {
        // Rough estimation of UTM zone based on easting and northing
        // USA is covered by zones 10-19 (west to east)
        // Alabama is in zones 15-16

        // This is a very rough heuristic:
        // - Eastern values (~500k-700k) suggest eastern zones (15-16)
        // - Western values (~200k-400k) suggest western zones (10-13)

        if northing > 3_000_000.0 && northing < 4_000_000.0 {
            // Southern USA (Alabama, Georgia, etc.) - likely zones 15-17
            if easting < 400_000.0 {
                15  // West Alabama, Mississippi
            } else if easting < 550_000.0 {
                16  // East Alabama, Georgia
            } else {
                17  // Far east (Carolinas)
            }
        } else if northing > 4_000_000.0 {
            // Northern USA - zones 11-18
            if easting < 400_000.0 {
                12
            } else if easting < 550_000.0 {
                16
            } else {
                17
            }
        } else {
            // Default to zone 16 (covers most of eastern USA)
            16
        }
    }

    fn setup_projection_from_prj(
        _transform: &GeoTransform,
        prj_content: &str
    ) -> Result<(Option<Proj>, Option<Proj>), JsValue> {
        // Parse .prj file (WKT format) to extract projection information
        // Example: PROJCS["GCS North American 1983 UTM Zone 16N (Calculated)", ...]

        web_sys::console::log_1(&format!("Parsing .prj file: {}", &prj_content[..100.min(prj_content.len())]).into());

        // Check if it's NAD27, NAD83 or WGS84 datum
        let datum = if prj_content.contains("NAD83") || prj_content.contains("North_American_Datum_1983") {
            "NAD83"
        } else if prj_content.contains("NAD27") || prj_content.contains("North_American_1927") {
            "NAD27"
        } else {
            "WGS84"
        };

        // First, try to parse Transverse Mercator parameters directly from PARAMETER fields
        // This handles both custom TM projections and UTM variants with non-standard parameters
        if prj_content.contains("Transverse_Mercator") || prj_content.contains("PROJECTION[\"Transverse_Mercator\"]") {
            if let Some((central_meridian, false_easting, false_northing, scale_factor, latitude_of_origin)) =
                Self::extract_transverse_mercator_params(prj_content) {

                let utm_zone = Self::extract_utm_zone_from_prj(prj_content);
                let proj_type = if utm_zone.is_some() {
                    format!("UTM-like Zone {}", utm_zone.unwrap())
                } else {
                    "Transverse Mercator".to_string()
                };

                web_sys::console::log_1(&format!(
                    "Detected {} projection ({}): central_meridian={}, false_easting={}, false_northing={}, scale_factor={}, lat_0={}",
                    proj_type, datum, central_meridian, false_easting, false_northing, scale_factor, latitude_of_origin
                ).into());

                let wgs84 = Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs")
                    .map_err(|e| JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e)))?;

                // Build Transverse Mercator projection string with actual parameters from .prj
                // NAD83 and WGS84 are nearly identical for most purposes (differ by <2m in CONUS)
                // proj4rs may not support NAD83/NAD27 directly, so we use WGS84 as approximation
                // For high-precision work, proper datum transformation would be needed
                let proj_datum = if datum == "NAD83" || datum == "NAD27" {
                    web_sys::console::log_1(&format!(
                        "Note: Using WGS84 as approximation for {} (difference <2m in CONUS)",
                        datum
                    ).into());
                    "WGS84"
                } else {
                    datum
                };

                let tm_proj_string = format!(
                    "+proj=tmerc +lat_0={} +lon_0={} +k={} +x_0={} +y_0={} +datum={} +units=m +no_defs",
                    latitude_of_origin, central_meridian, scale_factor, false_easting, false_northing, proj_datum
                );

                let tm_proj = Proj::from_proj_string(&tm_proj_string)
                    .map_err(|e| JsValue::from_str(&format!("Failed to create TM projection: {:?}", e)))?;

                web_sys::console::log_1(&format!(
                    "Created projections - WGS84: '+proj=longlat +datum=WGS84', TM: '{}'",
                    tm_proj_string
                ).into());

                return Ok((Some(wgs84), Some(tm_proj)));
            }
        }

        // Fallback: Try to extract standard UTM zone if TM parameters weren't found
        let utm_zone = Self::extract_utm_zone_from_prj(prj_content);

        if let Some(zone) = utm_zone {
            web_sys::console::log_1(&format!(
                "Detected standard UTM Zone {} ({}) from .prj file, setting up WGS84→UTM transformation",
                zone, datum
            ).into());

            let wgs84 = Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs")
                .map_err(|e| JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e)))?;

            // Standard UTM projection - use WGS84 approximation for NAD83/NAD27
            let proj_datum = if datum == "NAD83" || datum == "NAD27" {
                web_sys::console::log_1(&format!(
                    "Note: Using WGS84 as approximation for {} (difference <2m in CONUS)",
                    datum
                ).into());
                "WGS84"
            } else {
                datum
            };

            let utm_proj_string = format!("+proj=utm +zone={} +datum={} +units=m +no_defs", zone, proj_datum);
            let utm = Proj::from_proj_string(&utm_proj_string)
                .map_err(|e| JsValue::from_str(&format!("Failed to create UTM projection: {:?}", e)))?;

            web_sys::console::log_1(&format!(
                "Created projections - WGS84: '+proj=longlat +datum=WGS84', Projected: '{}'",
                utm_proj_string
            ).into());

            Ok((Some(wgs84), Some(utm)))
        } else {
            // Couldn't parse projection, fallback to geographic
            web_sys::console::warn_1(&"Could not parse projection from .prj file, assuming geographic coordinates".into());
            Ok((None, None))
        }
    }

    fn extract_utm_zone_from_prj(prj_content: &str) -> Option<u8> {
        // Look for "UTM Zone XX" pattern in the projection string
        let upper = prj_content.to_uppercase();

        // Try to find "UTM ZONE 16" or "UTM_ZONE_16" patterns
        if let Some(idx) = upper.find("UTM") {
            let after_utm = &upper[idx..];

            // Look for "ZONE" followed by a number
            if let Some(zone_idx) = after_utm.find("ZONE") {
                let after_zone = &after_utm[zone_idx + 4..];

                // Extract the number after "ZONE"
                let zone_str: String = after_zone
                    .chars()
                    .skip_while(|c| !c.is_numeric())
                    .take_while(|c| c.is_numeric())
                    .collect();

                if let Ok(zone) = zone_str.parse::<u8>() {
                    if zone >= 1 && zone <= 60 {
                        web_sys::console::log_1(&format!(
                            "Extracted UTM zone {} from .prj file",
                            zone
                        ).into());
                        return Some(zone);
                    }
                }
            }
        }

        // Fallback: If we see Transverse_Mercator with UTM-like parameters,
        // try to calculate zone from central_meridian
        if prj_content.contains("Transverse_Mercator") {
            if let Some((central_meridian, false_easting, _false_northing, scale_factor, _latitude_of_origin)) =
                Self::extract_transverse_mercator_params(prj_content) {

                // Check if this looks like UTM (false_easting=500000, scale_factor=0.9996)
                if (false_easting - 500000.0).abs() < 1.0 && (scale_factor - 0.9996).abs() < 0.0001 {
                    // Calculate UTM zone from central meridian
                    // UTM zones: Zone 1 = -177°, Zone 2 = -171°, ..., Zone 31 = 3°, etc.
                    // Formula: zone = floor((lon + 180) / 6) + 1
                    let zone = ((central_meridian + 180.0) / 6.0).floor() as i32 + 1;

                    if zone >= 1 && zone <= 60 {
                        web_sys::console::log_1(&format!(
                            "Detected UTM zone {} from central_meridian {} (false_easting={}, scale_factor={})",
                            zone, central_meridian, false_easting, scale_factor
                        ).into());
                        return Some(zone as u8);
                    }
                }
            }
        }

        None
    }

    fn extract_transverse_mercator_params(prj_content: &str) -> Option<(f64, f64, f64, f64, f64)> {
        // Parse Transverse Mercator parameters from WKT format
        // Returns: (central_meridian, false_easting, false_northing, scale_factor, latitude_of_origin)

        // Helper function to extract a parameter value (case-insensitive)
        fn extract_parameter(content: &str, param_name: &str) -> Option<f64> {
            // Convert both to uppercase for case-insensitive matching
            let upper_content = content.to_uppercase();
            let upper_param = param_name.to_uppercase();

            // Look for PARAMETER["param_name",value] - case insensitive
            let search_pattern = format!("PARAMETER[\"{}\"", upper_param);

            if let Some(idx) = upper_content.find(&search_pattern) {
                // Get the corresponding position in the original content
                let after_param = &content[idx..];

                // Find the opening quote and comma
                if let Some(quote_idx) = after_param.find('"') {
                    let after_quote = &after_param[quote_idx + 1..];
                    if let Some(comma_idx) = after_quote.find(',') {
                        let after_comma = &after_quote[comma_idx + 1..];

                        // Extract the number (may be negative, may have decimals, scientific notation)
                        let number_str: String = after_comma
                            .chars()
                            .take_while(|c| c.is_numeric() || *c == '-' || *c == '.' || *c == 'e' || *c == 'E' || *c == '+')
                            .collect();

                        if let Ok(value) = number_str.trim().parse::<f64>() {
                            return Some(value);
                        }
                    }
                }
            }

            None
        }

        // Extract all required parameters
        let central_meridian = extract_parameter(prj_content, "central_meridian")?;
        let false_easting = extract_parameter(prj_content, "false_easting").unwrap_or(0.0);
        let false_northing = extract_parameter(prj_content, "false_northing").unwrap_or(0.0);
        let scale_factor = extract_parameter(prj_content, "scale_factor").unwrap_or(1.0);
        let latitude_of_origin = extract_parameter(prj_content, "latitude_of_origin").unwrap_or(0.0);

        Some((central_meridian, false_easting, false_northing, scale_factor, latitude_of_origin))
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
