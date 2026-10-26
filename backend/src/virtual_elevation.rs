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
    step_seconds: Vec<f64>,
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

    /// Each sample's step duration in seconds (`step_seconds`): the time
    /// from the previous sample, or 0 across a recording gap.
    #[wasm_bindgen(getter)]
    pub fn step_seconds(&self) -> Vec<f64> {
        self.step_seconds.clone()
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
    air_speed_calibration: f64, // air_speed multiplier (1.0 = no adjustment, 1.1 = +10%, 0.9 = -10%)
}

/// A step longer than this many seconds is a recording gap (auto-pause, a
/// dropout), not riding: it adds no height and no virtual distance.
/// Garmin smart recording spaces samples up to ~8 s, so its steps count.
const MAX_STEP_SECONDS: f64 = 10.0;

struct VirtualSlopeResult {
    virtual_slope: Vec<f64>,
    acceleration: Vec<f64>,
    effective_wind: Vec<f64>,
    apparent_velocity: Vec<f64>,
    step_seconds: Vec<f64>,
}

/// The parts of a virtual-elevation evaluation that do not depend on CdA or
/// Crr, precomputed once over a trim window so a grid of (CdA, Crr) pairs can
/// be evaluated without re-deriving acceleration, wind and apparent velocity
/// per cell. `calculate_virtual_slope_impl` recomputes all three on every
/// call, which is what made a naive grid loop unaffordable.
///
/// Covers samples `start + 1 ..= end` of the window only. That range is
/// exact, not approximate: `build_virtual_elevation` accumulates
/// `ve[i] = ve[i-1] + v̄_i·dt_i·slope_i`, so `ve[end] - ve[start]`
/// is the sum over `start + 1 ..= end` and sample `start` itself contributes
/// nothing. Include it and every cell is off by one term.
///
/// `v̄_i` and `v̄a_i` are the step's mean ground and air speed (`step_mean`).
struct GainKernel {
    /// `v̄_i · dt_i` — the distance each sample's slope is multiplied by.
    step: Vec<f64>,
    /// `w/(v̄·m·g) − a/g` — the CdA- and Crr-free part of the Chung slope.
    base: Vec<f64>,
    /// `ρ_i · v̄a_i² / (2·m·g)` — the coefficient CdA multiplies.
    aero: Vec<f64>,
}

impl GainKernel {
    /// `ve[end] - ve[start]` at one (CdA, Crr).
    ///
    /// Sums `step · slope` sample by sample, in `build_virtual_elevation`'s
    /// order, rather than the algebraically identical three-sum closed form:
    /// the whole value of the grid is that its minimum agrees with the number
    /// the VE tab shows, and the two forms are not bit-identical.
    fn gain(&self, cda: f64, crr: f64) -> f64 {
        let mut sum = 0.0;
        for i in 0..self.step.len() {
            let slope = self.base[i] - cda * self.aero[i] - crr;
            sum += self.step[i] * slope;
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
            air_speed_calibration: 1.0, // default: no calibration
        }
    }

    /// Set air speed calibration factor (1.0 = no adjustment, 1.1 = +10%, 0.9 = -10%)
    #[wasm_bindgen]
    pub fn set_air_speed_calibration(&mut self, calibration: f64) {
        self.air_speed_calibration = calibration;
    }

    /// Mean of a channel over the step that ends at sample `index`: its value
    /// half way between samples `index - 1` and `index`. Sample 0 has no step
    /// before it and keeps its own value.
    ///
    /// A step runs from one sample to the next, and its kinetic-energy change
    /// and the reference altitude are both taken between those two samples.
    /// Drag and rolling loss must cover the same step: with the speed at
    /// the end of the step they are counted half a second late, which reads
    /// as extra drag while the rider speeds up and as less while slowing.
    fn step_mean(values: &[f64], index: usize) -> f64 {
        if index == 0 {
            values[index]
        } else {
            0.5 * (values[index - 1] + values[index])
        }
    }

    /// Duration in seconds of the step that ends at each sample:
    /// `dt_i = t[i] − t[i−1]`. FIT files are not resampled, so steps are
    /// whatever the head unit recorded — 1 s, 1–8 s under smart recording,
    /// or a long pause.
    ///
    /// A step that is not positive, not finite, or `MAX_STEP_SECONDS` or
    /// longer is a recording gap and gets 0: the VE step multiplies by it,
    /// so the gap adds no phantom work, and no kinetic-energy change either
    /// (the speeds either side of a pause are not one step apart). Virtual
    /// distance skips the same steps.
    ///
    /// Sample 0 has no step before it and keeps a nominal second, as every
    /// step had before real timestamps were used; it only offsets the whole
    /// profile and never enters a gain (`GainKernel`). So does a sample past
    /// the end of `timestamps`, for a caller that passes none.
    fn step_seconds(&self) -> Vec<f64> {
        let t = &self.data.timestamps;
        (0..self.data.velocity.len())
            .map(|i| {
                if i == 0 || i >= t.len() {
                    return 1.0;
                }
                let dt = t[i] - t[i - 1];
                if dt > 0.0 && dt < MAX_STEP_SECONDS {
                    dt
                } else {
                    0.0
                }
            })
            .collect()
    }

    /// Acceleration over the step that ends at each sample: a = diff(v)/dt_i.
    ///
    /// This is the R code's a = diff(v^2)/(2*v*dt) with the step's mean speed
    /// (`step_mean`) for v, so `a · v̄·dt_i / g` is still the exact
    /// kinetic-energy height diff(v^2)/(2*g), whatever the step's length.
    /// Across a recording gap (`dt_i = 0`) it is 0.
    fn calculate_acceleration(&self, step_seconds: &[f64]) -> Vec<f64> {
        let v = &self.data.velocity;
        let mut acceleration = vec![0.0; v.len()];

        for i in 1..v.len() {
            acceleration[i] = (v[i] - v[i - 1]) / step_seconds[i];
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

        // A missing or non-positive speed sample counts as zero.
        let counted = |speed: f64| {
            if !speed.is_nan() && speed > 0.0 {
                speed
            } else {
                0.0
            }
        };

        // Calculate VD from trim_start to trim_end (both VD start at 0 at trim_start).
        // A distance belongs to its sample's timestamp, the end of the step, so
        // the step is ridden at the mean of the speeds at its two ends — the
        // distance the VE step uses (`step_mean`).
        for i in (start_idx + 1)..=end_idx {
            let dt = self.data.timestamps[i] - self.data.timestamps[i - 1];
            if dt > 0.0 && dt < MAX_STEP_SECONDS {
                // Sanity check for time step
                // Apparent velocity distance (already includes wind, just apply calibration)
                let apparent_before = self.data.wind_speed[i - 1] * self.air_speed_calibration;
                let apparent_after = self.data.wind_speed[i] * self.air_speed_calibration;
                vd_wind += 0.5 * (counted(apparent_before) + counted(apparent_after)) * dt;

                // Ground speed distance
                let ground_before = self.data.velocity[i - 1];
                let ground_after = self.data.velocity[i];
                vd_ground += 0.5 * (counted(ground_before) + counted(ground_after)) * dt;
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
        let step_seconds = self.step_seconds();
        let acceleration = self.calculate_acceleration(&step_seconds);
        let effective_wind = self.calculate_effective_wind();
        let apparent_velocity = self.get_apparent_velocity(&effective_wind);

        let mut virtual_slope = Vec::with_capacity(self.data.velocity.len());

        for i in 0..self.data.velocity.len() {
            // Ground and air speed are the step's means (`step_mean`).
            let v = Self::step_mean(&self.data.velocity, i).max(0.001); // Avoid division by zero
            let w = self.data.power[i] * self.params.eta;
            let a = acceleration[i];
            let va = Self::step_mean(&apparent_velocity, i);

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
            step_seconds,
        }
    }

    /// Accumulate `v̄_i · dt_i · slope_i`: the distance ridden in the step
    /// times its slope, with `dt_i` the step's real duration
    /// (`step_seconds`; 0 across a recording gap).
    ///
    /// The slope comes from the energy balance along the road, where the
    /// climbing power is `m·g·v·sin θ`. It is therefore already the height
    /// gained per metre ridden (sin θ), not rise over run (tan θ), and takes
    /// no `sin(atan(·))`: that would apply the angle twice and lose
    /// `slope²/2` of the height, 0.7% on an 11.5% road.
    fn build_virtual_elevation(&self, virtual_slope: &[f64], step_seconds: &[f64]) -> Vec<f64> {
        let mut virtual_elevation = Vec::with_capacity(virtual_slope.len());
        let mut cumulative_elevation = 0.0;

        for (i, &slope) in virtual_slope.iter().enumerate() {
            cumulative_elevation +=
                Self::step_mean(&self.data.velocity, i) * step_seconds[i] * slope;
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
            step_seconds,
        } = self.calculate_virtual_slope_impl(base_cda, cda_array, crr);
        let virtual_elevation = self.build_virtual_elevation(&virtual_slope, &step_seconds);

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
            step_seconds,
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
        let step_seconds = self.step_seconds();
        let acceleration = self.calculate_acceleration(&step_seconds);
        let effective_wind = self.calculate_effective_wind();
        let apparent_velocity = self.get_apparent_velocity(&effective_wind);
        let mg = self.params.system_mass * 9.807;

        let count = end.saturating_sub(start);
        let mut step = Vec::with_capacity(count);
        let mut base = Vec::with_capacity(count);
        let mut aero = Vec::with_capacity(count);

        for i in (start + 1)..=end {
            let step_velocity = Self::step_mean(&self.data.velocity, i);
            let v = step_velocity.max(0.001); // Avoid division by zero
            let w = self.data.power[i] * self.params.eta;
            let a = acceleration[i];
            let va = Self::step_mean(&apparent_velocity, i);
            let rho = self
                .data
                .rho_array
                .as_ref()
                .and_then(|arr| arr.get(i).copied())
                .unwrap_or(self.params.rho);

            let power_term = w / (v * mg);
            let accel_term = a / 9.807;
            let aero_term = rho * va.powi(2) / (2.0 * mg);
            let distance = step_velocity * step_seconds[i];

            // `calculate_virtual_slope_impl` zeroes a non-finite slope. Whether
            // the slope is finite does not depend on CdA or Crr (both finite,
            // CdA positive), so decide it once here: such a sample contributes
            // `v̄·dt_i·0` — zero, or NaN when the step's speed is itself NaN —
            // exactly as the profile does.
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
    /// NaN WHEN THE WINDOW HAS NOTHING TO SAY -- rejected by `metrics_window`,
    /// or spanning no samples -- which is what `ve_gain_grid` reports as an
    /// empty grid and `crr_for_gain` as NaN. It used to return 0.0 there, and
    /// 0.0 is indistinguishable from a measured gain: a pooled caller folded
    /// a degenerate segment in as though it had closed perfectly, while the
    /// grid's caller dropped the same segment. One rule, three functions,
    /// three ways of saying "no answer" -- but all of them unmistakable.
    ///
    /// The profile reports a placeholder 0.0 for those windows and this does
    /// not, which is the one point where the two deliberately differ; every
    /// window with samples in it still matches the profile exactly.
    ///
    /// This is the closure-error primitive, and it is deliberately
    /// target-free: the caller subtracts its own reference elevation
    /// difference. Pooling across segments and choosing where the reference
    /// comes from both stay in TypeScript, with no change on this side.
    #[wasm_bindgen]
    pub fn ve_gain(&self, cda: f64, crr: f64, trim_start: usize, trim_end: usize) -> f64 {
        let Some((start, end)) =
            self.metrics_window(self.data.velocity.len(), trim_start, trim_end)
        else {
            return f64::NAN;
        };
        let kernel = self.build_gain_kernel(start, end);
        if kernel.step.is_empty() {
            return f64::NAN;
        }
        kernel.gain(cda, crr)
    }

    /// `ve_gain` over a CdA × Crr grid, row-major over CdA:
    /// `index = cda_index * crr_steps + crr_index`, with
    /// `cda_i = cda_min + i·(cda_max − cda_min)/(cda_steps − 1)` and Crr the
    /// same way. Empty when either step count is below two or the window is
    /// degenerate — rejected by `metrics_window`, or spanning no samples.
    ///
    /// The kernel is built once; each CdA column folds CdA into the
    /// per-sample slope once and sweeps Crr as a scalar subtraction, so the
    /// only cost that scales is `cda_steps × crr_steps × window` multiply-adds.
    /// Cells are bit-identical to `ve_gain` at the same coordinates: same
    /// operand order, same summation order.
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
                    sum += step * (slope - crr);
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
    /// TypeScript. The NaN is `try_crr_for_gain`'s `CrrForGainError`,
    /// collapsed for JavaScript.
    /// `try_gain_columns` flattened for JavaScript: `[y, a, f_0, …, f_{G−1}]`,
    /// each the window's length (`trim_end − trim_start + 1` after clamping).
    /// Empty where `ve_gain` is NaN.
    #[wasm_bindgen]
    pub fn gain_columns(&self, trim_start: usize, trim_end: usize, groups: &[u8]) -> Vec<f64> {
        let Some(cols) = self.try_gain_columns(trim_start, trim_end, groups) else {
            return Vec::new();
        };
        let mut flat = Vec::with_capacity(cols.y.len() * (2 + cols.f.len()));
        flat.extend_from_slice(&cols.y);
        flat.extend_from_slice(&cols.a);
        for f in &cols.f {
            flat.extend_from_slice(f);
        }
        flat
    }

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
        self.try_crr_for_gain(cda, target_gain, crr_lo, crr_hi, trim_start, trim_end)
            .unwrap_or(f64::NAN)
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

/// Why `try_crr_for_gain` found no Crr. `crr_for_gain` collapses every
/// variant to NaN for JavaScript; Rust callers and tests keep them apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrrForGainError {
    /// The trim window has no samples to sum (`metrics_window` refused it,
    /// or the kernel came out empty).
    DegenerateWindow,
    /// `crr_lo` is not strictly below `crr_hi`.
    InvertedBracket,
    /// `target_gain` lies outside `[gain(crr_hi), gain(crr_lo)]`.
    NotBracketed,
}

// Deliberately NOT #[wasm_bindgen]: a `Result` with a Rust enum error has no
// JavaScript shape here, so the named failure stays on the Rust side.
impl VirtualElevationCalculator {
    /// `crr_for_gain` with the failure named: the Crr at which
    /// `ve_gain(cda, ·)` equals `target_gain`, by bisection over
    /// `[crr_lo, crr_hi]`.
    pub fn try_crr_for_gain(
        &self,
        cda: f64,
        target_gain: f64,
        crr_lo: f64,
        crr_hi: f64,
        trim_start: usize,
        trim_end: usize,
    ) -> Result<f64, CrrForGainError> {
        let Some((start, end)) =
            self.metrics_window(self.data.velocity.len(), trim_start, trim_end)
        else {
            return Err(CrrForGainError::DegenerateWindow);
        };
        let kernel = self.build_gain_kernel(start, end);
        if kernel.step.is_empty() {
            return Err(CrrForGainError::DegenerateWindow);
        }
        if !(crr_lo < crr_hi) {
            return Err(CrrForGainError::InvertedBracket);
        }
        let gain_lo = kernel.gain(cda, crr_lo);
        let gain_hi = kernel.gain(cda, crr_hi);
        // Decreasing in Crr: bracketed when gain(lo) >= target >= gain(hi).
        if !(gain_hi <= target_gain && target_gain <= gain_lo) {
            return Err(CrrForGainError::NotBracketed);
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
        Ok(0.5 * (lo + hi))
    }

    /// The VE profile over a window split into its CdA- and Crr-free part
    /// and the columns CdA and each Crr group multiply, cumulative from the
    /// window start (0 there):
    ///
    /// `ve[start + k] − ve[start] = y[k] − CdA·a[k] − Σ_s Crr_s·f[s][k]`
    ///
    /// exactly, up to summation rounding. `groups` labels each sample of the
    /// ride with its Crr group; empty puts every sample in group 0. Same
    /// window clamping and the same non-finite rule as `ve_gain`, and `None`
    /// where `ve_gain` is NaN. Target-free like `ve_gain`: the caller
    /// subtracts its own reference rise.
    pub fn try_gain_columns(
        &self,
        trim_start: usize,
        trim_end: usize,
        groups: &[u8],
    ) -> Option<GainColumns> {
        let (start, end) = self.metrics_window(self.data.velocity.len(), trim_start, trim_end)?;
        let kernel = self.build_gain_kernel(start, end);
        if kernel.step.is_empty() {
            return None;
        }
        let group_of = |i: usize| groups.get(i).copied().unwrap_or(0) as usize;
        let group_count = ((start + 1)..=end).map(group_of).max().unwrap_or(0) + 1;

        let len = kernel.step.len() + 1;
        let mut cols = GainColumns {
            y: Vec::with_capacity(len),
            a: Vec::with_capacity(len),
            f: vec![Vec::with_capacity(len); group_count],
        };
        let (mut y, mut a) = (0.0, 0.0);
        let mut f = vec![0.0; group_count];
        cols.y.push(y);
        cols.a.push(a);
        cols.f.iter_mut().for_each(|col| col.push(0.0));
        for (j, i) in ((start + 1)..=end).enumerate() {
            let step = kernel.step[j];
            y += step * kernel.base[j];
            a += step * kernel.aero[j];
            f[group_of(i)] += step;
            cols.y.push(y);
            cols.a.push(a);
            for (col, &value) in cols.f.iter_mut().zip(f.iter()) {
                col.push(value);
            }
        }
        Some(cols)
    }
}

/// `try_gain_columns`' result: per window sample, cumulative from the start.
#[derive(Debug, Clone, PartialEq)]
pub struct GainColumns {
    /// VE at CdA = 0 and Crr = 0.
    pub y: Vec<f64>,
    /// The column CdA multiplies: cumulative `v̄·dt·ρ·v̄a²/(2mg)`.
    pub a: Vec<f64>,
    /// One column per Crr group: cumulative distance ridden in that group.
    pub f: Vec<Vec<f64>>,
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
    ///   Δh per step       = v·dt·(−0.0293) ≈ −0.293 m
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

        // Build the altitude that power really climbs: `m·g·v·slope` lifts the
        // rider `v·slope` each second, so altitude[i] = base + i · delta_per_step
        // (linear ramp).
        let delta_per_step = V * 1.0 * target_slope;
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

    /// The slope is height per metre ridden, so a steep climb gains exactly
    /// the height its power lifts: `m·g·v·slope` of climbing power raises the
    /// rider `v·slope` each second, at any gradient.
    ///
    /// At 10% over 99 steps of 10 m that is 99 m. Reading the slope as rise
    /// over run — `v·dt·sin(atan(slope))` — gives 98.51 m.
    #[test]
    fn steep_climb_gains_the_height_its_power_lifts() {
        let target_slope = 0.10_f64;

        let p_mech = 0.5 * RHO * CDA * V.powi(3)
            + CRR * SYSTEM_MASS * G * V
            + SYSTEM_MASS * G * V * target_slope;
        let data = constant_ride(p_mech / ETA, 0.0, vec![0.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());

        let expected_gain = (N as f64 - 1.0) * V * target_slope;
        let profile_gain = calc
            .calculate_virtual_elevation(CDA, CRR, 0, N - 1)
            .ve_elevation_diff();
        assert!(
            (profile_gain - expected_gain).abs() < 1e-9,
            "a 10% climb should gain {} m, the profile gained {}",
            expected_gain,
            profile_gain
        );
        let kernel_gain = calc.ve_gain(CDA, CRR, 0, N - 1);
        assert!(
            (kernel_gain - expected_gain).abs() < 1e-9,
            "a 10% climb should gain {} m, ve_gain gave {}",
            expected_gain,
            kernel_gain
        );
    }

    /// Drag and rolling loss are taken over the same second as the
    /// kinetic-energy change. A coast-down that speeds up steadily from 8 to
    /// 18 m/s in 20 s has an exact energy balance:
    ///   height lost = (v² − v0²) / (2·g)                 kinetic energy
    ///               + CdA·ρ·(v⁴ − v0⁴) / (8·a·m·g)       ∫ ½·ρ·CdA·v³ dt
    ///               + Crr·(v0·t + a·t²/2)                rolling
    ///               = 13.256 + 11.813 + 1.040 = 26.109 m over 260 m
    ///
    /// With each step's mean speed the virtual elevation follows that to
    /// 4 mm (the cube of the mean speed is not quite the mean of the cube).
    /// With the speed at the end of each step, drag and rolling loss are
    /// counted half a second late and the profile ends 0.65 m low.
    #[test]
    fn accelerating_coast_down_follows_the_energy_balance() {
        const V0: f64 = 8.0; // m/s
        const ACCEL: f64 = 0.5; // m/s²
        const SAMPLES: usize = 21; // 20 s at 1 Hz, ending at 18 m/s

        let speed = |t: f64| V0 + ACCEL * t;
        let travelled = |t: f64| V0 * t + 0.5 * ACCEL * t * t;
        let height_lost = |t: f64| {
            let v = speed(t);
            (v.powi(2) - V0.powi(2)) / (2.0 * G)
                + CDA * RHO * (v.powi(4) - V0.powi(4)) / (8.0 * ACCEL * SYSTEM_MASS * G)
                + CRR * travelled(t)
        };

        let timestamps: Vec<f64> = (0..SAMPLES).map(|i| i as f64).collect();
        let velocity: Vec<f64> = timestamps.iter().map(|&t| speed(t)).collect();
        let altitude: Vec<f64> = timestamps.iter().map(|&t| 100.0 - height_lost(t)).collect();
        let distance: Vec<f64> = timestamps.iter().map(|&t| travelled(t)).collect();
        let data = VEData::new(
            timestamps,
            vec![0.0; SAMPLES],
            velocity,
            vec![],
            vec![],
            altitude,
            distance,
            vec![0.0; SAMPLES],
        );

        let calc = VirtualElevationCalculator::new(data, reference_params());
        let result = calc.calculate_virtual_elevation(CDA, CRR, 0, SAMPLES - 1);

        let expected_gain = -height_lost((SAMPLES - 1) as f64);
        assert!(
            (expected_gain + 26.109).abs() < 1e-3,
            "the energy balance should lose 26.109 m, got {}",
            expected_gain
        );
        assert!(
            (result.actual_elevation_diff() - expected_gain).abs() < 1e-9,
            "actual_elevation_diff ({}) should equal the energy balance ({})",
            result.actual_elevation_diff(),
            expected_gain
        );
        assert!(
            (result.ve_elevation_diff() - expected_gain).abs() < 0.01,
            "ve_elevation_diff ({}) should follow the energy balance ({})",
            result.ve_elevation_diff(),
            expected_gain
        );
        assert!(
            result.rmse() < 0.01,
            "RMSE against the energy balance should be millimetres, got {}",
            result.rmse()
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

    /// Virtual distance is the distance ridden by the timestamp it is reported
    /// for. Speeding up steadily from 8 to 18 m/s in 20 s covers
    /// 13 m/s · 20 s = 260 m, and through air moving 2 m/s faster, 300 m:
    ///   %Δ = (300 − 260) / 260 · 100 = 15.385 %
    ///
    /// Summing the speed at the end of each step gives 265 m and 305 m.
    #[test]
    fn virtual_distance_is_the_distance_ridden_while_accelerating() {
        const SAMPLES: usize = 21; // 20 s at 1 Hz

        let timestamps: Vec<f64> = (0..SAMPLES).map(|i| i as f64).collect();
        let velocity: Vec<f64> = timestamps.iter().map(|&t| 8.0 + 0.5 * t).collect();
        let air_speed: Vec<f64> = velocity.iter().map(|&v| v + 2.0).collect();
        let data = VEData::new(
            timestamps,
            vec![0.0; SAMPLES],
            velocity,
            vec![],
            vec![],
            vec![100.0; SAMPLES],
            vec![0.0; SAMPLES],
            air_speed,
        );
        let calc = VirtualElevationCalculator::new(data, reference_params());
        let result = calc.calculate_virtual_elevation(CDA, CRR, 0, SAMPLES - 1);

        let vd_air = result.virtual_distance_air();
        let vd_ground = result.virtual_distance_ground();
        let pct = result.vd_difference_percent();

        assert!(
            (vd_ground - 260.0).abs() < 1e-9,
            "VD_ground should be 260 m, got {}",
            vd_ground
        );
        assert!(
            (vd_air - 300.0).abs() < 1e-9,
            "VD_air should be 300 m, got {}",
            vd_air
        );
        assert!(
            (pct - 40.0 / 260.0 * 100.0).abs() < 1e-9,
            "Δ% should be 15.385, got {}",
            pct
        );
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
    ///
    /// The two degenerate shapes are where the pair deliberately parts: the
    /// profile reports a placeholder 0.0, `ve_gain` reports NaN so a pooled
    /// caller cannot read it as a measurement. The NaN is allowed here only
    /// where the profile said exactly 0.0 — anything else is the arithmetic
    /// mismatch this test exists to catch — and is pinned by shape in
    /// `ve_gain_is_nan_on_degenerate_window`.
    fn assert_gain_matches_profile(calc: &VirtualElevationCalculator, label: &str) {
        let windows = [(0, N - 1), (10, 60), (5, 7), (5, 6), (0, 10 * N), (N - 1, N - 1)];
        for &cda in &[0.20, 0.30, 0.45] {
            for &crr in &[0.002, 0.005, 0.012] {
                for &(start, end) in &windows {
                    assert_gain_matches_profile_at(calc, cda, crr, start, end, label);
                }
            }
        }
    }

    /// One (CdA, Crr, window) point of `assert_gain_matches_profile`: NaN
    /// only where the profile said exactly 0.0, otherwise within
    /// `GAIN_TOLERANCE`.
    fn assert_gain_matches_profile_at(
        calc: &VirtualElevationCalculator,
        cda: f64,
        crr: f64,
        start: usize,
        end: usize,
        label: &str,
    ) {
        let expected = calc
            .calculate_virtual_elevation(cda, crr, start, end)
            .ve_elevation_diff();
        let actual = calc.ve_gain(cda, crr, start, end);
        if actual.is_nan() {
            assert_eq!(
                expected, 0.0,
                "{}: ve_gain({}, {}, {}, {}) refused a window the profile \
                 answered with {}",
                label, cda, crr, start, end, expected
            );
            return;
        }
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

    /// SplitMix64: a seeded, dependency-free generator for the random-window
    /// test. Not for anything but reproducible test draws.
    struct SplitMix64(u64);

    impl SplitMix64 {
        fn next_u64(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^ (z >> 31)
        }

        /// Uniform in [0, 1).
        fn next_f64(&mut self) -> f64 {
            (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
        }

        /// Uniform in `0..bound`.
        fn below(&mut self, bound: usize) -> usize {
            (self.next_u64() % bound as u64) as usize
        }

        fn uniform(&mut self, lo: f64, hi: f64) -> f64 {
            lo + (hi - lo) * self.next_f64()
        }
    }

    /// The fixed window list in `assert_gain_matches_profile` names the shapes
    /// someone thought of; this draws the ones nobody did. Start and end are
    /// uniform in `0..N+10`, so reversed and past-the-end pairs occur on
    /// purpose, over both a GPS/wind/rho ride and the altitude constant ride.
    #[test]
    fn ve_gain_matches_profile_over_random_windows() {
        const SEED: u64 = 0x5EED_0F_6A1D;
        const DRAWS: usize = 500;

        let calculators = [
            (
                "wind + GPS + rho array",
                VirtualElevationCalculator::new(varied_ride(), windy_params()),
            ),
            (
                "constant ride",
                VirtualElevationCalculator::new(
                    constant_ride(steady_state_power(), 100.0, vec![0.0; N]),
                    reference_params(),
                ),
            ),
        ];

        for (name, calc) in &calculators {
            let mut rng = SplitMix64(SEED);
            for draw in 0..DRAWS {
                let start = rng.below(N + 10);
                let end = rng.below(N + 10);
                let cda = rng.uniform(0.15, 0.50);
                let crr = rng.uniform(0.001, 0.015);
                let label = format!("{} (seed {:#x}, draw {})", name, SEED, draw);
                assert_gain_matches_profile_at(calc, cda, crr, start, end, &label);
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

    /// The NaN above is three different refusals; `try_crr_for_gain` keeps
    /// them apart, so a swap between two of them is visible here even though
    /// `crr_for_gain` would still return NaN for both.
    #[test]
    fn try_crr_for_gain_names_each_failure() {
        let calc = VirtualElevationCalculator::new(varied_ride(), windy_params());
        let planted = 0.005;
        let target = calc.ve_gain(0.3, planted, 0, N - 1);

        let recovered = calc
            .try_crr_for_gain(0.3, target, 0.001, 0.03, 0, N - 1)
            .expect("a bracketed target recovers its Crr");
        assert!(
            (recovered - planted).abs() < 1e-9,
            "bisection should recover crr={} but gave {}",
            planted,
            recovered
        );

        assert_eq!(
            calc.try_crr_for_gain(0.3, target, 0.001, 0.03, 50, 50),
            Err(CrrForGainError::DegenerateWindow)
        );
        assert_eq!(
            calc.try_crr_for_gain(0.3, target, 0.03, 0.001, 0, N - 1),
            Err(CrrForGainError::InvertedBracket)
        );
        let unreachable = calc.ve_gain(0.3, 0.0005, 0, N - 1);
        assert_eq!(
            calc.try_crr_for_gain(0.3, unreachable, 0.001, 0.03, 0, N - 1),
            Err(CrrForGainError::NotBracketed)
        );
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
        // still has no samples to sum: an empty grid, and — since this change
        // — a NaN gain rather than a 0.0 a pooled caller would spend.
        let data = constant_ride(steady_state_power(), 0.0, vec![0.0; N]);
        let calc = VirtualElevationCalculator::new(data, reference_params());
        assert!(calc.ve_gain_grid(0.2, 0.4, 3, 0.002, 0.008, 4, 50, 50).is_empty());
        assert!(calc.ve_gain(0.3, 0.005, 50, 50).is_nan());
    }

    /// The gain/grid agreement that finding #4 was about: every window shape
    /// for which `ve_gain_grid` has nothing to return must be one for which
    /// `ve_gain` has nothing to return either. A 0.0 here is the defect —
    /// pooled solves weight it as a segment that closed perfectly, while the
    /// Convergence tab drops the same segment for having no grid.
    #[test]
    fn ve_gain_is_nan_on_degenerate_window() {
        let calc = VirtualElevationCalculator::new(varied_ride(), windy_params());
        // Rejected by `metrics_window`: empty, reversed, and a span of one.
        assert!(calc.ve_gain(0.3, 0.005, 50, 50).is_nan());
        assert!(calc.ve_gain(0.3, 0.005, 60, 50).is_nan());
        assert!(calc.ve_gain(0.3, 0.005, 50, 51).is_nan());
        // A span of two is the smallest window that is NOT degenerate.
        assert!(calc.ve_gain(0.3, 0.005, 50, 52).is_finite());

        for &(start, end) in &[(50usize, 50usize), (60, 50), (50, 51)] {
            assert!(
                calc.ve_gain_grid(0.2, 0.4, 3, 0.002, 0.008, 4, start, end)
                    .is_empty(),
                "grid and gain disagree about ({start}, {end})"
            );
        }
    }

    // ---- Real step durations (smart recording, recording gaps) ----

    /// A 10-minute ride at 1 Hz on a climbing road, with speed and power
    /// varying slowly enough that a 2–5 s step can follow them.
    fn smooth_ride(samples: usize) -> VEData {
        let timestamps: Vec<f64> = (0..samples).map(|i| i as f64).collect();
        let velocity: Vec<f64> = timestamps
            .iter()
            .map(|&t| 9.0 + 2.0 * (t * 0.02).sin())
            .collect();
        let power: Vec<f64> = timestamps
            .iter()
            .map(|&t| 330.0 + 80.0 * (t * 0.015).cos())
            .collect();
        let altitude: Vec<f64> = timestamps.iter().map(|&t| 100.0 + 0.05 * t).collect();
        let distance: Vec<f64> = velocity
            .iter()
            .scan(0.0, |travelled, &v| {
                *travelled += v;
                Some(*travelled)
            })
            .collect();
        VEData::new(
            timestamps,
            power,
            velocity,
            vec![0.0; samples],
            vec![0.0; samples],
            altitude,
            distance,
            vec![0.0; samples],
        )
    }

    /// Keep sample 0 and then every 2nd–5th sample in an irregular cycle,
    /// as smart recording does. Each kept sample's power is the mean of the
    /// 1 Hz power over its step — the assumption the VE step's `P[i]·dt_i`
    /// makes — so what is left between the two rides is only the thinning
    /// of speed. Returns the thinned ride and the 1 Hz index of its last
    /// sample.
    fn thin(ride: &VEData) -> (VEData, usize) {
        const CYCLE: [usize; 7] = [2, 5, 3, 4, 2, 5, 3];
        let mut kept = vec![0usize];
        let mut k = 0;
        loop {
            let next = kept[kept.len() - 1] + CYCLE[k % CYCLE.len()];
            if next >= ride.timestamps.len() {
                break;
            }
            kept.push(next);
            k += 1;
        }
        let pick = |values: &[f64]| -> Vec<f64> { kept.iter().map(|&i| values[i]).collect() };
        let mut power = vec![ride.power[0]];
        for pair in kept.windows(2) {
            let step = &ride.power[pair[0] + 1..=pair[1]];
            power.push(step.iter().sum::<f64>() / step.len() as f64);
        }
        let thinned = VEData::new(
            pick(&ride.timestamps),
            power,
            pick(&ride.velocity),
            pick(&ride.position_lat),
            pick(&ride.position_long),
            pick(&ride.altitude),
            pick(&ride.distance),
            pick(&ride.wind_speed),
        );
        (thinned, kept[kept.len() - 1])
    }

    /// The TODO's acceptance test: the same ride at 1 Hz and thinned to
    /// irregular 2–5 s steps gives the same VE gain, within the thinning
    /// error. Counting each thinned step as one second — the old fixed
    /// `dt` — would have kept roughly a third of the work and the gain.
    #[test]
    fn thinned_ride_gives_the_same_gain_as_one_hertz() {
        let ride = smooth_ride(600);
        let (thinned, last) = thin(&ride);
        let thinned_len = thinned.timestamps.len();
        let full = VirtualElevationCalculator::new(ride, reference_params());
        let sparse = VirtualElevationCalculator::new(thinned, reference_params());

        for &(cda, crr) in &[(0.25, 0.004), (0.30, 0.005), (0.40, 0.008)] {
            let full_gain = full.ve_gain(cda, crr, 0, last);
            let sparse_gain = sparse.ve_gain(cda, crr, 0, thinned_len - 1);
            assert!(
                full_gain.abs() > 10.0,
                "the ride must climb or descend enough to compare: {full_gain}"
            );
            // Drag at the step's mean speed against the 1 Hz integral: a
            // second-order error, 1–2 cm over the 57–134 m gains here.
            assert!(
                (full_gain - sparse_gain).abs() < 0.05,
                "CdA {cda}, Crr {crr}: 1 Hz gain {full_gain}, thinned {sparse_gain}"
            );
            // The profile tells the same story as the kernel.
            assert_gain_matches_profile_at(&sparse, cda, crr, 0, thinned_len - 1, "thinned");
        }
    }

    /// A recording gap — auto-pause, a dropout — is not ridden: it adds no
    /// work and no kinetic-energy change, however long it lasts and however
    /// different the speed and power either side of it are. Before, a 100 s
    /// pause was counted as one second at the resumed power.
    #[test]
    fn recording_gap_adds_no_phantom_work() {
        let mut data = constant_ride(steady_state_power(), 0.0, vec![0.0; N]);
        for t in &mut data.timestamps[50..] {
            *t += 100.0; // a 101 s step between samples 49 and 50
        }
        // Resumed slower and with a hard first pedal stroke.
        data.velocity[50] = 4.0;
        data.power[50] = 600.0;
        data.timestamps[60] = data.timestamps[59]; // a duplicate timestamp
        let calc = VirtualElevationCalculator::new(data, reference_params());

        let result = calc.calculate_virtual_elevation(CDA, CRR, 0, N - 1);
        let step_seconds = result.step_seconds();
        assert_eq!(step_seconds[50], 0.0);
        assert_eq!(step_seconds[60], 0.0);
        assert_eq!(step_seconds[51], 1.0);
        let ve = result.virtual_elevation();
        assert_eq!(ve[50], ve[49], "the gap step must add nothing");
        assert_eq!(ve[60], ve[59], "a zero-length step must add nothing");
        assert_eq!(result.acceleration()[50], 0.0);

        let whole = calc.ve_gain(CDA, CRR, 0, N - 1);
        let before = calc.ve_gain(CDA, CRR, 0, 49);
        let after = calc.ve_gain(CDA, CRR, 50, N - 1);
        assert!(
            (whole - (before + after)).abs() < GAIN_TOLERANCE,
            "whole {whole} != before {before} + after {after}"
        );
        assert_gain_matches_profile_at(&calc, CDA, CRR, 0, N - 1, "gap");
    }

    /// On a 1 Hz recording every step is exactly one second, so results are
    /// bit-identical to the fixed `dt = 1` the kernel used before — which
    /// is still what a ride without timestamps gets.
    #[test]
    fn one_hertz_ride_is_bit_identical_to_a_fixed_one_second_step() {
        let timed = varied_ride();
        let mut untimed = varied_ride();
        untimed.timestamps.clear();
        let timed = VirtualElevationCalculator::new(timed, windy_params());
        let untimed = VirtualElevationCalculator::new(untimed, windy_params());

        let a = timed.calculate_virtual_elevation(0.31, 0.0047, 5, 90);
        let b = untimed.calculate_virtual_elevation(0.31, 0.0047, 5, 90);
        assert_eq!(a.virtual_elevation(), b.virtual_elevation());
        assert_eq!(a.acceleration(), b.acceleration());
        assert_eq!(a.ve_elevation_diff(), b.ve_elevation_diff());
        assert_eq!(a.step_seconds(), vec![1.0; N]);
        assert_eq!(
            timed.ve_gain_grid(0.2, 0.4, 5, 0.002, 0.008, 4, 5, 90),
            untimed.ve_gain_grid(0.2, 0.4, 5, 0.002, 0.008, 4, 5, 90)
        );
    }

    // ---- Gain columns (Kalman fit, J6) ----

    /// `y − CdA·a − Crr·Σ f_s` must reproduce the VE profile from the window
    /// start, sample by sample, at any (CdA, Crr): the Kalman fit relies on
    /// the profile being exactly linear in both.
    #[test]
    fn gain_columns_reproduce_the_profile_at_every_sample() {
        let calc = VirtualElevationCalculator::new(varied_ride(), windy_params());
        let groups: Vec<u8> = (0..N).map(|i| ((i / 7) % 3) as u8).collect();
        let (start, end) = (10, 90);
        let cols = calc
            .try_gain_columns(start, end, &groups)
            .expect("an interior window has columns");
        assert_eq!(cols.f.len(), 3);
        assert_eq!(cols.y.len(), end - start + 1);
        for &(cda, crr) in &[(0.20, 0.002), (0.31, 0.0047), (0.45, 0.012)] {
            let ve = calc
                .calculate_virtual_elevation(cda, crr, start, end)
                .virtual_elevation();
            for k in 0..=(end - start) {
                let rolling: f64 = cols.f.iter().map(|f| f[k]).sum();
                let linear = cols.y[k] - cda * cols.a[k] - crr * rolling;
                let profile = ve[start + k] - ve[start];
                assert!(
                    (linear - profile).abs() < GAIN_TOLERANCE,
                    "sample {}: columns give {} but the profile says {}",
                    k,
                    linear,
                    profile
                );
            }
        }
    }

    /// Each Crr column only accumulates distance on its own group's samples,
    /// so a different Crr per group moves the profile only where that group
    /// is ridden.
    #[test]
    fn gain_columns_split_the_rolling_distance_by_group() {
        let calc = VirtualElevationCalculator::new(varied_ride(), windy_params());
        let groups: Vec<u8> = (0..N).map(|i| if i < 50 { 0 } else { 1 }).collect();
        let cols = calc.try_gain_columns(10, 90, &groups).unwrap();
        // Window samples 11..=49 are group 0, 50..=90 group 1.
        assert_eq!(cols.f[1][39], 0.0, "group 1 is not ridden before sample 50");
        assert!(cols.f[1][40] > 0.0);
        assert_eq!(cols.f[0][80], cols.f[0][39], "group 0 stops at sample 49");
        let untagged = calc.try_gain_columns(10, 90, &[]).unwrap();
        assert_eq!(untagged.f.len(), 1);
        assert!((untagged.f[0][80] - cols.f[0][80] - cols.f[1][80]).abs() < 1e-9);
    }

    /// The flat WASM layout is `[y, a, f_0, …, f_{G−1}]`, each the window's
    /// length, and empty on a window `ve_gain` rejects.
    #[test]
    fn gain_columns_flat_layout_and_degenerate_window() {
        let calc = VirtualElevationCalculator::new(varied_ride(), windy_params());
        let groups: Vec<u8> = (0..N).map(|i| (i % 2) as u8).collect();
        let flat = calc.gain_columns(10, 90, &groups);
        let cols = calc.try_gain_columns(10, 90, &groups).unwrap();
        let n = cols.y.len();
        assert_eq!(flat.len(), 4 * n);
        assert_eq!(&flat[..n], &cols.y[..]);
        assert_eq!(&flat[n..2 * n], &cols.a[..]);
        assert_eq!(&flat[3 * n..], &cols.f[1][..]);
        assert!(calc.gain_columns(5, 6, &groups).is_empty());
        assert!(calc.try_gain_columns(5, 6, &groups).is_none());
    }
}
