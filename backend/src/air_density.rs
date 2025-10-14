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
}
