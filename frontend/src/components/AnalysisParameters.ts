import {
	DEFAULT_WIND_HEIGHT_FACTOR,
	LEGACY_WIND_HEIGHT_FACTOR,
	type WindEntry,
} from "../analysis/WindHeightTransfer";

export interface AnalysisParameters {
	system_mass: number;
	rho: number;
	eta: number;
	cda: number | null;
	crr: number | null;
	cda_min: number;
	cda_max: number;
	crr_min: number;
	crr_max: number;
	wind_speed: number | null;
	wind_direction: number | null;
	wind_speed_unit: "m/s" | "km/h";
	air_speed_offset: number; // seconds - time offset for air speed data synchronization
	velodrome: boolean;
	// Note: auto_lap_detection removed - GPS mode is now controlled via Section 3 UI
	auto_calculate_rho: boolean;
	// Tire temperature compensation: slider Crr is referenced to 22 °C and the
	// VE physics uses Crr × factor(ambient_temp_c, tire_sensitivity) when enabled.
	crr_temp_correction?: boolean;
	ambient_temp_c?: number | null;
	tire_sensitivity?: "stiff" | "typical" | "supple";
	rho_source?: "manual" | "weather_api" | "weather_cache";
	// 10 m → rider wind height transfer (see analysis/WindHeightTransfer.ts).
	//
	// D-03: wind_speed keeps meaning "wind as reported, untransferred". The
	// field shows 3.5 when the API reported 3.5; the factor is applied
	// downstream at the WASM boundary. Applying it at store time was rejected:
	// it would make the stored value's meaning depend on provenance, require
	// rewriting state whenever the factor moves, and put the field in
	// disagreement with the weather panel.
	//
	// D-06 (amended): wind_entry records which input last wrote the wind — an
	// observable event, not a claim about what the number means. Deliberately
	// not named wind_source and deliberately not merged with rho_source, which
	// answers a staleness question instead. "unknown" exists for records saved
	// before this feature so a later auto-rho fill cannot be mistaken for a
	// first fill and re-seed a factor onto an analysis already read.
	wind_height_factor?: number;
	wind_entry?: WindEntry;
	weather_metadata?: {
		temperature: number;
		dewPoint: number;
		pressure: number;
		windSpeed?: number; // Optional for backward compatibility with old cache entries
		windDirection?: number; // Optional for backward compatibility with old cache entries
		location: { lat: number; lon: number };
		timestamp: string;
		source: "api" | "cache";
	};
}

export const DEFAULT_PARAMETERS: AnalysisParameters = {
	system_mass: 75.0, // kg - typical rider + bike weight
	rho: 1.225, // kg/m³ - air density at sea level, 15°C
	eta: 0.97, // drivetrain efficiency (97%)
	cda: null, // null = optimize
	crr: null, // null = optimize
	cda_min: 0.15, // m² - aerodynamic drag bounds
	cda_max: 0.5,
	crr_min: 0.002, // rolling resistance bounds
	crr_max: 0.015,
	wind_speed: null, // m/s - null = no wind
	wind_direction: null, // degrees - null = no wind
	wind_speed_unit: "m/s", // unit for wind speed display
	air_speed_offset: 2, // seconds - default: shift air speed 2s later for better sync
	velodrome: false, // zero altitude for track cycling
	// Note: auto_lap_detection removed - GPS mode is now controlled via Section 3 UI
	auto_calculate_rho: false, // auto-calculate rho from weather data
	rho_source: "manual",
	crr_temp_correction: false, // opt-in tire temperature compensation, never applied silently
	ambient_temp_c: null,
	tire_sensitivity: "typical",
	// D-02: maintainer-requested default of 0.5 for the height transfer.
	// D-07 overrides it to LEGACY_WIND_HEIGHT_FACTOR for records saved before
	// this feature — normalised on load in ParameterStorage.loadParameters,
	// not here, so the single read path stays the one home for that rule.
	wind_height_factor: DEFAULT_WIND_HEIGHT_FACTOR,
	// A freshly created record has no wind at all (wind_speed: null), so
	// nothing has written one yet and "manual" is correct: the first weather
	// fill then legitimately counts as a first fill and seeds the default.
	wind_entry: "manual",
};

export class AnalysisParametersComponent {
	private container: HTMLElement;
	private parameters: AnalysisParameters;
	private onParametersChange: (params: AnalysisParameters) => void;

	constructor(
		containerId: string,
		onParametersChange: (params: AnalysisParameters) => void,
	) {
		this.container = document.getElementById(containerId) as HTMLElement;
		this.parameters = { ...DEFAULT_PARAMETERS };
		this.onParametersChange = onParametersChange;

		if (!this.container) {
			throw new Error(`Container with id '${containerId}' not found`);
		}

		this.render();
	}

	public getParameters(): AnalysisParameters {
		return { ...this.parameters };
	}

	public setParameters(params: Partial<AnalysisParameters>): void {
		this.parameters = { ...this.parameters, ...params };
		this.updateUI();
		// Trigger the callback to update currentParameters in main.ts
		this.onParametersChange(this.parameters);
	}

	private render(): void {
		this.container.innerHTML = `
            <div class="analysis-parameters">
                <div class="param-compact-grid">
                    <div class="param-item">
                        <label for="system_mass">System Mass (kg):</label>
                        <input type="number" id="system_mass" min="30" max="200" step="0.1"
                               value="${this.parameters.system_mass}" title="Total weight of rider + bike">
                    </div>

                    <div class="param-item">
                        <label for="rho">Air Density (kg/m³):</label>
                        <input type="number" id="rho" min="0.5" max="2.0" step="0.001"
                               value="${this.parameters.rho}" title="Air density (1.225 at sea level, 15°C)">
                    </div>

                    <div class="param-item param-item--checkbox">
                        <label for="auto_calculate_rho">
                            <input type="checkbox" id="auto_calculate_rho" ${this.parameters.auto_calculate_rho ? "checked" : ""}>
                            Auto-calculate from weather
                        </label>
                    </div>

                    <div class="param-item">
                        <label for="eta">Drivetrain Efficiency:</label>
                        <input type="number" id="eta" min="0.8" max="1.0" step="0.01"
                               value="${this.parameters.eta}" title="Mechanical efficiency (0.97 = 97%)">
                    </div>

                    <div class="param-item">
                        <label for="cda">Fixed CdA (m²):</label>
                        <input type="number" id="cda" min="0.1" max="1.0" step="0.001"
                               placeholder="Empty for optimization" title="Drag coefficient × frontal area">
                    </div>

                    <div class="param-item">
                        <label for="crr">Fixed Crr:</label>
                        <input type="number" id="crr" min="0.001" max="0.1" step="0.0001"
                               placeholder="Empty for optimization" title="Rolling resistance coefficient">
                    </div>
                </div>

                <div class="bounds-section">
                    <div class="bounds-group">
                        <label>CdA Bounds (m²):</label>
                        <div class="bounds-inputs">
                            <input type="number" id="cda_min" min="0.1" max="1.0" step="0.001"
                                   value="${this.parameters.cda_min}" title="Minimum CdA for optimization">
                            <span>to</span>
                            <input type="number" id="cda_max" min="0.1" max="1.0" step="0.001"
                                   value="${this.parameters.cda_max}" title="Maximum CdA for optimization">
                        </div>
                    </div>

                    <div class="bounds-group">
                        <label>Crr Bounds:</label>
                        <div class="bounds-inputs">
                            <input type="number" id="crr_min" min="0.001" max="0.1" step="0.0001"
                                   value="${this.parameters.crr_min}" title="Minimum Crr for optimization">
                            <span>to</span>
                            <input type="number" id="crr_max" min="0.001" max="0.1" step="0.0001"
                                   value="${this.parameters.crr_max}" title="Maximum Crr for optimization">
                        </div>
                    </div>
                </div>

                <div class="param-compact-grid param-compact-grid--spaced">
                    <div class="param-item">
                        <label for="wind_speed">Wind Speed:</label>
                        <div class="param-item__row">
                            <input type="number" id="wind_speed" min="0" max="30" step="0.1"
                                   placeholder="Optional" title="Wind speed (constant value)">
                            <select id="wind_speed_unit" title="Wind speed unit">
                                <option value="m/s" ${this.parameters.wind_speed_unit === "m/s" ? "selected" : ""}>m/s</option>
                                <option value="km/h" ${this.parameters.wind_speed_unit === "km/h" ? "selected" : ""}>km/h</option>
                            </select>
                        </div>
                    </div>

                    <div class="param-item">
                        <label for="wind_direction">Wind Direction (°):</label>
                        <input type="number" id="wind_direction" min="0" max="360" step="1"
                               placeholder="Optional" title="Direction wind is coming FROM (0°=N, 90°=E, 180°=S, 270°=W)">
                    </div>

                    <div class="param-item param-item--checkbox">
                        <label for="velodrome">
                            <input type="checkbox" id="velodrome" ${this.parameters.velodrome ? "checked" : ""}>
                            Velodrome (Zero Altitude)
                        </label>
                    </div>

                    <!-- Note: GPS Analysis Mode moved to Section 3 UI -->
                </div>

                <div id="weather_info_container" class="weather-info hidden">
                    <div class="weather-info__line">
                        <strong>Weather Data:</strong>
                        <span id="weather_temp" class="weather-info__value">--</span>°C,
                        <span id="weather_pressure" class="weather-info__value weather-info__value--tight">--</span> hPa,
                        Dew Point: <span id="weather_dewpoint">--</span>°C
                        <span id="weather_source" class="weather-info__source">--</span>
                    </div>
                    <div class="weather-info__line weather-info__line--secondary">
                        <strong>Wind:</strong>
                        <span id="weather_windspeed" class="weather-info__value">--</span> m/s,
                        Direction: <span id="weather_winddirection">--</span>°
                    </div>
                    <div class="weather-info__line weather-info__line--meta">
                        Location: <span id="weather_location">--</span> |
                        Time: <span id="weather_timestamp">--</span>
                    </div>
                </div>

                <div class="param-actions">
                    <button id="resetParams" class="secondary-btn">Reset to Defaults</button>
                </div>
            </div>
        `;

		this.setupEventListeners();
		this.updateUI();
	}

	private setupEventListeners(): void {
		// Get all input elements
		const inputs = this.container.querySelectorAll("input, select");

		inputs.forEach((input) => {
			input.addEventListener("input", () => this.handleParameterChange());
		});

		// IN-02: these cannot ride on the shared handler above. That handler is
		// attached to *every* input and select in the container, so wiring the
		// D-05 signal there would set wind_entry = "manual" when the user edits
		// system_mass. The other half of the same fact is what makes these
		// listeners safe: a programmatic `element.value = ...` assignment (how
		// auto-rho fills the weather wind, and how updateUI rewrites the form)
		// does NOT dispatch an "input" event, so a weather fill cannot trip them.
		const windSpeedInput = this.container.querySelector(
			"#wind_speed",
		) as HTMLInputElement | null;
		const windDirectionInput = this.container.querySelector(
			"#wind_direction",
		) as HTMLInputElement | null;
		windSpeedInput?.addEventListener("input", () => this.markManualWindEntry());
		windDirectionInput?.addEventListener("input", () =>
			this.markManualWindEntry(),
		);

		// Reset button
		const resetBtn = this.container.querySelector("#resetParams");
		resetBtn?.addEventListener("click", () => this.resetParameters());
	}

	private handleParameterChange(): void {
		// Read all values from the form
		const getValue = (id: string): string => {
			const element = this.container.querySelector(
				`#${id}`,
			) as HTMLInputElement;
			return element?.value || "";
		};

		const getNumberValue = (id: string): number | null => {
			const value = getValue(id);
			return value === "" ? null : parseFloat(value);
		};

		const getBooleanValue = (id: string): boolean => {
			const element = this.container.querySelector(
				`#${id}`,
			) as HTMLInputElement;
			return element?.checked || false;
		};

		// Get wind speed and convert to m/s if needed
		const windSpeedUnit = getValue("wind_speed_unit") as "m/s" | "km/h";
		let windSpeedValue = getNumberValue("wind_speed");

		// Convert km/h to m/s for internal storage
		if (windSpeedValue !== null && windSpeedUnit === "km/h") {
			windSpeedValue = windSpeedValue / 3.6;
		}

		// Update parameters
		this.parameters = {
			system_mass:
				getNumberValue("system_mass") || DEFAULT_PARAMETERS.system_mass,
			rho: getNumberValue("rho") || DEFAULT_PARAMETERS.rho,
			eta: getNumberValue("eta") || DEFAULT_PARAMETERS.eta,
			cda: getNumberValue("cda"),
			crr: getNumberValue("crr"),
			cda_min: getNumberValue("cda_min") || DEFAULT_PARAMETERS.cda_min,
			cda_max: getNumberValue("cda_max") || DEFAULT_PARAMETERS.cda_max,
			crr_min: getNumberValue("crr_min") || DEFAULT_PARAMETERS.crr_min,
			crr_max: getNumberValue("crr_max") || DEFAULT_PARAMETERS.crr_max,
			wind_speed: windSpeedValue,
			wind_direction: getNumberValue("wind_direction"),
			wind_speed_unit: windSpeedUnit,
			air_speed_offset:
				getNumberValue("air_speed_offset") ||
				DEFAULT_PARAMETERS.air_speed_offset,
			velodrome: getBooleanValue("velodrome"),
			// Note: auto_lap_detection removed - GPS mode is now controlled via Section 3 UI
			auto_calculate_rho: getBooleanValue("auto_calculate_rho"),
			rho_source: this.parameters.rho_source || "manual",
			weather_metadata: this.parameters.weather_metadata,
			// Tire temp correction fields live in the VE sidebar, not this form -
			// carry them over so form edits don't drop them.
			crr_temp_correction: this.parameters.crr_temp_correction,
			ambient_temp_c: this.parameters.ambient_temp_c,
			tire_sensitivity: this.parameters.tire_sensitivity,
			// The height factor lives in the VE sidebar and wind_entry is written
			// by the dedicated wind listeners below - neither is rebuilt from this
			// form, so carry them over or every keystroke in the mass field
			// silently resets the factor to the fresh default and re-brands a
			// reopened legacy record ("unknown") as something it is not.
			wind_height_factor: this.parameters.wind_height_factor,
			wind_entry: this.parameters.wind_entry,
		};

		// Validate and notify
		this.validateParameters();
		this.onParametersChange(this.parameters);
	}

	// D-05: the app does not guess what a hand-typed wind means. The weather API
	// and the user write to the same input, and a typed number may be a 10 m
	// forecast or an anemometer reading taken at the rider. Inferring the height
	// from "the user touched the field" is a silent guess that is wrong for
	// roughly half of users. So a manual edit sets the factor to 1.0 - the
	// number is used exactly as typed - and the readout raises a warning; the
	// factor slider is the resolution mechanism, not this listener.
	//
	// This is also the way out of "unknown": a user who hand-types a wind on a
	// reopened legacy record has just told the app which input wrote it.
	private markManualWindEntry(): void {
		// Already in the target state - do not re-emit on every keystroke.
		if (
			this.parameters.wind_entry === "manual" &&
			this.parameters.wind_height_factor === LEGACY_WIND_HEIGHT_FACTOR
		) {
			return;
		}

		// Deliberately NOT this.setParameters(...): that calls updateUI(), which
		// rewrites #wind_speed.value from the parsed model, so a user midway
		// through typing "3." would have their input rewritten to "3" under the
		// cursor. This listener writes the model and re-emits, and leaves the
		// DOM exactly as the user left it.
		this.parameters = {
			...this.parameters,
			wind_entry: "manual",
			wind_height_factor: LEGACY_WIND_HEIGHT_FACTOR,
		};
		this.onParametersChange(this.parameters);
	}

	private validateParameters(): void {
		// Basic validation - just check parameter validity, no button control
		const _isValid =
			this.parameters.system_mass > 0 &&
			this.parameters.rho > 0 &&
			this.parameters.eta > 0 &&
			this.parameters.cda_min < this.parameters.cda_max &&
			this.parameters.crr_min < this.parameters.crr_max;
		void _isValid; // validation result used for future UI feedback

		// Update wind direction visibility based on wind speed
		const windDirection = this.container.querySelector(
			"#wind_direction",
		) as HTMLInputElement;
		const windSpeed = this.parameters.wind_speed;

		if (windDirection) {
			windDirection.disabled = windSpeed === null || windSpeed === 0;
			if (windDirection.disabled) {
				windDirection.value = "";
				windDirection.placeholder = "Requires wind speed";
			} else {
				windDirection.placeholder = "Optional";
			}
		}
	}

	private updateUI(): void {
		// Update all input values
		const setValue = (id: string, value: any) => {
			const element = this.container.querySelector(
				`#${id}`,
			) as HTMLInputElement;
			if (element) {
				if (element.type === "checkbox") {
					element.checked = value;
				} else if (value !== null) {
					element.value = value.toString();
				} else {
					element.value = "";
				}
			}
		};

		// Convert wind speed from m/s to selected unit for display
		let displayWindSpeed = this.parameters.wind_speed;
		if (
			displayWindSpeed !== null &&
			this.parameters.wind_speed_unit === "km/h"
		) {
			displayWindSpeed = displayWindSpeed * 3.6;
		}

		setValue("system_mass", this.parameters.system_mass);
		setValue("rho", this.parameters.rho);
		setValue("eta", this.parameters.eta);
		setValue("cda", this.parameters.cda);
		setValue("crr", this.parameters.crr);
		setValue("cda_min", this.parameters.cda_min);
		setValue("cda_max", this.parameters.cda_max);
		setValue("crr_min", this.parameters.crr_min);
		setValue("crr_max", this.parameters.crr_max);
		setValue("wind_speed", displayWindSpeed);
		setValue("wind_direction", this.parameters.wind_direction);
		setValue("wind_speed_unit", this.parameters.wind_speed_unit);
		setValue("air_speed_offset", this.parameters.air_speed_offset);
		setValue("velodrome", this.parameters.velodrome);
		setValue("auto_calculate_rho", this.parameters.auto_calculate_rho);

		// Update weather info display if available
		this.updateWeatherInfoDisplay();

		this.validateParameters();
	}

	/**
	 * Update weather information display panel
	 */
	private updateWeatherInfoDisplay(): void {
		const weatherInfoContainer = this.container.querySelector(
			"#weather_info_container",
		) as HTMLElement;

		if (!weatherInfoContainer) return;

		if (this.parameters.weather_metadata) {
			const metadata = this.parameters.weather_metadata;

			// Show the weather info container
			weatherInfoContainer.classList.remove("hidden");

			// Update values
			const tempSpan = this.container.querySelector("#weather_temp");
			const pressureSpan = this.container.querySelector("#weather_pressure");
			const dewpointSpan = this.container.querySelector("#weather_dewpoint");
			const windSpeedSpan = this.container.querySelector("#weather_windspeed");
			const windDirectionSpan = this.container.querySelector(
				"#weather_winddirection",
			);
			const sourceSpan = this.container.querySelector("#weather_source");
			const locationSpan = this.container.querySelector("#weather_location");
			const timestampSpan = this.container.querySelector("#weather_timestamp");

			if (tempSpan) tempSpan.textContent = metadata.temperature.toFixed(1);
			if (pressureSpan) pressureSpan.textContent = metadata.pressure.toFixed(1);
			if (dewpointSpan) dewpointSpan.textContent = metadata.dewPoint.toFixed(1);
			if (windSpeedSpan)
				windSpeedSpan.textContent =
					metadata.windSpeed !== undefined
						? metadata.windSpeed.toFixed(1)
						: "--";
			if (windDirectionSpan)
				windDirectionSpan.textContent =
					metadata.windDirection !== undefined
						? metadata.windDirection.toFixed(0)
						: "--";

			if (sourceSpan) {
				const isCached = metadata.source === "cache";
				sourceSpan.textContent = isCached ? "💾 Cached" : "⬇️ API";
				sourceSpan.classList.toggle("weather-info__source--cached", isCached);
				sourceSpan.classList.toggle("weather-info__source--api", !isCached);
			}

			if (locationSpan) {
				locationSpan.textContent = `${metadata.location.lat.toFixed(4)}, ${metadata.location.lon.toFixed(4)}`;
			}

			if (timestampSpan) {
				const date = new Date(metadata.timestamp);
				timestampSpan.textContent = date.toLocaleString();
			}
		} else {
			// Hide the weather info container
			weatherInfoContainer.classList.add("hidden");
		}
	}

	private resetParameters(): void {
		this.parameters = { ...DEFAULT_PARAMETERS };
		this.updateUI();
		this.onParametersChange(this.parameters);
	}

	public isValid(): boolean {
		return (
			this.parameters.system_mass > 0 &&
			this.parameters.rho > 0 &&
			this.parameters.eta > 0 &&
			this.parameters.cda_min < this.parameters.cda_max &&
			this.parameters.crr_min < this.parameters.crr_max
		);
	}
}
