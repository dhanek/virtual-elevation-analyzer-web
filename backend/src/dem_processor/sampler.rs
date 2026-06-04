use wasm_bindgen::prelude::*;

use super::*;

#[wasm_bindgen]
impl DEMProcessor {
    /// Perform batch elevation lookup for multiple lat/lon coordinates.
    #[wasm_bindgen]
    pub fn batch_lookup(&mut self, lats: Vec<f64>, lons: Vec<f64>) -> Result<Vec<f64>, JsValue> {
        if lats.len() != lons.len() {
            return Err(JsValue::from_str("lats and lons must have the same length"));
        }

        let mut altitudes = Vec::with_capacity(lats.len());

        for i in 0..lats.len() {
            let lat = lats[i];
            let lon = lons[i];

            let (x, y) =
                if let (Some(ref wgs84), Some(ref dem)) = (&self.wgs84_proj, &self.dem_proj) {
                    let mut point = (lon.to_radians(), lat.to_radians(), 0.0);

                    match proj4rs::transform::transform(wgs84, dem, &mut point) {
                        Ok(_) => (point.0, point.1),
                        Err(e) => {
                            if !self.logged_first_lookup {
                                web_sys::console::warn_1(
                                    &format!(
                                        "proj4rs transform failed for ({}, {}): {:?}",
                                        lat, lon, e
                                    )
                                    .into(),
                                );
                                self.logged_first_lookup = true;
                            }
                            altitudes.push(f64::NAN);
                            continue;
                        }
                    }
                } else {
                    (lon, lat)
                };

            let (col, row) = self.transform.geo_to_pixel(x, y);

            if !self.logged_first_lookup {
                web_sys::console::log_1(
                    &format!(
                        "DEM lookup: ({:.5}, {:.5}) -> CRS ({:.2}, {:.2}) -> pixel ({:.2}, {:.2})",
                        lat, lon, x, y, col, row
                    )
                    .into(),
                );
            }

            let col_nearest = col.round() as i64;
            let row_nearest = row.round() as i64;
            if col_nearest < 0
                || row_nearest < 0
                || col_nearest >= self.width as i64
                || row_nearest >= self.height as i64
            {
                if !self.logged_first_lookup {
                    web_sys::console::warn_1(
                        &format!(
                            "DEM lookup: pixel ({:.2}, {:.2}) -> nearest ({}, {}) out of bounds ({}x{})",
                            col, row, col_nearest, row_nearest, self.width, self.height
                        )
                        .into(),
                    );
                    self.logged_first_lookup = true;
                }
                altitudes.push(f64::NAN);
                continue;
            }

            let elevation = self.get_pixel_value(col_nearest as usize, row_nearest as usize);
            if elevation.is_nan() || (elevation - self.nodata_value as f32).abs() < 0.01 {
                altitudes.push(f64::NAN);
            } else {
                if !self.logged_first_lookup {
                    web_sys::console::log_1(
                        &format!(
                            "DEM lookup: ({:.5}, {:.5}) -> elevation {:.1}m (pixel {},{}) [{}x{} tile]",
                            lat, lon, elevation, col_nearest, row_nearest, self.width, self.height
                        )
                        .into(),
                    );
                    self.logged_first_lookup = true;
                }
                altitudes.push(elevation as f64);
            }
        }

        Ok(altitudes)
    }

    /// Perform batch elevation lookup using bilinear interpolation.
    #[wasm_bindgen]
    pub fn batch_lookup_interpolated(
        &mut self,
        lats: Vec<f64>,
        lons: Vec<f64>,
    ) -> Result<Vec<f64>, JsValue> {
        if lats.len() != lons.len() {
            return Err(JsValue::from_str("lats and lons must have the same length"));
        }

        let mut altitudes = Vec::with_capacity(lats.len());

        for i in 0..lats.len() {
            let lat = lats[i];
            let lon = lons[i];

            let (x, y) =
                if let (Some(ref wgs84), Some(ref dem)) = (&self.wgs84_proj, &self.dem_proj) {
                    let mut point = (lon.to_radians(), lat.to_radians(), 0.0);

                    match proj4rs::transform::transform(wgs84, dem, &mut point) {
                        Ok(_) => (point.0, point.1),
                        Err(_) => {
                            altitudes.push(f64::NAN);
                            continue;
                        }
                    }
                } else {
                    (lon, lat)
                };

            let (col, row) = self.transform.geo_to_pixel(x, y);
            let elevation = self.get_bilinear_interpolated_value(col, row);
            altitudes.push(elevation);
        }

        Ok(altitudes)
    }

    /// Get the elevation error rate (percentage of failed lookups).
    #[wasm_bindgen]
    pub fn get_bounds(&self) -> Vec<f64> {
        let (min_x, max_y) = self.transform.pixel_to_geo(0.0, 0.0);
        let (max_x, min_y) = self
            .transform
            .pixel_to_geo(self.width as f64, self.height as f64);
        vec![min_x, min_y, max_x, max_y]
    }

    /// Get metadata about the DEM.
    #[wasm_bindgen]
    pub fn get_metadata(&self) -> String {
        format!(
            "{{\"width\": {}, \"height\": {}, \"nodata\": {}}}",
            self.width, self.height, self.nodata_value
        )
    }
}

impl DEMProcessor {
    fn get_pixel_value(&self, col: usize, row: usize) -> f32 {
        let idx = row * self.width as usize + col;
        if idx < self.data.len() {
            self.data[idx]
        } else {
            self.nodata_value as f32
        }
    }

    fn is_valid_dem_value(&self, value: f32) -> bool {
        !value.is_nan() && (value - self.nodata_value as f32).abs() >= 0.01
    }

    fn get_bilinear_interpolated_value(&self, col: f64, row: f64) -> f64 {
        let col0 = col.floor() as i64;
        let row0 = row.floor() as i64;
        let col1 = col0 + 1;
        let row1 = row0 + 1;

        if col0 < 0 || row0 < 0 || col1 >= self.width as i64 || row1 >= self.height as i64 {
            return f64::NAN;
        }

        let tx = col - col0 as f64;
        let ty = row - row0 as f64;

        let v00 = self.get_pixel_value(col0 as usize, row0 as usize);
        let v10 = self.get_pixel_value(col1 as usize, row0 as usize);
        let v01 = self.get_pixel_value(col0 as usize, row1 as usize);
        let v11 = self.get_pixel_value(col1 as usize, row1 as usize);

        // Bilinear weight expression:
        // v = v00*(1-tx)*(1-ty) + v10*tx*(1-ty) + v01*(1-tx)*ty + v11*tx*ty
        let candidates = [
            (v00, (1.0 - tx) * (1.0 - ty)),
            (v10, tx * (1.0 - ty)),
            (v01, (1.0 - tx) * ty),
            (v11, tx * ty),
        ];

        let mut weighted_sum = 0.0f64;
        let mut total_weight = 0.0f64;

        for (value, weight) in candidates {
            if self.is_valid_dem_value(value) {
                weighted_sum += value as f64 * weight;
                total_weight += weight;
            }
        }

        if total_weight <= 0.0 {
            return f64::NAN;
        }

        weighted_sum / total_weight
    }
}
