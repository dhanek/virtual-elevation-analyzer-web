use super::*;

impl DEMProcessor {
    pub(super) fn setup_projection(
        transform: &GeoTransform,
    ) -> Result<(Option<Proj>, Option<Proj>), JsValue> {
        if let Some(epsg) = transform.epsg_code {
            match epsg {
                4326 => {
                    web_sys::console::log_1(
                        &"EPSG:4326 (WGS84 geographic), no transformation needed".into(),
                    );
                    return Ok((None, None));
                }
                3857 => {
                    web_sys::console::log_1(
                        &"EPSG:3857 (Web Mercator) detected, setting up WGS84→Web Mercator transformation".into(),
                    );
                    let wgs84 = Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs")
                        .map_err(|e| {
                            JsValue::from_str(&format!(
                                "Failed to create WGS84 projection: {:?}",
                                e
                            ))
                        })?;
                    let web_mercator = Proj::from_proj_string(
                        "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs",
                    )
                    .map_err(|e| {
                        JsValue::from_str(&format!("Failed to create Web Mercator projection: {:?}", e))
                    })?;
                    return Ok((Some(wgs84), Some(web_mercator)));
                }
                code if (32601..=32660).contains(&code) => {
                    let zone = code - 32600;
                    web_sys::console::log_1(
                        &format!("EPSG:{} (UTM Zone {}N) detected", code, zone).into(),
                    );
                    let wgs84 = Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs")
                        .map_err(|e| {
                            JsValue::from_str(&format!(
                                "Failed to create WGS84 projection: {:?}",
                                e
                            ))
                        })?;
                    let utm = Proj::from_proj_string(&format!(
                        "+proj=utm +zone={} +datum=WGS84 +units=m +no_defs",
                        zone
                    ))
                    .map_err(|e| {
                        JsValue::from_str(&format!("Failed to create UTM projection: {:?}", e))
                    })?;
                    return Ok((Some(wgs84), Some(utm)));
                }
                code if (32701..=32760).contains(&code) => {
                    let zone = code - 32700;
                    web_sys::console::log_1(
                        &format!("EPSG:{} (UTM Zone {}S) detected", code, zone).into(),
                    );
                    let wgs84 = Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs")
                        .map_err(|e| {
                            JsValue::from_str(&format!(
                                "Failed to create WGS84 projection: {:?}",
                                e
                            ))
                        })?;
                    let utm = Proj::from_proj_string(&format!(
                        "+proj=utm +zone={} +south +datum=WGS84 +units=m +no_defs",
                        zone
                    ))
                    .map_err(|e| {
                        JsValue::from_str(&format!("Failed to create UTM projection: {:?}", e))
                    })?;
                    return Ok((Some(wgs84), Some(utm)));
                }
                _ => {
                    web_sys::console::log_1(
                        &format!(
                            "EPSG:{} detected but no built-in handler, falling back to coordinate heuristics",
                            epsg
                        )
                        .into(),
                    );
                }
            }
        }

        if transform.origin_x.abs() > 1000.0 || transform.origin_y.abs() > 1000.0 {
            let x = transform.origin_x;
            let y = transform.origin_y;

            if x.abs() > 10_000_000.0 || y.abs() > 10_000_000.0 {
                web_sys::console::log_1(
                    &"Detected large projected coordinates (likely EPSG:3857 Web Mercator), setting up transformation".into(),
                );
                let wgs84 =
                    Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs").map_err(|e| {
                        JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e))
                    })?;
                let web_mercator = Proj::from_proj_string(
                    "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs",
                )
                .map_err(|e| {
                    JsValue::from_str(&format!("Failed to create Web Mercator projection: {:?}", e))
                })?;
                Ok((Some(wgs84), Some(web_mercator)))
            } else if x > 2_000_000.0 && x < 8_000_000.0 && y > 1_000_000.0 && y < 6_000_000.0 {
                web_sys::console::log_1(
                    &"Detected projected CRS, setting up WGS84→ETRS89LAEA transformation".into(),
                );

                let wgs84 =
                    Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs").map_err(|e| {
                        JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e))
                    })?;
                let etrs89laea = Proj::from_proj_string(
                    "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs",
                )
                .map_err(|e| {
                    JsValue::from_str(&format!("Failed to create ETRS89LAEA projection: {:?}", e))
                })?;
                Ok((Some(wgs84), Some(etrs89laea)))
            } else if x > 100_000.0 && x < 900_000.0 && y > 0.0 && y < 10_000_000.0 {
                let zone = Self::estimate_utm_zone_from_coords(x, y);
                web_sys::console::log_1(
                    &format!(
                        "Detected projected CRS (likely UTM Zone {}N), setting up WGS84→UTM transformation",
                        zone
                    )
                    .into(),
                );

                let wgs84 =
                    Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs").map_err(|e| {
                        JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e))
                    })?;
                let utm_proj_string =
                    format!("+proj=utm +zone={} +datum=WGS84 +units=m +no_defs", zone);
                let utm = Proj::from_proj_string(&utm_proj_string).map_err(|e| {
                    JsValue::from_str(&format!("Failed to create UTM projection: {:?}", e))
                })?;
                Ok((Some(wgs84), Some(utm)))
            } else {
                web_sys::console::warn_1(
                    &format!(
                        "Unknown projected CRS detected (X={}, Y={}). Elevation lookups may fail.",
                        x, y
                    )
                    .into(),
                );
                Ok((None, None))
            }
        } else {
            web_sys::console::log_1(
                &"Detected geographic CRS (WGS84), no transformation needed".into(),
            );
            Ok((None, None))
        }
    }

    pub(super) fn estimate_utm_zone_from_coords(easting: f64, northing: f64) -> u8 {
        if northing > 3_000_000.0 && northing < 4_000_000.0 {
            if easting < 400_000.0 {
                15
            } else if easting < 550_000.0 {
                16
            } else {
                17
            }
        } else if northing > 4_000_000.0 {
            if easting < 400_000.0 {
                12
            } else if easting < 550_000.0 {
                16
            } else {
                17
            }
        } else {
            16
        }
    }

    pub(super) fn setup_projection_from_prj(
        _transform: &GeoTransform,
        prj_content: &str,
    ) -> Result<(Option<Proj>, Option<Proj>), JsValue> {
        web_sys::console::log_1(
            &format!(
                "Parsing .prj file: {}",
                &prj_content[..100.min(prj_content.len())]
            )
            .into(),
        );

        let datum =
            if prj_content.contains("NAD83") || prj_content.contains("North_American_Datum_1983") {
                "NAD83"
            } else if prj_content.contains("NAD27") || prj_content.contains("North_American_1927") {
                "NAD27"
            } else {
                "WGS84"
            };

        if prj_content.contains("Mercator") && !prj_content.contains("Transverse_Mercator") {
            web_sys::console::log_1(
                &"Detected Mercator projection from .prj file, setting up WGS84→Web Mercator transformation"
                    .into(),
            );

            let wgs84 =
                Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs").map_err(|e| {
                    JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e))
                })?;
            let web_mercator = Proj::from_proj_string(
                "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs",
            )
            .map_err(|e| {
                JsValue::from_str(&format!("Failed to create Web Mercator projection: {:?}", e))
            })?;

            return Ok((Some(wgs84), Some(web_mercator)));
        }

        if prj_content.contains("Transverse_Mercator")
            || prj_content.contains("PROJECTION[\"Transverse_Mercator\"]")
        {
            if let Some((
                central_meridian,
                false_easting,
                false_northing,
                scale_factor,
                latitude_of_origin,
            )) = Self::extract_transverse_mercator_params(prj_content)
            {
                let utm_zone = Self::extract_utm_zone_from_prj(prj_content);
                let proj_type = if let Some(zone) = utm_zone {
                    format!("UTM-like Zone {}", zone)
                } else {
                    "Transverse Mercator".to_string()
                };

                web_sys::console::log_1(
                    &format!(
                        "Detected {} projection ({}): central_meridian={}, false_easting={}, false_northing={}, scale_factor={}, lat_0={}",
                        proj_type, datum, central_meridian, false_easting, false_northing, scale_factor, latitude_of_origin
                    )
                    .into(),
                );

                let wgs84 =
                    Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs").map_err(|e| {
                        JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e))
                    })?;

                let proj_datum = if datum == "NAD83" || datum == "NAD27" {
                    web_sys::console::log_1(
                        &format!(
                            "Note: Using WGS84 as approximation for {} (difference <2m in CONUS)",
                            datum
                        )
                        .into(),
                    );
                    "WGS84"
                } else {
                    datum
                };

                let tm_proj_string = format!(
                    "+proj=tmerc +lat_0={} +lon_0={} +k={} +x_0={} +y_0={} +datum={} +units=m +no_defs",
                    latitude_of_origin,
                    central_meridian,
                    scale_factor,
                    false_easting,
                    false_northing,
                    proj_datum
                );

                let tm_proj = Proj::from_proj_string(&tm_proj_string).map_err(|e| {
                    JsValue::from_str(&format!("Failed to create TM projection: {:?}", e))
                })?;

                web_sys::console::log_1(
                    &format!(
                        "Created projections - WGS84: '+proj=longlat +datum=WGS84', TM: '{}'",
                        tm_proj_string
                    )
                    .into(),
                );

                return Ok((Some(wgs84), Some(tm_proj)));
            }
        }

        let utm_zone = Self::extract_utm_zone_from_prj(prj_content);
        if let Some(zone) = utm_zone {
            web_sys::console::log_1(
                &format!(
                    "Detected standard UTM Zone {} ({}) from .prj file, setting up WGS84→UTM transformation",
                    zone, datum
                )
                .into(),
            );

            let wgs84 =
                Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs").map_err(|e| {
                    JsValue::from_str(&format!("Failed to create WGS84 projection: {:?}", e))
                })?;

            let proj_datum = if datum == "NAD83" || datum == "NAD27" {
                web_sys::console::log_1(
                    &format!(
                        "Note: Using WGS84 as approximation for {} (difference <2m in CONUS)",
                        datum
                    )
                    .into(),
                );
                "WGS84"
            } else {
                datum
            };

            let utm_proj_string = format!(
                "+proj=utm +zone={} +datum={} +units=m +no_defs",
                zone, proj_datum
            );
            let utm = Proj::from_proj_string(&utm_proj_string).map_err(|e| {
                JsValue::from_str(&format!("Failed to create UTM projection: {:?}", e))
            })?;

            web_sys::console::log_1(
                &format!(
                    "Created projections - WGS84: '+proj=longlat +datum=WGS84', Projected: '{}'",
                    utm_proj_string
                )
                .into(),
            );

            Ok((Some(wgs84), Some(utm)))
        } else {
            web_sys::console::warn_1(
                &"Could not parse projection from .prj file, assuming geographic coordinates"
                    .into(),
            );
            Ok((None, None))
        }
    }

    pub(super) fn extract_utm_zone_from_prj(prj_content: &str) -> Option<u8> {
        let upper = prj_content.to_uppercase();
        if let Some(idx) = upper.find("UTM") {
            let after_utm = &upper[idx..];
            if let Some(zone_idx) = after_utm.find("ZONE") {
                let after_zone = &after_utm[zone_idx + 4..];
                let zone_str: String = after_zone
                    .chars()
                    .skip_while(|c| !c.is_numeric())
                    .take_while(|c| c.is_numeric())
                    .collect();

                if let Ok(zone) = zone_str.parse::<u8>() {
                    if (1..=60).contains(&zone) {
                        web_sys::console::log_1(
                            &format!("Extracted UTM zone {} from .prj file", zone).into(),
                        );
                        return Some(zone);
                    }
                }
            }
        }

        if prj_content.contains("Transverse_Mercator") {
            if let Some((central_meridian, false_easting, _false_northing, scale_factor, _)) =
                Self::extract_transverse_mercator_params(prj_content)
            {
                if (false_easting - 500000.0).abs() < 1.0 && (scale_factor - 0.9996).abs() < 0.0001
                {
                    let zone = ((central_meridian + 180.0) / 6.0).floor() as i32 + 1;
                    if (1..=60).contains(&zone) {
                        web_sys::console::log_1(
                            &format!(
                                "Detected UTM zone {} from central_meridian {} (false_easting={}, scale_factor={})",
                                zone, central_meridian, false_easting, scale_factor
                            )
                            .into(),
                        );
                        return Some(zone as u8);
                    }
                }
            }
        }

        None
    }

    pub(super) fn extract_transverse_mercator_params(
        prj_content: &str,
    ) -> Option<(f64, f64, f64, f64, f64)> {
        fn extract_parameter(content: &str, param_name: &str) -> Option<f64> {
            let upper_content = content.to_uppercase();
            let upper_param = param_name.to_uppercase();
            let search_pattern = format!("PARAMETER[\"{}\"", upper_param);

            if let Some(idx) = upper_content.find(&search_pattern) {
                let after_param = &content[idx..];
                if let Some(quote_idx) = after_param.find('"') {
                    let after_quote = &after_param[quote_idx + 1..];
                    if let Some(comma_idx) = after_quote.find(',') {
                        let after_comma = &after_quote[comma_idx + 1..];
                        let number_str: String = after_comma
                            .chars()
                            .take_while(|c| {
                                c.is_numeric()
                                    || *c == '-'
                                    || *c == '.'
                                    || *c == 'e'
                                    || *c == 'E'
                                    || *c == '+'
                            })
                            .collect();

                        if let Ok(value) = number_str.trim().parse::<f64>() {
                            return Some(value);
                        }
                    }
                }
            }

            None
        }

        let central_meridian = extract_parameter(prj_content, "central_meridian")?;
        let false_easting = extract_parameter(prj_content, "false_easting").unwrap_or(0.0);
        let false_northing = extract_parameter(prj_content, "false_northing").unwrap_or(0.0);
        let scale_factor = extract_parameter(prj_content, "scale_factor").unwrap_or(1.0);
        let latitude_of_origin =
            extract_parameter(prj_content, "latitude_of_origin").unwrap_or(0.0);

        Some((
            central_meridian,
            false_easting,
            false_northing,
            scale_factor,
            latitude_of_origin,
        ))
    }
}
