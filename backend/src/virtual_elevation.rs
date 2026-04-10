use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

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
    wind_speed: Vec<f64>, // apparent velocity at 0° (air_speed directly, or wind_speed triangulated with wind_yaw)
    #[wasm_bindgen(skip)]
    rho_array: Option<Vec<f64>>, // per-datapoint air density (if available from environmental data or FIT file)
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
            wind_speed,
            rho_array: None,
        }
    }

    /// Set per-datapoint air density array (for use with environmental data from CSV)
    #[wasm_bindgen]
    pub fn set_rho_array(&mut self, rho_array: Vec<f64>) {
        self.rho_array = Some(rho_array);
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
    pub fn virtual_elevation(&self) -> Vec<f64> {
        self.virtual_elevation.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn virtual_slope(&self) -> Vec<f64> {
        self.virtual_slope.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn acceleration(&self) -> Vec<f64> {
        self.acceleration.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn effective_wind(&self) -> Vec<f64> {
        self.effective_wind.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn apparent_velocity(&self) -> Vec<f64> {
        self.apparent_velocity.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn r2(&self) -> f64 {
        self.r2
    }

    #[wasm_bindgen(getter)]
    pub fn rmse(&self) -> f64 {
        self.rmse
    }

    #[wasm_bindgen(getter)]
    pub fn ve_elevation_diff(&self) -> f64 {
        self.ve_elevation_diff
    }

    #[wasm_bindgen(getter)]
    pub fn actual_elevation_diff(&self) -> f64 {
        self.actual_elevation_diff
    }

    #[wasm_bindgen(getter)]
    pub fn virtual_distance_air(&self) -> f64 {
        self.virtual_distance_air
    }

    #[wasm_bindgen(getter)]
    pub fn virtual_distance_ground(&self) -> f64 {
        self.virtual_distance_ground
    }

    #[wasm_bindgen(getter)]
    pub fn vd_difference_percent(&self) -> f64 {
        self.vd_difference_percent
    }
}

#[wasm_bindgen]
pub struct VirtualElevationCalculator {
    data: VEData,
    params: VEParameters,
    dt: f64,                    // time step in seconds
    air_speed_calibration: f64, // air_speed multiplier (1.0 = no adjustment, 1.1 = +10%, 0.9 = -10%)
}

#[wasm_bindgen]
impl VirtualElevationCalculator {
    #[wasm_bindgen(constructor)]
    pub fn new(data: VEData, params: VEParameters) -> VirtualElevationCalculator {
        VirtualElevationCalculator {
            data,
            params,
            dt: 1.0,                    // assume 1 second intervals
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
                acceleration[i] = (v[i].powi(2) - v[i - 1].powi(2)) / (2.0 * v[i] * self.dt);
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
        let x = lat1_rad.cos() * lat2_rad.sin()
            - lat1_rad.sin() * lat2_rad.cos() * (lon2_rad - lon1_rad).cos();

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
            if !lat[i - 1].is_nan() && !lon[i - 1].is_nan() && !lat[i].is_nan() && !lon[i].is_nan()
            {
                directions[i - 1] = Self::calculate_bearing(lat[i - 1], lon[i - 1], lat[i], lon[i]);
            }
        }

        // Last point gets same direction as second-to-last
        if n > 1 {
            directions[n - 1] = directions[n - 2];
        }

        // Simple smoothing: convert to components, smooth, convert back
        let mut x_comp: Vec<f64> = directions.iter().map(|d| d.to_radians().cos()).collect();
        let mut y_comp: Vec<f64> = directions.iter().map(|d| d.to_radians().sin()).collect();

        // Simple 3-point moving average for smoothing
        let window_size = 3.min(n);
        if window_size >= 3 {
            for i in 1..(n - 1) {
                x_comp[i] = (x_comp[i - 1] + x_comp[i] + x_comp[i + 1]) / 3.0;
                y_comp[i] = (y_comp[i - 1] + y_comp[i] + y_comp[i + 1]) / 3.0;
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
        // PRIORITY 1: Use wind_speed data if available (already apparent velocity from air_speed or wind_speed columns)
        if !self.data.wind_speed.is_empty()
            && self
                .data
                .wind_speed
                .iter()
                .any(|&x| !x.is_nan() && x != 0.0)
        {
            // Data is already apparent velocity - just apply calibration
            return self
                .data
                .wind_speed
                .iter()
                .map(|&speed| speed * self.air_speed_calibration)
                .collect();
        }

        // PRIORITY 2: Fall back to calculated effective wind (from wind parameters)
        self.data
            .velocity
            .iter()
            .zip(effective_wind)
            .map(|(v, w)| v + w)
            .collect()
    }

    /// Calculate virtual distances from wind data and ground speed within trim region
    fn calculate_virtual_distances(&self, trim_start: usize, trim_end: usize) -> (f64, f64, f64) {
        let mut vd_wind = 0.0;
        let mut vd_ground = 0.0;

        // Check if wind_speed data is available
        let has_wind_speed = !self.data.wind_speed.is_empty()
            && self
                .data
                .wind_speed
                .iter()
                .any(|&x| !x.is_nan() && x != 0.0);

        if !has_wind_speed {
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
            if dt > 0.0 && dt < 10.0 {
                // Sanity check for time step
                // Apparent velocity distance (already includes wind, just apply calibration)
                let apparent_speed = self.data.wind_speed[i] * self.air_speed_calibration;
                if !apparent_speed.is_nan() && apparent_speed > 0.0 {
                    vd_wind += apparent_speed * dt;
                }

                // Ground speed distance
                let ground_speed = self.data.velocity[i];
                if !ground_speed.is_nan() && ground_speed > 0.0 {
                    vd_ground += ground_speed * dt;
                }
            }
        }

        // Calculate percentage difference: ((VD_wind - VD_ground) / VD_ground) * 100
        let vd_diff_percent = if vd_ground > 0.0 {
            ((vd_wind - vd_ground) / vd_ground) * 100.0
        } else {
            0.0
        };

        (vd_wind, vd_ground, vd_diff_percent)
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

            // Use per-datapoint rho if available, otherwise use the parameter value
            let rho = self
                .data
                .rho_array
                .as_ref()
                .and_then(|arr| arr.get(i).copied())
                .unwrap_or(self.params.rho);

            // Virtual slope calculation (Robert Chung's formula)
            let virtual_slope = (w / (v * self.params.system_mass * 9.807))
                - (cda * rho * va.powi(2) / (2.0 * self.params.system_mass * 9.807))
                - crr
                - (a / 9.807);

            slope.push(if virtual_slope.is_finite() {
                virtual_slope
            } else {
                0.0
            });
        }

        (slope, effective_wind, apparent_velocity)
    }

    /// Calculate virtual slope with per-datapoint CdA array
    fn calculate_virtual_slope_with_cda_array(
        &self,
        cda_array: &[f64],
        crr: f64,
    ) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
        let acceleration = self.calculate_acceleration();
        let effective_wind = self.calculate_effective_wind();
        let apparent_velocity = self.get_apparent_velocity(&effective_wind);

        let mut slope = Vec::new();

        for i in 0..self.data.velocity.len() {
            let v = self.data.velocity[i].max(0.001); // Avoid division by zero
            let w = self.data.power[i] * self.params.eta;
            let a = acceleration[i];
            let va = apparent_velocity[i];

            // Use per-datapoint rho if available, otherwise use the parameter value
            let rho = self
                .data
                .rho_array
                .as_ref()
                .and_then(|arr| arr.get(i).copied())
                .unwrap_or(self.params.rho);

            // Use per-datapoint CdA from array, handle NaN values
            let cda = cda_array
                .get(i)
                .copied()
                .filter(|&x| x.is_finite())
                .unwrap_or(0.3); // Default to 0.3 if missing or NaN

            // Virtual slope calculation (Robert Chung's formula)
            let virtual_slope = (w / (v * self.params.system_mass * 9.807))
                - (cda * rho * va.powi(2) / (2.0 * self.params.system_mass * 9.807))
                - crr
                - (a / 9.807);

            slope.push(if virtual_slope.is_finite() {
                virtual_slope
            } else {
                0.0
            });
        }

        (slope, effective_wind, apparent_velocity)
    }

    /// Calculate virtual elevation profile
    #[wasm_bindgen]
    pub fn calculate_virtual_elevation(
        &self,
        cda: f64,
        crr: f64,
        trim_start: usize,
        trim_end: usize,
    ) -> VEResult {
        let (virtual_slope, effective_wind, apparent_velocity) =
            self.calculate_virtual_slope(cda, crr);
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

    /// Calculate virtual elevation profile with per-datapoint CdA array
    #[wasm_bindgen]
    pub fn calculate_virtual_elevation_with_cda_array(
        &self,
        cda_array: &[f64],
        crr: f64,
        trim_start: usize,
        trim_end: usize,
    ) -> VEResult {
        let (virtual_slope, effective_wind, apparent_velocity) =
            self.calculate_virtual_slope_with_cda_array(cda_array, crr);
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
    fn calculate_metrics(
        &self,
        virtual_elevation: &[f64],
        trim_start: usize,
        trim_end: usize,
    ) -> (f64, f64, f64, f64) {
        // Check if we have actual elevation data
        // Only skip if array is empty OR if ALL values are NaN OR if ALL values are zero
        let all_nan =
            !self.data.altitude.is_empty() && self.data.altitude.iter().all(|&x| x.is_nan());
        let all_zero =
            !self.data.altitude.is_empty() && self.data.altitude.iter().all(|&x| x == 0.0);

        if self.data.altitude.is_empty() || all_nan || all_zero {
            // No actual elevation available - calculate VE diff using trim indices
            let safe_trim_end = trim_end.min(virtual_elevation.len().saturating_sub(1));
            let safe_trim_start = trim_start.min(safe_trim_end);

            let ve_diff = if virtual_elevation.len() > safe_trim_start
                && virtual_elevation.len() > safe_trim_end
            {
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

/// Helper function to create VE calculator from JS data with optional per-datapoint rho array
#[wasm_bindgen]
pub fn create_ve_calculator_with_rho_array(
    // Data arrays
    timestamps: Vec<f64>,
    power: Vec<f64>,
    velocity: Vec<f64>,
    position_lat: Vec<f64>,
    position_long: Vec<f64>,
    altitude: Vec<f64>,
    distance: Vec<f64>,
    wind_speed: Vec<f64>,
    // Optional rho array (if None, uses the single rho parameter)
    rho_array: Option<Vec<f64>>,
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
    let mut data = VEData::new(
        timestamps,
        power,
        velocity,
        position_lat,
        position_long,
        altitude,
        distance,
        wind_speed,
    );

    // Set rho array if provided
    if let Some(rho_arr) = rho_array {
        data.rho_array = Some(rho_arr);
    }

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

// ============================================================================
// Tests
// ============================================================================
//
// Golden tests for the Robert Chung virtual-elevation formula.
//
// These pin down correctness on analytically solvable cases so the VE math
// can be refactored safely. All numeric golden values are derived below from
// first principles (not captured from a previous run).
//
// `VirtualElevationCalculator` and its inputs are `#[wasm_bindgen]`, but they
// return plain Rust types (`VEResult`, `Vec<f64>`, `f64`), so these tests run
// on the host target with plain `cargo test --lib` — no wasm runtime needed.

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Reference conditions (shared by most tests) ----

    const G: f64 = 9.807; // must match virtual_elevation.rs
    const SYSTEM_MASS: f64 = 80.0; // kg
    const RHO: f64 = 1.225; // kg/m³ (ISA sea level)
    const ETA: f64 = 0.97; // drivetrain efficiency
    const CDA: f64 = 0.30; // drag area
    const CRR: f64 = 0.004; // rolling resistance coefficient
    const V: f64 = 10.0; // ground speed m/s (≈ 36 km/h)
    const N: usize = 100; // data points at 1 Hz

    /// Input (at-the-pedals) power needed to hold `V` on flat ground under the
    /// reference conditions with zero wind:
    ///   P_mech = ½·ρ·CdA·v³ + Crr·m·g·v
    ///   P_input = P_mech / η
    fn steady_state_power() -> f64 {
        let p_mech = 0.5 * RHO * CDA * V.powi(3) + CRR * SYSTEM_MASS * G * V;
        p_mech / ETA
    }

    /// Reference parameters: 80 kg rider, ISA air, η=0.97, no wind.
    fn reference_params() -> VEParameters {
        let mut p = VEParameters::new();
        p.system_mass = SYSTEM_MASS;
        p.rho = RHO;
        p.eta = ETA;
        p.cda = Some(CDA);
        p.crr = Some(CRR);
        p.wind_speed = None;
        p.wind_direction = None;
        p.velodrome = false;
        p
    }

    /// Build a constant-velocity, constant-power VEData of length `N` with
    /// flat altitude and no GPS. `wind_speed_data` is placed directly into
    /// the `wind_speed` field (all-zeros = "no apparent-velocity data, fall
    /// back to params").
    fn constant_ride(power_watts: f64, altitude_m: f64, wind_speed_data: Vec<f64>) -> VEData {
        let timestamps: Vec<f64> = (0..N).map(|i| i as f64).collect();
        let power = vec![power_watts; N];
        let velocity = vec![V; N];
        let position_lat: Vec<f64> = vec![];
        let position_long: Vec<f64> = vec![];
        let altitude = vec![altitude_m; N];
        let distance: Vec<f64> = (0..N).map(|i| (i as f64) * V).collect();
        VEData::new(
            timestamps,
            power,
            velocity,
            position_lat,
            position_long,
            altitude,
            distance,
            wind_speed_data,
        )
    }

    // ---- Golden tests ----

    /// Sharpest correctness check: a rider holding `V` at exactly the
    /// steady-state power on flat ground with zero wind should produce
    /// virtual elevation ≈ 0 everywhere. Pins down the relationship between
    /// the aero, rolling, power and acceleration terms in the Chung formula.
    #[test]
    fn flat_ride_at_steady_state_power_produces_zero_ve() {
        let data = constant_ride(steady_state_power(), 100.0, vec![0.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());
        let result = calc.calculate_virtual_elevation(CDA, CRR, 0, N - 1);
        let ve = result.virtual_elevation();

        assert_eq!(ve.len(), N);
        for (i, &val) in ve.iter().enumerate() {
            assert!(
                val.abs() < 1e-9,
                "flat-ride VE should be ≈ 0 everywhere, but ve[{}] = {}",
                i,
                val
            );
        }
    }

    /// Adding a 5 m/s headwind via `params` (no direction, no GPS) while
    /// holding the same pedal power as the flat-ride case should make the
    /// rider appear to descend — the power is no longer enough to overcome
    /// the increased apparent-velocity drag.
    ///
    /// Analytic expectation:
    ///   apparent velocity = v + w = 15 m/s
    ///   aero slope        = CdA·ρ·va² / (2·m·g) = 0.3·1.225·225 / 1569.12 ≈ 0.05272
    ///   power slope       = P·η / (v·m·g) ≈ 0.02742
    ///   virtual slope     ≈ 0.02742 − 0.05272 − 0.004 ≈ −0.02930
    ///   Δh per step       = v·dt·sin(atan(−0.0293)) ≈ −0.293 m
    ///   final VE (cum)    ≈ −29 m over 100 steps
    #[test]
    fn headwind_via_params_makes_ve_negative() {
        let mut params = reference_params();
        params.wind_speed = Some(5.0);
        params.wind_direction = None; // pure headwind branch

        let data = constant_ride(steady_state_power(), 100.0, vec![0.0; N]);
        let calc = VirtualElevationCalculator::new(data, params);
        let result = calc.calculate_virtual_elevation(CDA, CRR, 0, N - 1);
        let final_ve = *result.virtual_elevation().last().unwrap();

        assert!(
            (-40.0..-20.0).contains(&final_ve),
            "headwind final VE should be ≈ −29 m, got {}",
            final_ve
        );
    }

    /// Supplying apparent velocity directly via `VEData.wind_speed` (as would
    /// come from an air-speed sensor) must produce the same result as
    /// supplying the wind via `params`. This pins down the "priority 1" path
    /// of `get_apparent_velocity`.
    #[test]
    fn headwind_via_data_matches_headwind_via_params() {
        // Path A: params-based pure headwind of 5 m/s
        let mut params_a = reference_params();
        params_a.wind_speed = Some(5.0);
        params_a.wind_direction = None;
        let data_a = constant_ride(steady_state_power(), 100.0, vec![0.0; N]);
        let calc_a = VirtualElevationCalculator::new(data_a, params_a);
        let ve_a = calc_a
            .calculate_virtual_elevation(CDA, CRR, 0, N - 1)
            .virtual_elevation();

        // Path B: apparent velocity supplied directly as v + 5
        let params_b = reference_params();
        let data_b = constant_ride(steady_state_power(), 100.0, vec![V + 5.0; N]);
        let calc_b = VirtualElevationCalculator::new(data_b, params_b);
        let ve_b = calc_b
            .calculate_virtual_elevation(CDA, CRR, 0, N - 1)
            .virtual_elevation();

        assert_eq!(ve_a.len(), ve_b.len());
        for (i, (&a, &b)) in ve_a.iter().zip(ve_b.iter()).enumerate() {
            assert!(
                (a - b).abs() < 1e-9,
                "data-path and params-path headwind VE should agree at i={}: {} vs {}",
                i,
                a,
                b
            );
        }
    }

    /// Tailwind case via `VEData.wind_speed`: apparent velocity = 5 m/s while
    /// ground speed is still 10 m/s. The same pedal power is now more than
    /// needed, so the rider should appear to climb.
    ///
    /// Analytic expectation:
    ///   aero slope    = 0.3·1.225·25 / 1569.12 ≈ 0.00585
    ///   virtual slope ≈ 0.02742 − 0.00585 − 0.004 ≈ 0.01757
    ///   Δh per step   ≈ 10·0.01757 ≈ 0.176 m
    ///   final VE      ≈ 17 m over 100 steps
    #[test]
    fn tailwind_via_data_makes_ve_positive() {
        let data = constant_ride(steady_state_power(), 100.0, vec![V - 5.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());
        let result = calc.calculate_virtual_elevation(CDA, CRR, 0, N - 1);
        let final_ve = *result.virtual_elevation().last().unwrap();

        assert!(
            (10.0..25.0).contains(&final_ve),
            "tailwind final VE should be ≈ 17 m, got {}",
            final_ve
        );
    }

    /// R² on a synthetic 1% linear climb: build actual altitude that matches
    /// the VE profile exactly, then verify R² ≈ 1 and RMSE ≈ 0.
    ///
    /// Required mechanical power for a 1% grade at v=10:
    ///   P_mech = ½·ρ·CdA·v³ + Crr·m·g·v + m·g·v·slope
    #[test]
    fn r2_is_near_one_on_synthetic_linear_climb() {
        let target_slope = 0.01_f64;

        let p_mech = 0.5 * RHO * CDA * V.powi(3)
            + CRR * SYSTEM_MASS * G * V
            + SYSTEM_MASS * G * V * target_slope;
        let p_input = p_mech / ETA;

        // Build actual altitude that matches what the VE integrator produces:
        // altitude[i] = base + i · delta_per_step (linear ramp).
        let delta_per_step = V * 1.0 * target_slope.atan().sin();
        let altitude: Vec<f64> = (0..N)
            .map(|i| 100.0 + (i as f64) * delta_per_step)
            .collect();

        // Hand-build VEData so we can inject the custom altitude array.
        let timestamps: Vec<f64> = (0..N).map(|i| i as f64).collect();
        let power = vec![p_input; N];
        let velocity = vec![V; N];
        let distance: Vec<f64> = (0..N).map(|i| (i as f64) * V).collect();
        let data = VEData::new(
            timestamps,
            power,
            velocity,
            vec![],
            vec![],
            altitude,
            distance,
            vec![0.0; N],
        );

        let calc = VirtualElevationCalculator::new(data, reference_params());
        let result = calc.calculate_virtual_elevation(CDA, CRR, 0, N - 1);

        assert!(
            result.r2() > 0.99,
            "R² should be near 1 on matching linear climb, got {}",
            result.r2()
        );
        assert!(
            result.rmse() < 0.1,
            "RMSE should be ~0 on matching linear climb, got {}",
            result.rmse()
        );

        let expected_gain = (N as f64 - 1.0) * delta_per_step;
        assert!(
            (result.ve_elevation_diff() - expected_gain).abs() < 0.1,
            "ve_elevation_diff ({}) should match expected rise ({})",
            result.ve_elevation_diff(),
            expected_gain
        );
        assert!(
            (result.actual_elevation_diff() - expected_gain).abs() < 1e-6,
            "actual_elevation_diff ({}) should equal expected linear rise ({})",
            result.actual_elevation_diff(),
            expected_gain
        );
    }

    /// With altitude all-zero, `calculate_metrics` takes the "no reference
    /// altitude" branch: R² and RMSE must be 0, `actual_elevation_diff` must
    /// be 0, and `ve_elevation_diff` is computed from the trim endpoints of
    /// the virtual profile (which is ~0 for a flat steady-state ride).
    #[test]
    fn metrics_are_zero_when_altitude_is_all_zero() {
        let data = constant_ride(steady_state_power(), 0.0, vec![0.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());
        let result = calc.calculate_virtual_elevation(CDA, CRR, 0, N - 1);

        assert_eq!(result.r2(), 0.0, "R² should be 0 with no altitude data");
        assert_eq!(result.rmse(), 0.0, "RMSE should be 0 with no altitude data");
        assert_eq!(
            result.actual_elevation_diff(),
            0.0,
            "actual_elevation_diff should be 0 with no altitude data"
        );
        assert!(
            result.ve_elevation_diff().abs() < 1e-9,
            "ve_elevation_diff should be ≈ 0 for flat steady state, got {}",
            result.ve_elevation_diff()
        );
    }

    /// Sign sanity: more power than steady-state → rider climbs (VE > 0);
    /// less power than steady-state → rider descends (VE < 0). Catches any
    /// sign flip in the Chung formula.
    #[test]
    fn ve_sign_follows_power_surplus() {
        let over = constant_ride(steady_state_power() + 50.0, 100.0, vec![0.0; N]);
        let over_final = *VirtualElevationCalculator::new(over, reference_params())
            .calculate_virtual_elevation(CDA, CRR, 0, N - 1)
            .virtual_elevation()
            .last()
            .unwrap();
        assert!(
            over_final > 0.5,
            "surplus power should raise VE, got {}",
            over_final
        );

        let under = constant_ride(steady_state_power() - 50.0, 100.0, vec![0.0; N]);
        let under_final = *VirtualElevationCalculator::new(under, reference_params())
            .calculate_virtual_elevation(CDA, CRR, 0, N - 1)
            .virtual_elevation()
            .last()
            .unwrap();
        assert!(
            under_final < -0.5,
            "power deficit should lower VE, got {}",
            under_final
        );
    }

    /// Monotonicity: at fixed power, raising CdA grows the aero term, which
    /// lowers the virtual slope and therefore final VE.
    #[test]
    fn higher_cda_lowers_ve_at_fixed_power() {
        let baseline = constant_ride(steady_state_power(), 100.0, vec![0.0; N]);
        let ve_baseline = *VirtualElevationCalculator::new(baseline, reference_params())
            .calculate_virtual_elevation(CDA, CRR, 0, N - 1)
            .virtual_elevation()
            .last()
            .unwrap();

        let draggy = constant_ride(steady_state_power(), 100.0, vec![0.0; N]);
        let ve_draggy = *VirtualElevationCalculator::new(draggy, reference_params())
            .calculate_virtual_elevation(CDA + 0.10, CRR, 0, N - 1)
            .virtual_elevation()
            .last()
            .unwrap();

        assert!(
            ve_draggy < ve_baseline,
            "higher CdA must lower VE: baseline={} draggy={}",
            ve_baseline,
            ve_draggy
        );
    }

    /// Virtual distance: with `VEData.wind_speed` filled in, VD_air is summed
    /// from the supplied apparent velocity and VD_ground from ground speed.
    /// For apparent=15 / ground=10 over 99 sampling intervals:
    ///   VD_air    = 99 · 15 = 1485 m
    ///   VD_ground = 99 · 10 =  990 m
    ///   %Δ        = (1485 − 990) / 990 · 100 = 50.0 %
    #[test]
    fn virtual_distance_reports_headwind_as_positive_percent() {
        let data = constant_ride(steady_state_power(), 100.0, vec![V + 5.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());
        let result = calc.calculate_virtual_elevation(CDA, CRR, 0, N - 1);

        let vd_air = result.virtual_distance_air();
        let vd_ground = result.virtual_distance_ground();
        let pct = result.vd_difference_percent();

        assert!(
            (vd_air - 1485.0).abs() < 1e-9,
            "VD_air should be 1485 m, got {}",
            vd_air
        );
        assert!(
            (vd_ground - 990.0).abs() < 1e-9,
            "VD_ground should be 990 m, got {}",
            vd_ground
        );
        assert!((pct - 50.0).abs() < 1e-9, "Δ% should be 50.0, got {}", pct);
    }

    /// Without any wind_speed data, the VD calculator should early-return
    /// zeros (no apparent-velocity signal → no VD comparison possible).
    #[test]
    fn virtual_distance_is_zero_without_wind_data() {
        let data = constant_ride(steady_state_power(), 100.0, vec![0.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());
        let result = calc.calculate_virtual_elevation(CDA, CRR, 0, N - 1);

        assert_eq!(result.virtual_distance_air(), 0.0);
        assert_eq!(result.virtual_distance_ground(), 0.0);
        assert_eq!(result.vd_difference_percent(), 0.0);
    }
}
