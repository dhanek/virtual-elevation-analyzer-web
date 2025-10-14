use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct VEParameters {
    pub system_mass: f64,
    pub rho: f64,
    pub eta: f64,
    pub cda: Option<f64>,
    pub crr: Option<f64>,
    pub cda_min: f64,
    pub cda_max: f64,
    pub crr_min: f64,
    pub crr_max: f64,
    pub wind_speed: Option<f64>,
    pub wind_direction: Option<f64>,
    pub velodrome: bool,
}

#[wasm_bindgen]
impl VEParameters {
    #[wasm_bindgen(constructor)]
    pub fn new() -> VEParameters {
        VEParameters {
            system_mass: 75.0,
            rho: 1.225,
            eta: 0.97,
            cda: None,
            crr: None,
            cda_min: 0.15,
            cda_max: 0.50,
            crr_min: 0.002,
            crr_max: 0.015,
            wind_speed: None,
            wind_direction: None,
            velodrome: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct VEData {
    timestamps: Vec<f64>,
    power: Vec<f64>,
    velocity: Vec<f64>, // ground speed in m/s
    position_lat: Vec<f64>,
    position_long: Vec<f64>,
    altitude: Vec<f64>,
    distance: Vec<f64>,
    air_speed: Vec<f64>, // apparent wind velocity in m/s (if available)
    wind_speed: Vec<f64>, // wind speed relative to rider (if available)
}

#[wasm_bindgen]
impl VEData {
    #[wasm_bindgen(constructor)]
    pub fn new(
        timestamps: Vec<f64>,
        power: Vec<f64>,
        velocity: Vec<f64>,
        position_lat: Vec<f64>,
        position_long: Vec<f64>,
        altitude: Vec<f64>,
        distance: Vec<f64>,
        air_speed: Vec<f64>,
        wind_speed: Vec<f64>,
    ) -> VEData {
        VEData {
            timestamps,
            power,
            velocity,
            position_lat,
            position_long,
            altitude,
            distance,
            air_speed,
            wind_speed,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct VEResult {
    virtual_elevation: Vec<f64>,
    virtual_slope: Vec<f64>,
    acceleration: Vec<f64>,
    effective_wind: Vec<f64>,
    apparent_velocity: Vec<f64>,
    r2: f64,
    rmse: f64,
    ve_elevation_diff: f64,
    actual_elevation_diff: f64,
    virtual_distance_air: f64,
    virtual_distance_ground: f64,
    vd_difference_percent: f64,
}

#[wasm_bindgen]
impl VEResult {
    #[wasm_bindgen(getter)]
    pub fn virtual_elevation(&self) -> Vec<f64> { self.virtual_elevation.clone() }

    #[wasm_bindgen(getter)]
    pub fn virtual_slope(&self) -> Vec<f64> { self.virtual_slope.clone() }

    #[wasm_bindgen(getter)]
    pub fn acceleration(&self) -> Vec<f64> { self.acceleration.clone() }

    #[wasm_bindgen(getter)]
    pub fn effective_wind(&self) -> Vec<f64> { self.effective_wind.clone() }

    #[wasm_bindgen(getter)]
    pub fn apparent_velocity(&self) -> Vec<f64> { self.apparent_velocity.clone() }

    #[wasm_bindgen(getter)]
    pub fn r2(&self) -> f64 { self.r2 }

    #[wasm_bindgen(getter)]
    pub fn rmse(&self) -> f64 { self.rmse }

    #[wasm_bindgen(getter)]
    pub fn ve_elevation_diff(&self) -> f64 { self.ve_elevation_diff }

    #[wasm_bindgen(getter)]
    pub fn actual_elevation_diff(&self) -> f64 { self.actual_elevation_diff }

    #[wasm_bindgen(getter)]
    pub fn virtual_distance_air(&self) -> f64 { self.virtual_distance_air }

    #[wasm_bindgen(getter)]
    pub fn virtual_distance_ground(&self) -> f64 { self.virtual_distance_ground }

    #[wasm_bindgen(getter)]
    pub fn vd_difference_percent(&self) -> f64 { self.vd_difference_percent }
}

#[wasm_bindgen]
pub struct VirtualElevationCalculator {
    data: VEData,
    params: VEParameters,
    dt: f64, // time step in seconds
    air_speed_calibration: f64, // air_speed multiplier (1.0 = no adjustment, 1.1 = +10%, 0.9 = -10%)
}

#[wasm_bindgen]
impl VirtualElevationCalculator {
    #[wasm_bindgen(constructor)]
    pub fn new(data: VEData, params: VEParameters) -> VirtualElevationCalculator {
        VirtualElevationCalculator {
            data,
            params,
            dt: 1.0, // assume 1 second intervals
            air_speed_calibration: 1.0, // default: no calibration
        }
    }

    /// Set air speed calibration factor (1.0 = no adjustment, 1.1 = +10%, 0.9 = -10%)
    #[wasm_bindgen]
    pub fn set_air_speed_calibration(&mut self, calibration: f64) {
        self.air_speed_calibration = calibration;
    }

    /// Calculate acceleration using method from R code: a = diff(v^2)/(2*v[-1]*dt)
    fn calculate_acceleration(&self) -> Vec<f64> {
        let v = &self.data.velocity;
        let mut acceleration = vec![0.0; v.len()];

        for i in 1..v.len() {
            if v[i] > 0.0 {
                acceleration[i] = (v[i].powi(2) - v[i-1].powi(2)) / (2.0 * v[i] * self.dt);
            }
        }

        // Replace NaN and infinite values with 0
        for a in acceleration.iter_mut() {
            if !a.is_finite() {
                *a = 0.0;
            }
        }

        acceleration
    }

    /// Calculate bearing between two GPS points in degrees (0-360)
    fn calculate_bearing(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
        let lat1_rad = lat1.to_radians();
        let lon1_rad = lon1.to_radians();
        let lat2_rad = lat2.to_radians();
        let lon2_rad = lon2.to_radians();

        let y = (lon2_rad - lon1_rad).sin() * lat2_rad.cos();
        let x = lat1_rad.cos() * lat2_rad.sin() - lat1_rad.sin() * lat2_rad.cos() * (lon2_rad - lon1_rad).cos();

        let bearing = y.atan2(x);
        (bearing.to_degrees() + 360.0) % 360.0
    }

    /// Calculate smoothed rider directions
    fn calculate_rider_directions(&self) -> Vec<f64> {
        let lat = &self.data.position_lat;
        let lon = &self.data.position_long;
        let n = lat.len();

        if n < 2 {
            return vec![0.0; n];
        }

        let mut directions = vec![0.0; n];

        // Calculate bearings between consecutive points
        for i in 1..n {
            if !lat[i-1].is_nan() && !lon[i-1].is_nan() && !lat[i].is_nan() && !lon[i].is_nan() {
                directions[i-1] = Self::calculate_bearing(lat[i-1], lon[i-1], lat[i], lon[i]);
            }
        }

        // Last point gets same direction as second-to-last
        if n > 1 {
            directions[n-1] = directions[n-2];
        }

        // Simple smoothing: convert to components, smooth, convert back
        let mut x_comp: Vec<f64> = directions.iter().map(|d| d.to_radians().cos()).collect();
        let mut y_comp: Vec<f64> = directions.iter().map(|d| d.to_radians().sin()).collect();

        // Simple 3-point moving average for smoothing
        let window_size = 3.min(n);
        if window_size >= 3 {
            for i in 1..(n-1) {
                x_comp[i] = (x_comp[i-1] + x_comp[i] + x_comp[i+1]) / 3.0;
                y_comp[i] = (y_comp[i-1] + y_comp[i] + y_comp[i+1]) / 3.0;
            }
        }

        // Convert back to angles
        for i in 0..n {
            directions[i] = (y_comp[i].atan2(x_comp[i]).to_degrees() + 360.0) % 360.0;
        }

        directions
    }

    /// Calculate effective wind velocity considering wind direction and rider movement
    fn calculate_effective_wind(&self) -> Vec<f64> {
        let wind_speed = self.params.wind_speed.unwrap_or(0.0);

        // If no wind speed, return zero wind
        if wind_speed == 0.0 {
            return vec![0.0; self.data.velocity.len()];
        }

        let wind_direction = match self.params.wind_direction {
            Some(dir) => dir,
            // If no direction specified, assume pure headwind (resistance)
            None => return vec![wind_speed; self.data.velocity.len()],
        };

        // Check if we have GPS data
        if self.data.position_lat.is_empty() || self.data.position_long.is_empty() {
            // No GPS data - assume pure headwind
            return vec![wind_speed; self.data.velocity.len()];
        }

        let rider_directions = self.calculate_rider_directions();
        let mut effective_wind = Vec::new();

        for &rider_dir in &rider_directions {
            // Wind direction: direction wind is COMING FROM (meteorological convention)
            // Rider direction: direction rider is MOVING TOWARDS (geographic bearing)
            //
            // For headwind: wind_direction ≈ rider_direction (wind coming from ahead)
            // For tailwind: wind_direction ≈ rider_direction + 180° (wind coming from behind)
            //
            // Angle between wind source and rider heading:
            let mut angle_diff = (wind_direction - rider_dir).abs();

            // Normalize to [-180, 180]
            if angle_diff > 180.0 {
                angle_diff = 360.0 - angle_diff;
            }

            // Calculate wind component along rider direction
            // angle_diff = 0°   -> headwind (full resistance) -> cos(0) = +1
            // angle_diff = 90°  -> crosswind (no effect) -> cos(90) = 0
            // angle_diff = 180° -> tailwind (full assistance) -> cos(180) = -1
            let eff_wind = wind_speed * angle_diff.to_radians().cos();

            effective_wind.push(eff_wind);
        }

        effective_wind
    }

    /// Get apparent velocity (ground + wind) with optional air_speed calibration
    fn get_apparent_velocity(&self, effective_wind: &[f64]) -> Vec<f64> {
        // Prioritize air_speed data if available
        if !self.data.air_speed.is_empty() && self.data.air_speed.iter().any(|&x| !x.is_nan() && x != 0.0) {
            // Apply calibration to air_speed
            return self.data.air_speed.iter()
                .map(|&speed| speed * self.air_speed_calibration)
                .collect();
        }

        // Use wind_speed data if available
        if !self.data.wind_speed.is_empty() && self.data.wind_speed.iter().any(|&x| !x.is_nan() && x != 0.0) {
            return self.data.velocity.iter().zip(&self.data.wind_speed)
                .map(|(v, w)| v + if w.is_nan() { 0.0 } else { *w })
                .collect();
        }

        // Fall back to calculated effective wind
        self.data.velocity.iter().zip(effective_wind)
            .map(|(v, w)| v + w)
            .collect()
    }

    /// Calculate virtual distances from air speed and ground speed within trim region
    fn calculate_virtual_distances(&self, trim_start: usize, trim_end: usize) -> (f64, f64, f64) {
        let mut vd_air = 0.0;
        let mut vd_ground = 0.0;

        // Check if air_speed data is available
        let has_air_speed = !self.data.air_speed.is_empty()
            && self.data.air_speed.iter().any(|&x| !x.is_nan() && x != 0.0);

        if !has_air_speed {
            return (0.0, 0.0, 0.0);
        }

        // Validate trim indices
        let start_idx = trim_start.min(self.data.timestamps.len().saturating_sub(1));
        let end_idx = trim_end.min(self.data.timestamps.len().saturating_sub(1));

        if start_idx >= end_idx {
            return (0.0, 0.0, 0.0);
        }

        // Calculate VD from trim_start to trim_end (both VD start at 0 at trim_start)
        for i in (start_idx + 1)..=end_idx {
            let dt = self.data.timestamps[i] - self.data.timestamps[i - 1];
            if dt > 0.0 && dt < 10.0 { // Sanity check for time step
                // Air speed distance (calibrated)
                let air_speed = self.data.air_speed[i] * self.air_speed_calibration;
                if !air_speed.is_nan() && air_speed > 0.0 {
                    vd_air += air_speed * dt;
                }

                // Ground speed distance
                let ground_speed = self.data.velocity[i];
                if !ground_speed.is_nan() && ground_speed > 0.0 {
                    vd_ground += ground_speed * dt;
                }
            }
        }

        // Calculate percentage difference: ((VD_air - VD_ground) / VD_ground) * 100
        let vd_diff_percent = if vd_ground > 0.0 {
            ((vd_air - vd_ground) / vd_ground) * 100.0
        } else {
            0.0
        };

        (vd_air, vd_ground, vd_diff_percent)
    }

    /// Calculate virtual slope
    fn calculate_virtual_slope(&self, cda: f64, crr: f64) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
        let acceleration = self.calculate_acceleration();
        let effective_wind = self.calculate_effective_wind();
        let apparent_velocity = self.get_apparent_velocity(&effective_wind);

        let mut slope = Vec::new();

        for i in 0..self.data.velocity.len() {
            let v = self.data.velocity[i].max(0.001); // Avoid division by zero
            let w = self.data.power[i] * self.params.eta;
            let a = acceleration[i];
            let va = apparent_velocity[i];

            // Virtual slope calculation (Robert Chung's formula)
            let virtual_slope = (w / (v * self.params.system_mass * 9.807))
                - (cda * self.params.rho * va.powi(2) / (2.0 * self.params.system_mass * 9.807))
                - crr
                - (a / 9.807);

            slope.push(if virtual_slope.is_finite() { virtual_slope } else { 0.0 });
        }

        (slope, effective_wind, apparent_velocity)
    }

    /// Calculate virtual elevation profile
    #[wasm_bindgen]
    pub fn calculate_virtual_elevation(&self, cda: f64, crr: f64, trim_start: usize, trim_end: usize) -> VEResult {
        let (virtual_slope, effective_wind, apparent_velocity) = self.calculate_virtual_slope(cda, crr);
        let acceleration = self.calculate_acceleration();

        // Calculate elevation changes
        let mut delta_elevation = Vec::new();
        for i in 0..virtual_slope.len() {
            let v = self.data.velocity[i];
            let slope = virtual_slope[i];
            let delta_elev = v * self.dt * slope.atan().sin();
            delta_elevation.push(delta_elev);
        }

        // Cumulative sum to get elevation profile
        let mut virtual_elevation = Vec::new();
        let mut cumsum = 0.0;
        for delta in &delta_elevation {
            cumsum += delta;
            virtual_elevation.push(cumsum);
        }

        // Calculate metrics if actual elevation is available
        let (r2, rmse, ve_elevation_diff, actual_elevation_diff) =
            self.calculate_metrics(&virtual_elevation, trim_start, trim_end);

        // Calculate virtual distances within trim region
        let (virtual_distance_air, virtual_distance_ground, vd_difference_percent) =
            self.calculate_virtual_distances(trim_start, trim_end);

        VEResult {
            virtual_elevation,
            virtual_slope,
            acceleration,
            effective_wind,
            apparent_velocity,
            r2,
            rmse,
            ve_elevation_diff,
            actual_elevation_diff,
            virtual_distance_air,
            virtual_distance_ground,
            vd_difference_percent,
        }
    }

    /// Calculate R², RMSE and elevation differences within trim region
    fn calculate_metrics(&self, virtual_elevation: &[f64], trim_start: usize, trim_end: usize) -> (f64, f64, f64, f64) {
        // Check if we have actual elevation data
        // Only skip if array is empty OR if ALL values are NaN OR if ALL values are zero
        let all_nan = !self.data.altitude.is_empty() && self.data.altitude.iter().all(|&x| x.is_nan());
        let all_zero = !self.data.altitude.is_empty() && self.data.altitude.iter().all(|&x| x == 0.0);

        if self.data.altitude.is_empty() || all_nan || all_zero {
            // No actual elevation available - calculate VE diff using trim indices
            let safe_trim_end = trim_end.min(virtual_elevation.len().saturating_sub(1));
            let safe_trim_start = trim_start.min(safe_trim_end);

            let ve_diff = if virtual_elevation.len() > safe_trim_start && virtual_elevation.len() > safe_trim_end {
                virtual_elevation[safe_trim_end] - virtual_elevation[safe_trim_start]
            } else {
                0.0
            };
            return (0.0, 0.0, ve_diff, 0.0);
        }

        let mut actual_elevation = self.data.altitude.clone();

        // Handle velodrome mode
        if self.params.velodrome {
            actual_elevation = vec![0.0; actual_elevation.len()];
        }

        // Ensure same length
        let min_len = virtual_elevation.len().min(actual_elevation.len());
        if min_len < 3 {
            return (0.0, 0.0, 0.0, 0.0);
        }

        // Validate trim indices
        let safe_trim_end = trim_end.min(min_len.saturating_sub(1));
        let safe_trim_start = trim_start.min(safe_trim_end);

        if safe_trim_end <= safe_trim_start || (safe_trim_end - safe_trim_start) < 2 {
            return (0.0, 0.0, 0.0, 0.0);
        }

        let ve_full = &virtual_elevation[..min_len];
        let actual_full = &actual_elevation[..min_len];

        // Calibrate to match at trim_start (not at 0!)
        let offset = actual_full[safe_trim_start] - ve_full[safe_trim_start];
        let ve_calibrated: Vec<f64> = ve_full.iter().map(|x| x + offset).collect();

        // Extract trim region for metrics calculation
        let ve_trim_region = &ve_calibrated[safe_trim_start..=safe_trim_end];
        let actual_trim_region = &actual_full[safe_trim_start..=safe_trim_end];
        let trim_len = ve_trim_region.len();

        // Calculate R² and RMSE ONLY in trim region
        let ve_mean: f64 = ve_trim_region.iter().sum::<f64>() / trim_len as f64;
        let actual_mean: f64 = actual_trim_region.iter().sum::<f64>() / trim_len as f64;

        let mut numerator = 0.0;
        let mut ve_sq_sum = 0.0;
        let mut actual_sq_sum = 0.0;
        let mut mse = 0.0;

        for i in 0..trim_len {
            let ve_dev = ve_trim_region[i] - ve_mean;
            let actual_dev = actual_trim_region[i] - actual_mean;

            numerator += ve_dev * actual_dev;
            ve_sq_sum += ve_dev * ve_dev;
            actual_sq_sum += actual_dev * actual_dev;

            let diff = ve_trim_region[i] - actual_trim_region[i];
            mse += diff * diff;
        }

        let r2 = if ve_sq_sum > 0.0 && actual_sq_sum > 0.0 {
            let correlation = numerator / (ve_sq_sum * actual_sq_sum).sqrt();
            correlation * correlation
        } else {
            0.0
        };

        let rmse = (mse / trim_len as f64).sqrt();

        // Calculate elevation differences from trim_start to trim_end
        let ve_diff = ve_calibrated[safe_trim_end] - ve_calibrated[safe_trim_start];
        let actual_diff = actual_full[safe_trim_end] - actual_full[safe_trim_start];

        (r2, rmse, ve_diff, actual_diff)
    }
}

/// Helper function to create VE calculator from JS data
#[wasm_bindgen]
pub fn create_ve_calculator(
    // Data arrays
    timestamps: Vec<f64>,
    power: Vec<f64>,
    velocity: Vec<f64>,
    position_lat: Vec<f64>,
    position_long: Vec<f64>,
    altitude: Vec<f64>,
    distance: Vec<f64>,
    air_speed: Vec<f64>,
    wind_speed: Vec<f64>,
    // Parameters
    system_mass: f64,
    rho: f64,
    eta: f64,
    cda: Option<f64>,
    crr: Option<f64>,
    cda_min: f64,
    cda_max: f64,
    crr_min: f64,
    crr_max: f64,
    wind_speed_param: Option<f64>,
    wind_direction: Option<f64>,
    velodrome: bool,
) -> VirtualElevationCalculator {
    let data = VEData::new(
        timestamps,
        power,
        velocity,
        position_lat,
        position_long,
        altitude,
        distance,
        air_speed,
        wind_speed,
    );

    let mut params = VEParameters::new();
    params.system_mass = system_mass;
    params.rho = rho;
    params.eta = eta;
    params.cda = cda;
    params.crr = crr;
    params.cda_min = cda_min;
    params.cda_max = cda_max;
    params.crr_min = crr_min;
    params.crr_max = crr_max;
    params.wind_speed = wind_speed_param;
    params.wind_direction = wind_direction;
    params.velodrome = velodrome;

    VirtualElevationCalculator::new(data, params)
}