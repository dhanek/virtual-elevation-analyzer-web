use wasm_bindgen::prelude::*;

// Gas constants (J/(kg·K))
const RD: f64 = 287.0531;  // Specific gas constant for dry air
const RV: f64 = 461.4964;  // Specific gas constant for water vapor

/// Air density calculator using meteorological data
/// Based on formulas from https://www.gribble.org/cycling/air_density.html
#[wasm_bindgen]
pub struct AirDensityCalculator;

#[wasm_bindgen]
impl AirDensityCalculator {

    /// Calculate saturation vapor pressure using Tetens formula
    ///
    /// # Arguments
    /// * `temp_c` - Temperature in Celsius
    ///
    /// # Returns
    /// Saturation vapor pressure in hPa (hectopascals)
    #[wasm_bindgen]
    pub fn saturation_vapor_pressure(temp_c: f64) -> f64 {
        // Tetens formula: Es = 6.1078 * exp(17.27 * T / (T + 237.3))
        6.1078 * (17.27 * temp_c / (temp_c + 237.3)).exp()
    }

    /// Calculate dew point temperature from temperature and relative humidity
    /// Uses Magnus-Tetens approximation
    ///
    /// # Arguments
    /// * `temp_c` - Air temperature in Celsius
    /// * `humidity_percent` - Relative humidity in percent (0-100)
    ///
    /// # Returns
    /// Dew point temperature in Celsius
    ///
    /// # Errors
    /// Returns error if inputs are invalid
    #[wasm_bindgen]
    pub fn calculate_dew_point(temp_c: f64, humidity_percent: f64) -> Result<f64, JsValue> {
        // Validate inputs
        if !temp_c.is_finite() || !humidity_percent.is_finite() {
            return Err(JsValue::from_str("Invalid input: non-finite values"));
        }

        if humidity_percent < 0.0 || humidity_percent > 100.0 {
            return Err(JsValue::from_str(
                &format!("Invalid humidity: {}% (must be 0-100%)", humidity_percent)
            ));
        }

        if temp_c < -100.0 || temp_c > 60.0 {
            return Err(JsValue::from_str(
                &format!("Invalid temperature: {}°C (must be -100 to 60°C)", temp_c)
            ));
        }

        // Magnus-Tetens constants
        const A: f64 = 17.27;
        const B: f64 = 237.3;

        // Calculate gamma = ln(RH/100) + (a*T)/(b+T)
        let rh_fraction = humidity_percent / 100.0;
        let gamma = rh_fraction.ln() + (A * temp_c) / (B + temp_c);

        // Calculate dew point: Td = (b * gamma) / (a - gamma)
        let dew_point = (B * gamma) / (A - gamma);

        // Sanity check
        if !dew_point.is_finite() {
            return Err(JsValue::from_str("Dew point calculation resulted in invalid value"));
        }

        // Dew point must be <= temperature
        if dew_point > temp_c + 0.1 {
            return Err(JsValue::from_str(
                &format!("Calculated dew point ({}°C) exceeds temperature ({}°C)", dew_point, temp_c)
            ));
        }

        Ok(dew_point)
    }

    /// Calculate air density using meteorological data
    ///
    /// Implementation follows the formula from gribble.org:
    /// 1. Calculate water vapor pressure (Pv) from dew point
    /// 2. Calculate dry air pressure: Pd = P - Pv
    /// 3. Calculate air density: Rho = (Pd / (Rd × Tk)) + (Pv / (Rv × Tk))
    ///
    /// # Arguments
    /// * `temp_c` - Air temperature in Celsius
    /// * `pressure_hpa` - Air pressure in hPa (hectopascals)
    /// * `dew_point_c` - Dew point temperature in Celsius
    ///
    /// # Returns
    /// Air density in kg/m³
    ///
    /// # Errors
    /// Returns error if inputs are invalid or out of reasonable ranges
    #[wasm_bindgen]
    pub fn calculate_air_density(
        temp_c: f64,
        pressure_hpa: f64,
        dew_point_c: f64
    ) -> Result<f64, JsValue> {
        // Validate inputs
        if !temp_c.is_finite() || !pressure_hpa.is_finite() || !dew_point_c.is_finite() {
            return Err(JsValue::from_str("Invalid input: non-finite values"));
        }

        // Validate pressure range (reasonable atmospheric pressure)
        if pressure_hpa <= 0.0 || pressure_hpa > 1100.0 {
            return Err(JsValue::from_str(
                &format!("Invalid pressure: {} hPa (must be 0-1100 hPa)", pressure_hpa)
            ));
        }

        // Validate temperature range
        if temp_c < -100.0 || temp_c > 60.0 {
            return Err(JsValue::from_str(
                &format!("Invalid temperature: {}°C (must be -100 to 60°C)", temp_c)
            ));
        }

        // Dew point must be <= temperature
        if dew_point_c > temp_c {
            return Err(JsValue::from_str(
                &format!("Dew point ({}°C) cannot exceed temperature ({}°C)", dew_point_c, temp_c)
            ));
        }

        // Convert temperature to Kelvin
        let temp_k = temp_c + 273.15;

        // Step 1: Calculate water vapor pressure from dew point
        // At the dew point, the air is saturated, so Pv = Es(dew_point)
        let pv_hpa = Self::saturation_vapor_pressure(dew_point_c);

        // Step 2: Calculate dry air pressure
        let pd_hpa = pressure_hpa - pv_hpa;

        // Convert from hPa to Pa (pascals) for gas law calculations
        let pd_pa = pd_hpa * 100.0;
        let pv_pa = pv_hpa * 100.0;

        // Step 3: Calculate air density using ideal gas law
        // For dry air:    Pd = ρd * Rd * T  =>  ρd = Pd / (Rd * T)
        // For water vapor: Pv = ρv * Rv * T  =>  ρv = Pv / (Rv * T)
        // Total density: ρ = ρd + ρv
        let rho = (pd_pa / (RD * temp_k)) + (pv_pa / (RV * temp_k));

        // Sanity check result
        if !rho.is_finite() || rho < 0.5 || rho > 2.0 {
            return Err(JsValue::from_str(
                &format!("Calculated air density out of range: {} kg/m³", rho)
            ));
        }

        Ok(rho)
    }

    /// Calculate air density from temperature, humidity, and pressure
    /// This is a convenience function that combines dew point calculation with air density calculation
    ///
    /// # Arguments
    /// * `temp_c` - Air temperature in Celsius
    /// * `pressure_hpa` - Air pressure in hPa (hectopascals)
    /// * `humidity_percent` - Relative humidity in percent (0-100)
    ///
    /// # Returns
    /// Air density in kg/m³
    ///
    /// # Errors
    /// Returns error if inputs are invalid
    #[wasm_bindgen]
    pub fn calculate_air_density_from_humidity(
        temp_c: f64,
        pressure_hpa: f64,
        humidity_percent: f64
    ) -> Result<f64, JsValue> {
        // First calculate dew point from temperature and humidity
        let dew_point = Self::calculate_dew_point(temp_c, humidity_percent)?;

        // Then calculate air density using dew point
        Self::calculate_air_density(temp_c, pressure_hpa, dew_point)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_saturation_vapor_pressure() {
        // At 15°C, Es ≈ 17.04 hPa
        let es = AirDensityCalculator::saturation_vapor_pressure(15.0);
        assert!((es - 17.04).abs() < 0.1);

        // At 0°C, Es ≈ 6.11 hPa
        let es = AirDensityCalculator::saturation_vapor_pressure(0.0);
        assert!((es - 6.11).abs() < 0.1);
    }

    #[test]
    fn test_standard_atmosphere() {
        // Standard atmosphere at sea level: 15°C, 1013.25 hPa, 50% relative humidity
        // Dew point at 50% RH and 15°C ≈ 4.7°C
        let rho = AirDensityCalculator::calculate_air_density(15.0, 1013.25, 4.7).unwrap();

        // Expected: ~1.225 kg/m³ (standard air density)
        assert!((rho - 1.225).abs() < 0.01);
    }

    #[test]
    fn test_dry_air() {
        // Very dry air (dew point much lower than temp)
        let rho = AirDensityCalculator::calculate_air_density(20.0, 1013.25, -10.0).unwrap();

        // Should be close to dry air density (~1.2 kg/m³)
        assert!(rho > 1.18 && rho < 1.22);
    }

    #[test]
    fn test_high_humidity() {
        // High humidity (dew point close to temperature)
        let rho = AirDensityCalculator::calculate_air_density(25.0, 1013.25, 23.0).unwrap();

        // Humid air is less dense than dry air
        assert!(rho > 1.15 && rho < 1.19);
    }

    #[test]
    fn test_invalid_dew_point() {
        // Dew point cannot exceed temperature
        let result = AirDensityCalculator::calculate_air_density(15.0, 1013.25, 20.0);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_pressure() {
        let result = AirDensityCalculator::calculate_air_density(15.0, 1500.0, 10.0);
        assert!(result.is_err());

        let result = AirDensityCalculator::calculate_air_density(15.0, -10.0, 10.0);
        assert!(result.is_err());
    }

    #[test]
    fn test_extreme_temperatures() {
        // Cold weather
        let rho = AirDensityCalculator::calculate_air_density(-20.0, 1013.25, -25.0).unwrap();
        assert!(rho > 1.3 && rho < 1.4); // Cold air is denser

        // Hot weather
        let rho = AirDensityCalculator::calculate_air_density(40.0, 1013.25, 20.0).unwrap();
        assert!(rho > 1.0 && rho < 1.15); // Hot air is less dense
    }

    #[test]
    fn test_high_altitude() {
        // High altitude: lower pressure (~700 hPa at 3000m)
        let rho = AirDensityCalculator::calculate_air_density(10.0, 700.0, 0.0).unwrap();
        assert!(rho > 0.8 && rho < 0.9); // Much less dense at altitude
    }

    #[test]
    fn test_dew_point_calculation() {
        // At 20°C and 50% RH, dew point should be around 9.3°C
        let dp = AirDensityCalculator::calculate_dew_point(20.0, 50.0).unwrap();
        assert!((dp - 9.3).abs() < 0.5, "Dew point at 20°C, 50% RH should be ~9.3°C, got {}", dp);

        // At 25°C and 60% RH, dew point should be around 16.7°C
        let dp = AirDensityCalculator::calculate_dew_point(25.0, 60.0).unwrap();
        assert!((dp - 16.7).abs() < 0.5, "Dew point at 25°C, 60% RH should be ~16.7°C, got {}", dp);

        // At 100% RH, dew point should equal temperature
        let dp = AirDensityCalculator::calculate_dew_point(15.0, 100.0).unwrap();
        assert!((dp - 15.0).abs() < 0.1, "Dew point at 100% RH should equal temperature");
    }

    #[test]
    fn test_dew_point_edge_cases() {
        // Very dry air (low humidity)
        let dp = AirDensityCalculator::calculate_dew_point(20.0, 10.0).unwrap();
        assert!(dp < 0.0, "Dew point at 20°C, 10% RH should be below 0°C");

        // Invalid humidity
        let result = AirDensityCalculator::calculate_dew_point(20.0, 150.0);
        assert!(result.is_err());

        let result = AirDensityCalculator::calculate_dew_point(20.0, -10.0);
        assert!(result.is_err());
    }

    #[test]
    fn test_air_density_from_humidity() {
        // Test the convenience function that combines dew point and air density calculations
        // At 15°C, 1013.25 hPa, 50% RH
        let rho = AirDensityCalculator::calculate_air_density_from_humidity(15.0, 1013.25, 50.0).unwrap();

        // Should be close to standard air density
        assert!((rho - 1.225).abs() < 0.01, "Air density at standard conditions should be ~1.225 kg/m³");

        // Hot and humid: 30°C, 1013 hPa, 80% RH
        let rho = AirDensityCalculator::calculate_air_density_from_humidity(30.0, 1013.0, 80.0).unwrap();
        assert!(rho > 1.10 && rho < 1.18, "Hot humid air should be less dense");

        // Cold and dry: 0°C, 1013 hPa, 30% RH
        let rho = AirDensityCalculator::calculate_air_density_from_humidity(0.0, 1013.0, 30.0).unwrap();
        assert!(rho > 1.25 && rho < 1.30, "Cold dry air should be more dense");
    }
}
