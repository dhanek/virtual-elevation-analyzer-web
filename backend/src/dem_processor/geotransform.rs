use super::*;

impl DEMProcessor {
    /// Fallback geotransform parsing when GeoTIFF tags are not available.
    /// Tries filename-based detection and generic defaults.
    pub(super) fn parse_geotransform_fallback(
        _decoder: &mut Decoder<Cursor<&[u8]>>,
        filename: Option<&str>,
        width: u32,
        height: u32,
    ) -> Result<GeoTransform, JsValue> {
        if let Some(fname) = filename {
            if let Some(transform) = Self::parse_srtm_filename(fname, width, height) {
                web_sys::console::log_1(
                    &format!(
                        "Parsed SRTM filename: origin=({}, {}), pixel_size=({}, {})",
                        transform.origin_x,
                        transform.origin_y,
                        transform.pixel_width,
                        transform.pixel_height
                    )
                    .into(),
                );
                return Ok(transform);
            }

            if let Some(transform) = Self::parse_usgs_one_meter_filename(fname, width, height) {
                web_sys::console::log_1(
                    &format!(
                        "Parsed USGS 1-meter filename: origin=({}, {}), pixel_size=({}, {})",
                        transform.origin_x,
                        transform.origin_y,
                        transform.pixel_width,
                        transform.pixel_height
                    )
                    .into(),
                );
                return Ok(transform);
            }
        }

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
            epsg_code: None,
        })
    }

    pub(super) fn parse_geotiff_tags(
        decoder: &mut Decoder<Cursor<&[u8]>>,
        _width: u32,
        _height: u32,
    ) -> Option<GeoTransform> {
        if let Ok(metadata) = decoder.get_tag_ascii_string(Tag::Unknown(42112)) {
            web_sys::console::log_1(&format!("Found GDAL_METADATA: {}", metadata).into());
        }

        let mut epsg_code: Option<u16> = None;
        let mut raster_type: u16 = 1;
        match decoder.get_tag_u16_vec(Tag::GeoKeyDirectoryTag) {
            Ok(geokeys) => {
                web_sys::console::log_1(
                    &format!(
                        "Found GeoKeyDirectoryTag (34735): {} entries",
                        geokeys.len() / 4
                    )
                    .into(),
                );
                for i in (0..geokeys.len()).step_by(4) {
                    if i + 3 >= geokeys.len() {
                        continue;
                    }

                    let key_id = geokeys[i];
                    let value = geokeys[i + 3];
                    match key_id {
                        1024 => web_sys::console::log_1(
                            &format!("  GTModelTypeGeoKey: {}", value).into(),
                        ),
                        1025 => {
                            web_sys::console::log_1(
                                &format!(
                                    "  GTRasterTypeGeoKey: {} ({})",
                                    value,
                                    if value == 1 {
                                        "PixelIsArea"
                                    } else if value == 2 {
                                        "PixelIsPoint"
                                    } else {
                                        "Unknown"
                                    }
                                )
                                .into(),
                            );
                            raster_type = value;
                        }
                        2048 => {
                            web_sys::console::log_1(
                                &format!("  GeographicTypeGeoKey: {}", value).into(),
                            );
                            if epsg_code.is_none() {
                                epsg_code = Some(value);
                            }
                        }
                        3072 => {
                            web_sys::console::log_1(
                                &format!("  ProjectedCSTypeGeoKey: {}", value).into(),
                            );
                            epsg_code = Some(value);
                        }
                        3076 => web_sys::console::log_1(
                            &format!("  ProjLinearUnitsGeoKey: {}", value).into(),
                        ),
                        _ => {}
                    }
                }
            }
            Err(e) => {
                web_sys::console::log_1(&format!("No GeoKeyDirectoryTag (34735): {:?}", e).into());
            }
        }

        if let Ok(params) = decoder.get_tag_f64_vec(Tag::GeoDoubleParamsTag) {
            web_sys::console::log_1(&format!("Found GeoDoubleParamsTag: {:?}", params).into());
        }

        if let Ok(params) = decoder.get_tag_ascii_string(Tag::GeoAsciiParamsTag) {
            web_sys::console::log_1(&format!("Found GeoAsciiParamsTag: {}", params).into());
        }

        match decoder.get_tag_f64_vec(Tag::ModelTransformationTag) {
            Ok(transform_matrix) => {
                if transform_matrix.len() == 16 {
                    web_sys::console::log_1(
                        &format!(
                            "Found ModelTransformationTag (34264): {:?}",
                            transform_matrix
                        )
                        .into(),
                    );
                    return Some(GeoTransform {
                        origin_x: transform_matrix[3],
                        origin_y: transform_matrix[7],
                        pixel_width: transform_matrix[0],
                        pixel_height: transform_matrix[5],
                        rotation_x: transform_matrix[4],
                        rotation_y: transform_matrix[1],
                        epsg_code,
                    });
                }
                web_sys::console::log_1(
                    &format!(
                        "ModelTransformationTag has wrong length: {} (expected 16)",
                        transform_matrix.len()
                    )
                    .into(),
                );
            }
            Err(e) => {
                web_sys::console::log_1(&format!("No ModelTransformationTag: {:?}", e).into());
            }
        }

        let pixel_scale = match decoder.get_tag_f64_vec(Tag::ModelPixelScaleTag) {
            Ok(scale) if scale.len() >= 2 => {
                web_sys::console::log_1(&format!("Found ModelPixelScaleTag: {:?}", scale).into());
                scale
            }
            Err(e) => {
                web_sys::console::log_1(
                    &format!("Failed to read ModelPixelScaleTag: {:?}", e).into(),
                );
                return None;
            }
            Ok(scale) => {
                web_sys::console::log_1(
                    &format!(
                        "ModelPixelScaleTag has insufficient data: len={}",
                        scale.len()
                    )
                    .into(),
                );
                return None;
            }
        };

        let tiepoints = match decoder.get_tag_f64_vec(Tag::ModelTiepointTag) {
            Ok(points) if points.len() >= 6 => {
                web_sys::console::log_1(&format!("Found ModelTiepointTag: {:?}", points).into());
                points
            }
            Err(e) => {
                web_sys::console::log_1(
                    &format!("Failed to read ModelTiepointTag: {:?}", e).into(),
                );
                return None;
            }
            Ok(points) => {
                web_sys::console::log_1(
                    &format!(
                        "ModelTiepointTag has insufficient data: len={}",
                        points.len()
                    )
                    .into(),
                );
                return None;
            }
        };

        let pixel_i = tiepoints[0];
        let pixel_j = tiepoints[1];
        let geo_x = tiepoints[3];
        let geo_y = tiepoints[4];
        let scale_x = pixel_scale[0];
        let scale_y = pixel_scale[1];

        let (origin_x, origin_y) = if raster_type == 2 {
            web_sys::console::log_1(&"GeoTIFF: PixelIsPoint — tiepoint is pixel center".into());
            (geo_x - (pixel_i * scale_x), geo_y + (pixel_j * scale_y))
        } else {
            web_sys::console::log_1(
                &"GeoTIFF: PixelIsArea — tiepoint is pixel corner, adjusting to center".into(),
            );
            (
                geo_x - (pixel_i * scale_x) + scale_x * 0.5,
                geo_y + (pixel_j * scale_y) - scale_y * 0.5,
            )
        };

        web_sys::console::log_1(
            &format!(
                "GeoTIFF tags - Tiepoint: pixel({}, {})->geo({}, {}), Scale: ({}, {}), Origin (center of UL pixel): ({}, {})",
                pixel_i, pixel_j, geo_x, geo_y, scale_x, scale_y, origin_x, origin_y
            )
            .into(),
        );

        Some(GeoTransform {
            origin_x,
            origin_y,
            pixel_width: scale_x,
            pixel_height: -scale_y,
            rotation_x: 0.0,
            rotation_y: 0.0,
            epsg_code,
        })
    }

    pub(super) fn parse_world_file(world_file_content: &str) -> Result<GeoTransform, JsValue> {
        let lines: Vec<&str> = world_file_content.lines().collect();
        if lines.len() < 6 {
            return Err(JsValue::from_str(&format!(
                "Invalid World File Format\n\n\
                World files (.tfw, .tifw, .jgw, etc.) must contain exactly 6 lines.\n\
                Found {} lines in the provided world file.\n\n\
                Expected format:\n\
                Line 1: Pixel width (X scale)\n\
                Line 2: Rotation about Y-axis\n\
                Line 3: Rotation about X-axis\n\
                Line 4: Pixel height (Y scale, typically negative)\n\
                Line 5: X coordinate of upper-left corner\n\
                Line 6: Y coordinate of upper-left corner\n\n\
                Learn more: https://en.wikipedia.org/wiki/World_file",
                lines.len()
            )));
        }

        let pixel_width = lines[0]
            .trim()
            .parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse pixel width: {}", e)))?;
        let rotation_y = lines[1]
            .trim()
            .parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse rotation Y: {}", e)))?;
        let rotation_x = lines[2]
            .trim()
            .parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse rotation X: {}", e)))?;
        let pixel_height = lines[3]
            .trim()
            .parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse pixel height: {}", e)))?;
        let origin_x = lines[4]
            .trim()
            .parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse origin X: {}", e)))?;
        let origin_y = lines[5]
            .trim()
            .parse::<f64>()
            .map_err(|e| JsValue::from_str(&format!("Failed to parse origin Y: {}", e)))?;

        web_sys::console::log_1(
            &format!(
                "Parsed world file: origin=({}, {}), pixel_size=({}, {}), rotation=({}, {})",
                origin_x, origin_y, pixel_width, pixel_height, rotation_x, rotation_y
            )
            .into(),
        );

        Ok(GeoTransform {
            origin_x,
            origin_y,
            pixel_width,
            pixel_height,
            rotation_x,
            rotation_y,
            epsg_code: None,
        })
    }

    pub(super) fn parse_srtm_filename(
        filename: &str,
        width: u32,
        height: u32,
    ) -> Option<GeoTransform> {
        let upper = filename.to_uppercase();
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
            let lat = Self::parse_coord(lat_str)?;
            let lon = Self::parse_coord(lon_str)?;

            if lat.abs() > 180.0 || lon.abs() > 180.0 {
                let northing = lat * 10000.0;
                let easting = lon * 10000.0;
                let tile_size_m = 50000.0;
                let pixel_size = tile_size_m / width as f64;

                web_sys::console::log_1(
                    &format!(
                        "Projected coordinates: northing={}, easting={}, pixel={}m",
                        northing, easting, pixel_size
                    )
                    .into(),
                );

                return Some(GeoTransform {
                    origin_x: easting,
                    origin_y: northing + tile_size_m,
                    pixel_width: pixel_size,
                    pixel_height: -pixel_size,
                    rotation_x: 0.0,
                    rotation_y: 0.0,
                    epsg_code: None,
                });
            }

            let pixel_width = 1.0 / width as f64;
            let pixel_height = -1.0 / height as f64;
            return Some(GeoTransform {
                origin_x: lon,
                origin_y: lat + 1.0,
                pixel_width,
                pixel_height,
                rotation_x: 0.0,
                rotation_y: 0.0,
                epsg_code: None,
            });
        }

        None
    }

    pub(super) fn parse_coord(s: &str) -> Option<f64> {
        if s.is_empty() {
            return None;
        }

        let dir = s.chars().next()?;
        let num_str = &s[1..].split(|c: char| !c.is_numeric()).next()?;
        let num: f64 = num_str.parse().ok()?;

        match dir {
            'N' | 'E' => Some(num),
            'S' | 'W' => Some(-num),
            _ => None,
        }
    }

    pub(super) fn parse_usgs_one_meter_filename(
        filename: &str,
        width: u32,
        height: u32,
    ) -> Option<GeoTransform> {
        let upper = filename.to_uppercase();
        if !upper.contains("USGS") || !upper.contains("ONE_METER") {
            return None;
        }

        let mut x_value: Option<i32> = None;
        let mut y_value: Option<i32> = None;
        let chars: Vec<char> = upper.chars().collect();

        for i in 0..chars.len() {
            if chars[i] == 'X' && x_value.is_none() {
                let mut num_str = String::new();
                for ch in chars.iter().skip(i + 1) {
                    if ch.is_ascii_digit() {
                        num_str.push(*ch);
                    } else {
                        break;
                    }
                }
                if !num_str.is_empty() {
                    x_value = num_str.parse().ok();
                }
            } else if chars[i] == 'Y' && y_value.is_none() {
                let mut num_str = String::new();
                for ch in chars.iter().skip(i + 1) {
                    if ch.is_ascii_digit() {
                        num_str.push(*ch);
                    } else {
                        break;
                    }
                }
                if !num_str.is_empty() {
                    y_value = num_str.parse().ok();
                }
            }
        }

        let x_tile = x_value?;
        let y_tile = y_value?;
        web_sys::console::log_1(
            &format!("USGS 1-meter DEM tile indices: x={}, y={}", x_tile, y_tile).into(),
        );

        let tile_size_m = 10000.0;
        let pixel_size = tile_size_m / width as f64;
        let origin_x = (x_tile as f64) * tile_size_m;
        let origin_y = (y_tile as f64) * tile_size_m + (height as f64) * pixel_size;

        web_sys::console::log_1(
            &format!(
                "USGS 1-meter: UTM origin=({}, {}), pixel_size={}m, tile {}x{} pixels",
                origin_x, origin_y, pixel_size, width, height
            )
            .into(),
        );

        Some(GeoTransform {
            origin_x,
            origin_y,
            pixel_width: pixel_size,
            pixel_height: -pixel_size,
            rotation_x: 0.0,
            rotation_y: 0.0,
            epsg_code: None,
        })
    }

    pub(super) fn parse_nodata(decoder: &mut Decoder<Cursor<&[u8]>>) -> Option<f64> {
        match decoder.get_tag_ascii_string(Tag::GdalNodata) {
            Ok(s) => {
                let trimmed = s.trim().trim_end_matches('\0');
                match trimmed.parse::<f64>() {
                    Ok(val) => {
                        web_sys::console::log_1(&format!("GDAL_NODATA tag found: {}", val).into());
                        Some(val)
                    }
                    Err(_) => {
                        web_sys::console::log_1(
                            &format!("GDAL_NODATA tag unparseable: '{}'", trimmed).into(),
                        );
                        None
                    }
                }
            }
            Err(_) => None,
        }
    }
}
