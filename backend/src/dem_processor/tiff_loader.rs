use wasm_bindgen::prelude::*;

use super::*;

#[wasm_bindgen]
impl DEMProcessor {
    /// Create a new DEMProcessor from GeoTIFF file bytes.
    #[wasm_bindgen(constructor)]
    pub fn new(file_data: &[u8], filename: Option<String>) -> Result<DEMProcessor, JsValue> {
        Self::new_with_world_file(file_data, filename, None, None)
    }

    /// Create a new DEMProcessor from TIFF file bytes with optional world file and projection file.
    #[wasm_bindgen]
    pub fn new_with_world_file(
        file_data: &[u8],
        filename: Option<String>,
        world_file_data: Option<String>,
        proj_file_data: Option<String>,
    ) -> Result<DEMProcessor, JsValue> {
        let mut limits = Limits::default();
        limits.decoding_buffer_size = 2_000_000_000;
        limits.ifd_value_size = 500_000_000;
        limits.intermediate_buffer_size = 500_000_000;

        let cursor = Cursor::new(file_data);
        let mut decoder = Decoder::new(cursor)
            .map_err(|e| {
                let error_msg = format!("{}", e);
                JsValue::from_str(&format!(
                    "Failed to Read DEM File\n\n\
                    The file does not appear to be a valid TIFF/GeoTIFF format.\n\n\
                    Supported formats:\n\
                    - GeoTIFF (.tif, .tiff)\n\
                    - Uncompressed or LZW/Deflate compression\n\
                    - With optional .tfw (world file) and .prj (projection file)\n\n\
                    If you have a different format:\n\
                    - HFA (.img) files: Convert with GDAL\n\
                    - ASCII Grid (.asc): Convert with GDAL\n\
                    - HGT (SRTM): Convert with GDAL\n\n\
                    Conversion command:\n\
                    gdal_translate -of GTiff input.img output.tif\n\n\
                    Technical error: {}",
                    error_msg
                ))
            })?
            .with_limits(limits);

        let (width, height) = decoder
            .dimensions()
            .map_err(|e| JsValue::from_str(&format!("Failed to get image dimensions: {}", e)))?;

        let transform = {
            let geotiff_transform = Self::parse_geotiff_tags(&mut decoder, width, height);

            let geotiff_bounds_valid = geotiff_transform.as_ref().map_or(false, |gt| {
                let max_x = gt.origin_x + (width as f64 * gt.pixel_width);
                let max_y = gt.origin_y + (height as f64 * gt.pixel_height);
                !(gt.origin_x.abs() < 1.0
                    && gt.origin_y.abs() < 1.0
                    && max_x.abs() < 2.0
                    && max_y.abs() < 2.0)
            });

            if let Some(ref gt) = geotiff_transform {
                if geotiff_bounds_valid {
                    web_sys::console::log_1(
                        &format!(
                            "Using embedded GeoTIFF tags: origin=({}, {}), pixel_size=({}, {}), epsg={:?}",
                            gt.origin_x, gt.origin_y, gt.pixel_width, gt.pixel_height, gt.epsg_code
                        )
                        .into(),
                    );
                } else {
                    web_sys::console::warn_1(
                        &"GeoTIFF tags found but bounds look invalid, will try fallback".into(),
                    );
                }
            }

            match (geotiff_transform, geotiff_bounds_valid, &world_file_data) {
                (Some(gt), true, _) => gt,
                (_, _, Some(wf)) => {
                    web_sys::console::log_1(
                        &"Falling back to world file for georeferencing".into(),
                    );
                    Self::parse_world_file(wf)?
                }
                (Some(gt), false, None) => gt,
                (None, _, None) => Self::parse_geotransform_fallback(
                    &mut decoder,
                    filename.as_deref(),
                    width,
                    height,
                )?,
            }
        };

        let explicit_nodata = Self::parse_nodata(&mut decoder);

        let image_data = decoder.read_image().map_err(|e| {
            let error_msg = format!("{}", e);

            if error_msg.contains("Compression method Unknown") || error_msg.contains("unsupported")
            {
                let compression_info = if let Some(start) = error_msg.find("Unknown(") {
                    if let Some(end) = error_msg[start..].find(')') {
                        let code = &error_msg[start + 8..start + end];
                        match code {
                            "50000" => " (LERC compression)",
                            "34712" => " (JPEG2000 compression)",
                            "50001" => " (WEBP compression)",
                            _ => "",
                        }
                    } else {
                        ""
                    }
                } else {
                    ""
                };

                JsValue::from_str(&format!(
                    "Unsupported TIFF Compression Format{}\n\n\
                    This DEM file uses a compression method not supported by the web browser.\n\n\
                    SOLUTION OPTIONS:\n\n\
                    1. Convert using GDAL (Recommended):\n\
                       gdal_translate -co COMPRESS=NONE input.tif output.tif\n\n\
                    2. Convert using QGIS (GUI option):\n\
                       - Install QGIS (free): https://qgis.org/download/\n\
                       - Right-click layer → Export → Save As → Set 'Compression: None'\n\n\
                    3. Install GDAL command-line:\n\
                       - macOS: brew install gdal\n\
                       - Windows: https://gdal.org/download.html#windows\n\
                       - Linux: sudo apt install gdal-bin\n\n\
                    Need help? See GDAL documentation:\n\
                    https://gdal.org/programs/gdal_translate.html\n\n\
                    Technical details: {}",
                    compression_info, error_msg
                ))
            } else {
                JsValue::from_str(&format!("Failed to read image: {}", error_msg))
            }
        })?;

        let is_u8 = matches!(&image_data, DecodingResult::U8(_));
        let data_type_name = match &image_data {
            DecodingResult::U8(_) => "U8 (8-bit unsigned)",
            DecodingResult::U16(_) => "U16 (16-bit unsigned)",
            DecodingResult::U32(_) => "U32 (32-bit unsigned)",
            DecodingResult::U64(_) => "U64 (64-bit unsigned)",
            DecodingResult::I8(_) => "I8 (8-bit signed)",
            DecodingResult::I16(_) => "I16 (16-bit signed)",
            DecodingResult::I32(_) => "I32 (32-bit signed)",
            DecodingResult::I64(_) => "I64 (64-bit signed)",
            DecodingResult::F16(_) => "F16 (16-bit float)",
            DecodingResult::F32(_) => "F32 (32-bit float)",
            DecodingResult::F64(_) => "F64 (64-bit float)",
        };
        web_sys::console::log_1(&format!("TIFF data type: {}", data_type_name).into());

        let nodata_value = match explicit_nodata {
            Some(v) => v,
            None => {
                let default = match &image_data {
                    DecodingResult::I16(_) => -32768.0,
                    DecodingResult::I32(_) => -2147483648.0,
                    _ => -9999.0,
                };
                web_sys::console::log_1(
                    &format!("No GDAL_NODATA tag, using type-based default: {}", default).into(),
                );
                default
            }
        };

        if is_u8 {
            web_sys::console::warn_1(
                &"Warning: U8 DEM detected (8-bit, 0-255 range). This is a low-quality format with limited elevation range."
                    .into(),
            );
        }

        let data = Self::convert_to_f32(image_data)?;

        if world_file_data.is_some() && proj_file_data.is_none() {
            web_sys::console::warn_1(
                &"World file loaded without projection file (.prj). Coordinate system is ambiguous. Assuming coordinates are in the projection detected from world file values, or WGS84 if geographic."
                    .into(),
            );
        }

        let max_x = transform.origin_x + (width as f64 * transform.pixel_width);
        let max_y = transform.origin_y + (height as f64 * transform.pixel_height);

        if transform.origin_x.abs() < 10.0
            && transform.origin_y.abs() < 10.0
            && max_x.abs() < 10.0
            && max_y.abs() < 10.0
        {
            web_sys::console::warn_1(
                &format!(
                    "Warning: DEM bounds look incorrect [{:.1}, {:.1}, {:.1}, {:.1}]\n\
                    This usually means the GeoTIFF file is missing geospatial tags.\n\n\
                    To fix this:\n\
                    1. Look for companion files (.tfw world file, .prj projection file)\n\
                    2. Load them together with the .tif file\n\
                    3. Or use gdalinfo to check if the file has embedded georeferencing:\n\
                       gdalinfo your_file.tif",
                    transform.origin_x, transform.origin_y, max_x, max_y
                )
                .into(),
            );
        }

        let (wgs84_proj, dem_proj) = if transform.epsg_code.is_some() {
            Self::setup_projection(&transform)?
        } else if let Some(ref prj_content) = proj_file_data {
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
            logged_first_lookup: false,
        })
    }
}

impl DEMProcessor {
    fn convert_to_f32(data: DecodingResult) -> Result<Vec<f32>, JsValue> {
        match data {
            DecodingResult::U8(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::U16(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::U32(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::U64(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::I8(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::I16(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::I32(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::I64(values) => Ok(values.iter().map(|&v| v as f32).collect()),
            DecodingResult::F16(values) => Ok(values.iter().map(|v| v.to_f32()).collect()),
            DecodingResult::F32(values) => Ok(values),
            DecodingResult::F64(values) => Ok(values.iter().map(|&v| v as f32).collect()),
        }
    }
}
