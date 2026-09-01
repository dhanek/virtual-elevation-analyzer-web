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

struct VirtualSlopeResult {
    virtual_slope: Vec<f64>,
    acceleration: Vec<f64>,
    effective_wind: Vec<f64>,
    apparent_velocity: Vec<f64>,
}

/// The parts of a virtual-elevation evaluation that do not depend on CdA or
/// Crr, precomputed once over a trim window so a grid of (CdA, Crr) pairs can
/// be evaluated without re-deriving acceleration, wind and apparent velocity
/// per cell. `calculate_virtual_slope_impl` recomputes all three on every
/// call, which is what made a naive grid loop unaffordable.
///
/// Covers samples `start + 1 ..= end` of the window only. That range is
/// exact, not approximate: `build_virtual_elevation` accumulates
/// `ve[i] = ve[i-1] + v_i·dt·sin(atan(slope_i))`, so `ve[end] - ve[start]`
/// is the sum over `start + 1 ..= end` and sample `start` itself contributes
/// nothing. Include it and every cell is off by one term.
struct GainKernel {
    /// `v_i · dt` — the distance each sample's slope is multiplied by.
    step: Vec<f64>,
    /// `w/(v·m·g) − a/g` — the CdA- and Crr-free part of the Chung slope.
    base: Vec<f64>,
    /// `ρ_i · va_i² / (2·m·g)` — the coefficient CdA multiplies.
    aero: Vec<f64>,
}

impl GainKernel {
    /// `ve[end] - ve[start]` at one (CdA, Crr).
    ///
    /// Keeps `slope.atan().sin()` verbatim from `build_virtual_elevation`
    /// rather than the algebraically identical `x / sqrt(1 + x²)`: the whole
    /// value of the grid is that its minimum agrees with the number the VE
    /// tab shows, and the two forms are not bit-identical.
    fn gain(&self, cda: f64, crr: f64) -> f64 {
        let mut sum = 0.0;
        for i in 0..self.step.len() {
            let slope = self.base[i] - cda * self.aero[i] - crr;
            sum += self.step[i] * slope.atan().sin();
        }
        sum
    }
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

    fn resolve_cda(base_cda: f64, cda_array: Option<&[f64]>, index: usize) -> f64 {
        cda_array
            .and_then(|arr| arr.get(index).copied())
            .filter(|value| value.is_finite())
            .unwrap_or(base_cda)
    }

    fn calculate_virtual_slope_impl(
        &self,
        base_cda: f64,
        cda_array: Option<&[f64]>,
        crr: f64,
    ) -> VirtualSlopeResult {
        let acceleration = self.calculate_acceleration();
        let effective_wind = self.calculate_effective_wind();
        let apparent_velocity = self.get_apparent_velocity(&effective_wind);

        let mut virtual_slope = Vec::with_capacity(self.data.velocity.len());

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
            let cda = Self::resolve_cda(base_cda, cda_array, i);

            // Virtual slope calculation (Robert Chung's formula)
            let slope = (w / (v * self.params.system_mass * 9.807))
                - (cda * rho * va.powi(2) / (2.0 * self.params.system_mass * 9.807))
                - crr
                - (a / 9.807);

            virtual_slope.push(if slope.is_finite() { slope } else { 0.0 });
        }

        VirtualSlopeResult {
            virtual_slope,
            acceleration,
            effective_wind,
            apparent_velocity,
        }
    }

    fn build_virtual_elevation(&self, virtual_slope: &[f64]) -> Vec<f64> {
        let mut virtual_elevation = Vec::with_capacity(virtual_slope.len());
        let mut cumulative_elevation = 0.0;

        for (&velocity, &slope) in self.data.velocity.iter().zip(virtual_slope.iter()) {
            cumulative_elevation += velocity * self.dt * slope.atan().sin();
            virtual_elevation.push(cumulative_elevation);
        }

        virtual_elevation
    }

    fn calculate_virtual_elevation_impl(
        &self,
        base_cda: f64,
        cda_array: Option<&[f64]>,
        crr: f64,
        trim_start: usize,
        trim_end: usize,
    ) -> VEResult {
        let VirtualSlopeResult {
            virtual_slope,
            acceleration,
            effective_wind,
            apparent_velocity,
        } = self.calculate_virtual_slope_impl(base_cda, cda_array, crr);
        let virtual_elevation = self.build_virtual_elevation(&virtual_slope);

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

    /// Calculate virtual elevation profile
    #[wasm_bindgen]
    pub fn calculate_virtual_elevation(
        &self,
        cda: f64,
        crr: f64,
        trim_start: usize,
        trim_end: usize,
    ) -> VEResult {
        self.calculate_virtual_elevation_impl(cda, None, crr, trim_start, trim_end)
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
        self.calculate_virtual_elevation_impl(0.3, Some(cda_array), crr, trim_start, trim_end)
    }

    /// Whether `calculate_metrics` has a reference altitude to compare
    /// against: the channel is unusable when empty, all-NaN or all-zero.
    fn has_usable_altitude(&self) -> bool {
        let altitude = &self.data.altitude;
        if altitude.is_empty() {
            return false;
        }
        let all_nan = altitude.iter().all(|&x| x.is_nan());
        let all_zero = altitude.iter().all(|&x| x == 0.0);
        !(all_nan || all_zero)
    }

    /// The clamped `(start, end)` sample window `calculate_metrics` reports
    /// over, or `None` where it reports zeros instead.
    ///
    /// ONE definition, used by both `calculate_metrics` and the gain kernel.
    /// The two branches clamp differently — without a usable altitude the
    /// window is clamped to the profile and never rejected; with one it is
    /// clamped to the shorter of profile and altitude and rejected below
    /// three samples or a span of two — and a grid that clamped even one
    /// sample differently from the readout would put the contour's minimum
    /// beside the number the VE tab shows rather than on it.
    fn metrics_window(
        &self,
        ve_len: usize,
        trim_start: usize,
        trim_end: usize,
    ) -> Option<(usize, usize)> {
        if !self.has_usable_altitude() {
            if ve_len == 0 {
                return None;
            }
            let end = trim_end.min(ve_len - 1);
            let start = trim_start.min(end);
            return Some((start, end));
        }

        let min_len = ve_len.min(self.data.altitude.len());
        if min_len < 3 {
            return None;
        }
        let end = trim_end.min(min_len - 1);
        let start = trim_start.min(end);
        if end <= start || end - start < 2 {
            return None;
        }
        Some((start, end))
    }

    /// Precompute the CdA/Crr-independent inputs over `start + 1 ..= end`.
    /// Both bounds must already have been clamped by `metrics_window`.
    fn build_gain_kernel(&self, start: usize, end: usize) -> GainKernel {
        let acceleration = self.calculate_acceleration();
        let effective_wind = self.calculate_effective_wind();
        let apparent_velocity = self.get_apparent_velocity(&effective_wind);
        let mg = self.params.system_mass * 9.807;

        let count = end.saturating_sub(start);
        let mut step = Vec::with_capacity(count);
        let mut base = Vec::with_capacity(count);
        let mut aero = Vec::with_capacity(count);

        for i in (start + 1)..=end {
            let v = self.data.velocity[i].max(0.001); // Avoid division by zero
            let w = self.data.power[i] * self.params.eta;
            let a = acceleration[i];
            let va = apparent_velocity[i];
            let rho = self
                .data
                .rho_array
                .as_ref()
                .and_then(|arr| arr.get(i).copied())
                .unwrap_or(self.params.rho);

            let power_term = w / (v * mg);
            let accel_term = a / 9.807;
            let aero_term = rho * va.powi(2) / (2.0 * mg);
            let distance = self.data.velocity[i] * self.dt;

            // `calculate_virtual_slope_impl` zeroes a non-finite slope. Whether
            // the slope is finite does not depend on CdA or Crr (both finite,
            // CdA positive), so decide it once here: such a sample contributes
            // `v·dt·sin(atan(0))` — zero, or NaN when the velocity itself is
            // NaN — exactly as the profile does.
            if (power_term - aero_term - accel_term).is_finite() {
                step.push(distance);
                base.push(power_term - accel_term);
                aero.push(aero_term);
            } else {
                step.push(distance * 0.0);
                base.push(0.0);
                aero.push(0.0);
            }
        }

        GainKernel { step, base, aero }
    }

    /// Virtual-elevation gain `ve[trim_end] - ve[trim_start]` in metres at
    /// one (CdA, Crr), clamped exactly as `calculate_metrics` clamps, so it
    /// equals `calculate_virtual_elevation(..).ve_elevation_diff` in every
    /// branch that function has: with a reference altitude, without one,
    /// and under velodrome.
    ///
    /// This is the closure-error primitive, and it is deliberately
    /// target-free: the caller subtracts its own reference elevation
    /// difference. Pooling across segments and choosing where the reference
    /// comes from both stay in TypeScript, with no change on this side.
    #[wasm_bindgen]
    pub fn ve_gain(&self, cda: f64, crr: f64, trim_start: usize, trim_end: usize) -> f64 {
        match self.metrics_window(self.data.velocity.len(), trim_start, trim_end) {
            Some((start, end)) => self.build_gain_kernel(start, end).gain(cda, crr),
            None => 0.0,
        }
    }

    /// `ve_gain` over a CdA × Crr grid, row-major over CdA:
    /// `index = cda_index * crr_steps + crr_index`, with
    /// `cda_i = cda_min + i·(cda_max − cda_min)/(cda_steps − 1)` and Crr the
    /// same way. Empty when either step count is below two or the window is
    /// degenerate — rejected by `metrics_window`, or spanning no samples.
    ///
    /// The kernel is built once; each CdA column folds CdA into the
    /// per-sample slope once and sweeps Crr as a scalar subtraction, so the
    /// only cost that scales is `cda_steps × crr_steps × window` evaluations
    /// of `atan` and `sin`. Cells are bit-identical to `ve_gain` at the same
    /// coordinates: same operand order, same summation order.
    #[wasm_bindgen]
    #[allow(clippy::too_many_arguments)]
    pub fn ve_gain_grid(
        &self,
        cda_min: f64,
        cda_max: f64,
        cda_steps: usize,
        crr_min: f64,
        crr_max: f64,
        crr_steps: usize,
        trim_start: usize,
        trim_end: usize,
    ) -> Vec<f64> {
        if cda_steps < 2 || crr_steps < 2 {
            return Vec::new();
        }
        let Some((start, end)) =
            self.metrics_window(self.data.velocity.len(), trim_start, trim_end)
        else {
            return Vec::new();
        };
        let kernel = self.build_gain_kernel(start, end);
        if kernel.step.is_empty() {
            return Vec::new();
        }

        let cda_step = (cda_max - cda_min) / ((cda_steps - 1) as f64);
        let crr_step = (crr_max - crr_min) / ((crr_steps - 1) as f64);
        let mut grid = Vec::with_capacity(cda_steps * crr_steps);
        let mut column = vec![0.0; kernel.step.len()];

        for i in 0..cda_steps {
            let cda = cda_min + (i as f64) * cda_step;
            for (slope, (&base, &aero)) in column
                .iter_mut()
                .zip(kernel.base.iter().zip(kernel.aero.iter()))
            {
                *slope = base - cda * aero;
            }
            for j in 0..crr_steps {
                let crr = crr_min + (j as f64) * crr_step;
                let mut sum = 0.0;
                for (&step, &slope) in kernel.step.iter().zip(column.iter()) {
                    sum += step * (slope - crr).atan().sin();
                }
                grid.push(sum);
            }
        }
        grid
    }

    /// The Crr at which `ve_gain(cda, ·)` equals `target_gain`, by bisection
    /// over `[crr_lo, crr_hi]`. Raising Crr lowers every sample's slope, so
    /// gain is strictly decreasing in Crr and the root is unique whenever it
    /// is bracketed; NaN when it is not, so a caller can tell "outside the
    /// bounds" from a bound. Single segment only — the pooled multi-segment
    /// solve needs every segment's calculator at once and lives in
    /// TypeScript.
    #[wasm_bindgen]
    pub fn crr_for_gain(
        &self,
        cda: f64,
        target_gain: f64,
        crr_lo: f64,
        crr_hi: f64,
        trim_start: usize,
        trim_end: usize,
    ) -> f64 {
        let Some((start, end)) =
            self.metrics_window(self.data.velocity.len(), trim_start, trim_end)
        else {
            return f64::NAN;
        };
        let kernel = self.build_gain_kernel(start, end);
        if kernel.step.is_empty() || !(crr_lo < crr_hi) {
            return f64::NAN;
        }
        let gain_lo = kernel.gain(cda, crr_lo);
        let gain_hi = kernel.gain(cda, crr_hi);
        // Decreasing in Crr: bracketed when gain(lo) >= target >= gain(hi).
        if !(gain_hi <= target_gain && target_gain <= gain_lo) {
            return f64::NAN;
        }

        let (mut lo, mut hi) = (crr_lo, crr_hi);
        for _ in 0..200 {
            let mid = 0.5 * (lo + hi);
            if mid <= lo || mid >= hi {
                break;
            }
            if kernel.gain(cda, mid) > target_gain {
                lo = mid;
            } else {
                hi = mid;
            }
            if hi - lo <= 1e-12 {
                break;
            }
        }
        0.5 * (lo + hi)
    }

    /// Calculate R², RMSE and elevation differences within trim region
    fn calculate_metrics(
        &self,
        virtual_elevation: &[f64],
        trim_start: usize,
        trim_end: usize,
    ) -> (f64, f64, f64, f64) {
        // The window is shared with the gain kernel (`metrics_window`) so the
        // Convergence map and this readout can never clamp differently.
        let Some((safe_trim_start, safe_trim_end)) =
            self.metrics_window(virtual_elevation.len(), trim_start, trim_end)
        else {
            return (0.0, 0.0, 0.0, 0.0);
        };

        if !self.has_usable_altitude() {
            // No actual elevation available - VE diff over the clamped window only
            let ve_diff = virtual_elevation[safe_trim_end] - virtual_elevation[safe_trim_start];
            return (0.0, 0.0, ve_diff, 0.0);
        }

        let mut actual_elevation = self.data.altitude.clone();

        // Handle velodrome mode
        if self.params.velodrome {
            actual_elevation = vec![0.0; actual_elevation.len()];
        }

        // Ensure same length (`metrics_window` already guaranteed >= 3)
        let min_len = virtual_elevation.len().min(actual_elevation.len());

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

fn create_ve_calculator_impl(
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

    if let Some(rho_array) = rho_array {
        data.set_rho_array(rho_array);
    }

    let params = VEParameters {
        system_mass,
        rho,
        eta,
        cda,
        crr,
        cda_min,
        cda_max,
        crr_min,
        crr_max,
        wind_speed: wind_speed_param,
        wind_direction,
        velodrome,
    };

    VirtualElevationCalculator::new(data, params)
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
    create_ve_calculator_impl(
        timestamps,
        power,
        velocity,
        position_lat,
        position_long,
        altitude,
        distance,
        wind_speed,
        None,
        system_mass,
        rho,
        eta,
        cda,
        crr,
        cda_min,
        cda_max,
        crr_min,
        crr_max,
        wind_speed_param,
        wind_direction,
        velodrome,
    )
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
    create_ve_calculator_impl(
        timestamps,
        power,
        velocity,
        position_lat,
        position_long,
        altitude,
        distance,
        wind_speed,
        rho_array,
        system_mass,
        rho,
        eta,
        cda,
        crr,
        cda_min,
        cda_max,
        crr_min,
        crr_max,
        wind_speed_param,
        wind_direction,
        velodrome,
    )
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

    /// A uniform per-datapoint CdA array should produce the same VE profile as
    /// the scalar-CdA path.
    #[test]
    fn uniform_cda_array_matches_scalar_cda() {
        let data = constant_ride(steady_state_power(), 100.0, vec![0.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());
        let scalar = calc.calculate_virtual_elevation(CDA, CRR, 0, N - 1);

        let cda_array = vec![CDA; N];
        let array = calc.calculate_virtual_elevation_with_cda_array(&cda_array, CRR, 0, N - 1);

        let scalar_ve = scalar.virtual_elevation();
        let array_ve = array.virtual_elevation();
        assert_eq!(scalar_ve.len(), array_ve.len());
        for (i, (&scalar_value, &array_value)) in scalar_ve.iter().zip(array_ve.iter()).enumerate()
        {
            assert!(
                (scalar_value - array_value).abs() < 1e-9,
                "uniform CdA array should match scalar CdA at i={}: {} vs {}",
                i,
                scalar_value,
                array_value
            );
        }
    }

    /// A constant per-datapoint rho array should match the single-rho helper.
    #[test]
    fn constant_rho_array_matches_scalar_rho() {
        let params = reference_params();
        let data = constant_ride(steady_state_power(), 100.0, vec![0.0; N]);

        let scalar = create_ve_calculator(
            data.timestamps.clone(),
            data.power.clone(),
            data.velocity.clone(),
            data.position_lat.clone(),
            data.position_long.clone(),
            data.altitude.clone(),
            data.distance.clone(),
            data.wind_speed.clone(),
            params.system_mass,
            params.rho,
            params.eta,
            params.cda,
            params.crr,
            params.cda_min,
            params.cda_max,
            params.crr_min,
            params.crr_max,
            params.wind_speed,
            params.wind_direction,
            params.velodrome,
        )
        .calculate_virtual_elevation(CDA, CRR, 0, N - 1);

        let with_rho_array = create_ve_calculator_with_rho_array(
            data.timestamps.clone(),
            data.power.clone(),
            data.velocity.clone(),
            data.position_lat.clone(),
            data.position_long.clone(),
            data.altitude.clone(),
            data.distance.clone(),
            data.wind_speed.clone(),
            Some(vec![RHO; N]),
            params.system_mass,
            params.rho,
            params.eta,
            params.cda,
            params.crr,
            params.cda_min,
            params.cda_max,
            params.crr_min,
            params.crr_max,
            params.wind_speed,
            params.wind_direction,
            params.velodrome,
        )
        .calculate_virtual_elevation(CDA, CRR, 0, N - 1);

        let scalar_ve = scalar.virtual_elevation();
        let rho_array_ve = with_rho_array.virtual_elevation();
        assert_eq!(scalar_ve.len(), rho_array_ve.len());
        for (i, (&scalar_value, &rho_array_value)) in
            scalar_ve.iter().zip(rho_array_ve.iter()).enumerate()
        {
            assert!(
                (scalar_value - rho_array_value).abs() < 1e-9,
                "constant rho array should match scalar rho at i={}: {} vs {}",
                i,
                scalar_value,
                rho_array_value
            );
        }
    }

    // ---- Gain kernel (Convergence tab / auto-converge) ----

    /// A ride exercising every CdA/Crr-independent input the gain kernel
    /// hoists out of the grid loop: varying speed and power (so acceleration
    /// is non-zero), a GPS track whose heading sweeps a circle (so wind
    /// direction matters), a per-sample rho array, and a climbing altitude.
    fn varied_ride() -> VEData {
        let timestamps: Vec<f64> = (0..N).map(|i| i as f64).collect();
        let velocity: Vec<f64> = (0..N)
            .map(|i| 9.0 + 2.0 * ((i as f64) * 0.15).sin())
            .collect();
        let power: Vec<f64> = (0..N)
            .map(|i| 220.0 + 60.0 * ((i as f64) * 0.09).cos())
            .collect();
        let position_lat: Vec<f64> = (0..N)
            .map(|i| 51.0 + 0.001 * ((i as f64) * 0.06).cos())
            .collect();
        let position_long: Vec<f64> = (0..N)
            .map(|i| -1.0 + 0.001 * ((i as f64) * 0.06).sin())
            .collect();
        let altitude: Vec<f64> = (0..N).map(|i| 100.0 + 0.2 * (i as f64)).collect();
        let mut distance = Vec::with_capacity(N);
        let mut travelled = 0.0;
        for &v in &velocity {
            travelled += v;
            distance.push(travelled);
        }
        let mut data = VEData::new(
            timestamps,
            power,
            velocity,
            position_lat,
            position_long,
            altitude,
            distance,
            vec![0.0; N],
        );
        data.set_rho_array(
            (0..N)
                .map(|i| 1.20 + 0.01 * ((i as f64) * 0.05).sin())
                .collect(),
        );
        data
    }

    /// Reference parameters plus a 3 m/s wind from the west, which only
    /// matters on a ride with GPS (`calculate_effective_wind`).
    fn windy_params() -> VEParameters {
        let mut p = reference_params();
        p.wind_speed = Some(3.0);
        p.wind_direction = Some(270.0);
        p
    }

    /// The kernel sums the window directly where the profile accumulates
    /// from sample 0 and subtracts, so the two differ by summation rounding
    /// (~1e-14 here). 1e-9 is still five orders below anything displayed,
    /// while the two defects this guards against are far larger: an
    /// off-by-one term is ~v·dt·slope ≈ 0.1 m, and a clamping mismatch
    /// between the kernel and `calculate_metrics` is metres.
    const GAIN_TOLERANCE: f64 = 1e-9;

    /// `ve_gain` must equal `ve_elevation_diff` at every (CdA, Crr) and every
    /// window shape — interior, clamped past the end, a span of exactly two
    /// (the smallest `calculate_metrics` accepts), a span of one (which it
    /// rejects), and an empty one.
    fn assert_gain_matches_profile(calc: &VirtualElevationCalculator, label: &str) {
        let windows = [(0, N - 1), (10, 60), (5, 7), (5, 6), (0, 10 * N), (N - 1, N - 1)];
        for &cda in &[0.20, 0.30, 0.45] {
            for &crr in &[0.002, 0.005, 0.012] {
                for &(start, end) in &windows {
                    let expected = calc
                        .calculate_virtual_elevation(cda, crr, start, end)
                        .ve_elevation_diff();
                    let actual = calc.ve_gain(cda, crr, start, end);
                    assert!(
                        (expected - actual).abs() < GAIN_TOLERANCE,
                        "{}: ve_gain({}, {}, {}, {}) = {} but the profile says {}",
                        label,
                        cda,
                        crr,
                        start,
                        end,
                        actual,
                        expected
                    );
                }
            }
        }
    }

    #[test]
    fn ve_gain_matches_profile_with_altitude() {
        let data = constant_ride(steady_state_power(), 100.0, vec![0.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());
        assert_gain_matches_profile(&calc, "altitude");
    }

    /// The all-zero altitude branch of `calculate_metrics` clamps differently
    /// (to the profile, never rejecting) — the kernel must follow it there.
    #[test]
    fn ve_gain_matches_profile_without_altitude() {
        let data = constant_ride(steady_state_power(), 0.0, vec![0.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());
        assert_gain_matches_profile(&calc, "no altitude");
    }

    #[test]
    fn ve_gain_matches_profile_under_velodrome() {
        let mut params = windy_params();
        params.velodrome = true;
        let calc = VirtualElevationCalculator::new(varied_ride(), params);
        assert_gain_matches_profile(&calc, "velodrome");
    }

    /// The hoist itself: acceleration, wind direction against a turning GPS
    /// heading, and a per-sample rho all come out of the grid loop. This is
    /// the test that the hoisted arrays are the ones the profile uses.
    #[test]
    fn ve_gain_matches_profile_with_wind_gps_and_rho_array() {
        let calc = VirtualElevationCalculator::new(varied_ride(), windy_params());
        assert_gain_matches_profile(&calc, "wind + GPS + rho array");
    }

    /// The other apparent-velocity path: measured air speed in the data with
    /// a calibration multiplier applied, which `get_apparent_velocity` takes
    /// in preference to the wind parameters.
    #[test]
    fn ve_gain_matches_profile_with_measured_air_speed_and_calibration() {
        let mut data = varied_ride();
        data.wind_speed = data.velocity.iter().map(|v| v + 1.5).collect();
        let mut calc = VirtualElevationCalculator::new(data, windy_params());
        calc.set_air_speed_calibration(1.05);
        assert_gain_matches_profile(&calc, "measured air speed");
    }

    /// Pins the layout TypeScript decodes: `index = cda_index * crr_steps +
    /// crr_index`, CdA and Crr both linearly spaced from min to max inclusive.
    #[test]
    fn ve_gain_grid_is_row_major_over_cda() {
        let calc = VirtualElevationCalculator::new(varied_ride(), windy_params());
        let (cda_steps, crr_steps) = (3, 4);
        let grid = calc.ve_gain_grid(0.2, 0.4, cda_steps, 0.002, 0.008, crr_steps, 0, N - 1);
        assert_eq!(grid.len(), cda_steps * crr_steps);

        for i in 0..cda_steps {
            let cda = 0.2 + (i as f64) * 0.1;
            for j in 0..crr_steps {
                let crr = 0.002 + (j as f64) * 0.002;
                let cell = grid[i * crr_steps + j];
                let direct = calc.ve_gain(cda, crr, 0, N - 1);
                assert!(
                    (cell - direct).abs() < 1e-12,
                    "grid[{}][{}] = {} but ve_gain({}, {}) = {}",
                    i,
                    j,
                    cell,
                    cda,
                    crr,
                    direct
                );
            }
        }
    }

    /// The monotonicity that licenses bisection along either axis. CdA needs
    /// a non-zero apparent velocity, which `varied_ride` has (v ≈ 9 m/s);
    /// a zero-airspeed ride is genuinely flat in CdA.
    #[test]
    fn ve_gain_is_strictly_decreasing_in_crr_and_in_cda() {
        let calc = VirtualElevationCalculator::new(varied_ride(), windy_params());

        let mut previous = f64::INFINITY;
        for k in 0..20 {
            let crr = 0.001 + (k as f64) * 0.001;
            let gain = calc.ve_gain(0.3, crr, 0, N - 1);
            assert!(gain < previous, "gain must fall as Crr rises: crr={} gain={} previous={}", crr, gain, previous);
            previous = gain;
        }

        let mut previous = f64::INFINITY;
        for k in 0..20 {
            let cda = 0.15 + (k as f64) * 0.02;
            let gain = calc.ve_gain(cda, 0.005, 0, N - 1);
            assert!(gain < previous, "gain must fall as CdA rises: cda={} gain={} previous={}", cda, gain, previous);
            previous = gain;
        }
    }

    #[test]
    fn crr_for_gain_recovers_a_planted_crr_and_is_nan_outside_the_bracket() {
        let calc = VirtualElevationCalculator::new(varied_ride(), windy_params());
        let planted = 0.005;
        let target = calc.ve_gain(0.3, planted, 0, N - 1);

        let recovered = calc.crr_for_gain(0.3, target, 0.001, 0.03, 0, N - 1);
        assert!(
            (recovered - planted).abs() < 1e-9,
            "bisection should recover crr={} but gave {}",
            planted,
            recovered
        );

        // A gain only reachable below crr_lo is outside the bracket.
        let unreachable = calc.ve_gain(0.3, 0.0005, 0, N - 1);
        assert!(calc
            .crr_for_gain(0.3, unreachable, 0.001, 0.03, 0, N - 1)
            .is_nan());
        // So is an inverted bracket.
        assert!(calc.crr_for_gain(0.3, target, 0.03, 0.001, 0, N - 1).is_nan());
    }

    #[test]
    fn ve_gain_grid_is_empty_on_degenerate_input() {
        let calc = VirtualElevationCalculator::new(varied_ride(), windy_params());
        assert!(calc.ve_gain_grid(0.2, 0.4, 1, 0.002, 0.008, 4, 0, N - 1).is_empty());
        assert!(calc.ve_gain_grid(0.2, 0.4, 3, 0.002, 0.008, 1, 0, N - 1).is_empty());
        assert!(calc.ve_gain_grid(0.2, 0.4, 3, 0.002, 0.008, 4, 50, 50).is_empty());
        assert!(calc.ve_gain_grid(0.2, 0.4, 3, 0.002, 0.008, 4, 60, 50).is_empty());
        assert!(calc.ve_gain_grid(0.2, 0.4, 3, 0.002, 0.008, 4, 50, 51).is_empty());

        // The no-altitude branch never rejects a window, but a zero-span one
        // still has no samples to sum: an empty grid, and a gain of exactly 0
        // — which is also what the profile reports for it.
        let data = constant_ride(steady_state_power(), 0.0, vec![0.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());
        assert!(calc.ve_gain_grid(0.2, 0.4, 3, 0.002, 0.008, 4, 50, 50).is_empty());
        assert_eq!(calc.ve_gain(0.3, 0.005, 50, 50), 0.0);
    }
}
