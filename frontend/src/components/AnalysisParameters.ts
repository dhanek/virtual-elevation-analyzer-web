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
    wind_speed_unit: 'm/s' | 'km/h';
    air_speed_offset: number;  // seconds - time offset for air speed data synchronization
    velodrome: boolean;
    auto_lap_detection: 'None' | 'GPS based lap splitting' | 'GPS based out and back' | 'GPS gate one way';
    auto_calculate_rho: boolean;
    rho_source?: 'manual' | 'weather_api' | 'weather_cache';
    weather_metadata?: {
        temperature: number;
        dewPoint: number;
        pressure: number;
        windSpeed?: number;  // Optional for backward compatibility with old cache entries
        windDirection?: number;  // Optional for backward compatibility with old cache entries
        location: { lat: number; lon: number };
        timestamp: string;
        source: 'api' | 'cache';
    };
}

export const DEFAULT_PARAMETERS: AnalysisParameters = {
    system_mass: 75.0,     // kg - typical rider + bike weight
    rho: 1.225,            // kg/m³ - air density at sea level, 15°C
    eta: 0.97,             // drivetrain efficiency (97%)
    cda: null,             // null = optimize
    crr: null,             // null = optimize
    cda_min: 0.15,         // m² - aerodynamic drag bounds
    cda_max: 0.50,
    crr_min: 0.002,        // rolling resistance bounds
    crr_max: 0.015,
    wind_speed: null,      // m/s - null = no wind
    wind_direction: null,  // degrees - null = no wind
    wind_speed_unit: 'm/s',// unit for wind speed display
    air_speed_offset: 2,   // seconds - default: shift air speed 2s later for better sync
    velodrome: false,      // zero altitude for track cycling
    auto_lap_detection: 'None',
    auto_calculate_rho: false,  // auto-calculate rho from weather data
    rho_source: 'manual'
};

export class AnalysisParametersComponent {
    private container: HTMLElement;
    private parameters: AnalysisParameters;
    private onParametersChange: (params: AnalysisParameters) => void;

    constructor(containerId: string, onParametersChange: (params: AnalysisParameters) => void) {
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

                    <div class="param-item checkbox-item">
                        <label for="auto_calculate_rho">
                            <input type="checkbox" id="auto_calculate_rho" ${this.parameters.auto_calculate_rho ? 'checked' : ''}>
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

                <div class="param-compact-grid" style="margin-top: 1rem;">
                    <div class="param-item">
                        <label for="wind_speed">Wind Speed:</label>
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            <input type="number" id="wind_speed" min="0" max="30" step="0.1"
                                   placeholder="Optional" title="Wind speed (constant value)" style="flex: 1;">
                            <select id="wind_speed_unit" style="width: 70px;" title="Wind speed unit">
                                <option value="m/s" ${this.parameters.wind_speed_unit === 'm/s' ? 'selected' : ''}>m/s</option>
                                <option value="km/h" ${this.parameters.wind_speed_unit === 'km/h' ? 'selected' : ''}>km/h</option>
                            </select>
                        </div>
                    </div>

                    <div class="param-item">
                        <label for="wind_direction">Wind Direction (°):</label>
                        <input type="number" id="wind_direction" min="0" max="360" step="1"
                               placeholder="Optional" title="Direction wind is coming FROM (0°=N, 90°=E, 180°=S, 270°=W)">
                    </div>

                    <div class="param-item checkbox-item">
                        <label for="velodrome">
                            <input type="checkbox" id="velodrome" ${this.parameters.velodrome ? 'checked' : ''}>
                            Velodrome (Zero Altitude)
                        </label>
                    </div>

                    <div class="param-item">
                        <label for="auto_lap_detection">Auto Lap Detection:</label>
                        <select id="auto_lap_detection">
                            <option value="None">None</option>
                            <option value="GPS based lap splitting">GPS based lap splitting</option>
                            <option value="GPS based out and back">GPS based out and back</option>
                            <option value="GPS gate one way">GPS gate one way</option>
                        </select>
                    </div>
                </div>

                <div id="weather_info_container" style="display: none; margin-top: 1rem; padding: 0.75rem; background: #f5f5f5; border-radius: 4px; border-left: 3px solid #4CAF50;">
                    <div style="font-size: 0.9em; color: #666;">
                        <strong>Weather Data:</strong>
                        <span id="weather_temp" style="margin-left: 0.5rem;">--</span>°C,
                        <span id="weather_pressure" style="margin-left: 0.25rem;">--</span> hPa,
                        Dew Point: <span id="weather_dewpoint">--</span>°C
                        <span id="weather_source" style="margin-left: 0.5rem; padding: 2px 6px; border-radius: 3px; font-size: 0.85em; background: #e0e0e0;">--</span>
                    </div>
                    <div style="font-size: 0.85em; color: #666; margin-top: 0.25rem;">
                        <strong>Wind:</strong>
                        <span id="weather_windspeed" style="margin-left: 0.5rem;">--</span> m/s,
                        Direction: <span id="weather_winddirection">--</span>°
                    </div>
                    <div style="font-size: 0.85em; color: #888; margin-top: 0.25rem;">
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
        const inputs = this.container.querySelectorAll('input, select');

        inputs.forEach(input => {
            input.addEventListener('input', () => this.handleParameterChange());
        });

        // Reset button
        const resetBtn = this.container.querySelector('#resetParams');
        resetBtn?.addEventListener('click', () => this.resetParameters());
    }

    private handleParameterChange(): void {
        // Read all values from the form
        const getValue = (id: string): string => {
            const element = this.container.querySelector(`#${id}`) as HTMLInputElement;
            return element?.value || '';
        };

        const getNumberValue = (id: string): number | null => {
            const value = getValue(id);
            return value === '' ? null : parseFloat(value);
        };

        const getBooleanValue = (id: string): boolean => {
            const element = this.container.querySelector(`#${id}`) as HTMLInputElement;
            return element?.checked || false;
        };

        // Get wind speed and convert to m/s if needed
        const windSpeedUnit = getValue('wind_speed_unit') as 'm/s' | 'km/h';
        let windSpeedValue = getNumberValue('wind_speed');

        // Convert km/h to m/s for internal storage
        if (windSpeedValue !== null && windSpeedUnit === 'km/h') {
            windSpeedValue = windSpeedValue / 3.6;
        }

        // Update parameters
        this.parameters = {
            system_mass: getNumberValue('system_mass') || DEFAULT_PARAMETERS.system_mass,
            rho: getNumberValue('rho') || DEFAULT_PARAMETERS.rho,
            eta: getNumberValue('eta') || DEFAULT_PARAMETERS.eta,
            cda: getNumberValue('cda'),
            crr: getNumberValue('crr'),
            cda_min: getNumberValue('cda_min') || DEFAULT_PARAMETERS.cda_min,
            cda_max: getNumberValue('cda_max') || DEFAULT_PARAMETERS.cda_max,
            crr_min: getNumberValue('crr_min') || DEFAULT_PARAMETERS.crr_min,
            crr_max: getNumberValue('crr_max') || DEFAULT_PARAMETERS.crr_max,
            wind_speed: windSpeedValue,
            wind_direction: getNumberValue('wind_direction'),
            wind_speed_unit: windSpeedUnit,
            air_speed_offset: getNumberValue('air_speed_offset') || DEFAULT_PARAMETERS.air_speed_offset,
            velodrome: getBooleanValue('velodrome'),
            auto_lap_detection: getValue('auto_lap_detection') as AnalysisParameters['auto_lap_detection'],
            auto_calculate_rho: getBooleanValue('auto_calculate_rho'),
            rho_source: this.parameters.rho_source || 'manual',
            weather_metadata: this.parameters.weather_metadata
        };

        // Validate and notify
        this.validateParameters();
        this.onParametersChange(this.parameters);
    }

    private validateParameters(): void {
        // Basic validation - just check parameter validity, no button control
        const isValid =
            this.parameters.system_mass > 0 &&
            this.parameters.rho > 0 &&
            this.parameters.eta > 0 &&
            this.parameters.cda_min < this.parameters.cda_max &&
            this.parameters.crr_min < this.parameters.crr_max;

        // Update wind direction visibility based on wind speed
        const windDirection = this.container.querySelector('#wind_direction') as HTMLInputElement;
        const windSpeed = this.parameters.wind_speed;

        if (windDirection) {
            windDirection.disabled = windSpeed === null || windSpeed === 0;
            if (windDirection.disabled) {
                windDirection.value = '';
                windDirection.placeholder = 'Requires wind speed';
            } else {
                windDirection.placeholder = 'Optional';
            }
        }
    }

    private updateUI(): void {
        // Update all input values
        const setValue = (id: string, value: any) => {
            const element = this.container.querySelector(`#${id}`) as HTMLInputElement;
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = value;
                } else if (value !== null) {
                    element.value = value.toString();
                } else {
                    element.value = '';
                }
            }
        };

        // Convert wind speed from m/s to selected unit for display
        let displayWindSpeed = this.parameters.wind_speed;
        if (displayWindSpeed !== null && this.parameters.wind_speed_unit === 'km/h') {
            displayWindSpeed = displayWindSpeed * 3.6;
        }

        setValue('system_mass', this.parameters.system_mass);
        setValue('rho', this.parameters.rho);
        setValue('eta', this.parameters.eta);
        setValue('cda', this.parameters.cda);
        setValue('crr', this.parameters.crr);
        setValue('cda_min', this.parameters.cda_min);
        setValue('cda_max', this.parameters.cda_max);
        setValue('crr_min', this.parameters.crr_min);
        setValue('crr_max', this.parameters.crr_max);
        setValue('wind_speed', displayWindSpeed);
        setValue('wind_direction', this.parameters.wind_direction);
        setValue('wind_speed_unit', this.parameters.wind_speed_unit);
        setValue('air_speed_offset', this.parameters.air_speed_offset);
        setValue('velodrome', this.parameters.velodrome);
        setValue('auto_lap_detection', this.parameters.auto_lap_detection);
        setValue('auto_calculate_rho', this.parameters.auto_calculate_rho);

        // Update weather info display if available
        this.updateWeatherInfoDisplay();

        this.validateParameters();
    }

    /**
     * Update weather information display panel
     */
    private updateWeatherInfoDisplay(): void {
        const weatherInfoContainer = this.container.querySelector('#weather_info_container') as HTMLElement;

        if (!weatherInfoContainer) return;

        if (this.parameters.weather_metadata) {
            const metadata = this.parameters.weather_metadata;

            // Show the weather info container
            weatherInfoContainer.style.display = 'block';

            // Update values
            const tempSpan = this.container.querySelector('#weather_temp');
            const pressureSpan = this.container.querySelector('#weather_pressure');
            const dewpointSpan = this.container.querySelector('#weather_dewpoint');
            const windSpeedSpan = this.container.querySelector('#weather_windspeed');
            const windDirectionSpan = this.container.querySelector('#weather_winddirection');
            const sourceSpan = this.container.querySelector('#weather_source');
            const locationSpan = this.container.querySelector('#weather_location');
            const timestampSpan = this.container.querySelector('#weather_timestamp');

            if (tempSpan) tempSpan.textContent = metadata.temperature.toFixed(1);
            if (pressureSpan) pressureSpan.textContent = metadata.pressure.toFixed(1);
            if (dewpointSpan) dewpointSpan.textContent = metadata.dewPoint.toFixed(1);
            if (windSpeedSpan) windSpeedSpan.textContent = metadata.windSpeed !== undefined ? metadata.windSpeed.toFixed(1) : '--';
            if (windDirectionSpan) windDirectionSpan.textContent = metadata.windDirection !== undefined ? metadata.windDirection.toFixed(0) : '--';

            if (sourceSpan) {
                const isCached = metadata.source === 'cache';
                sourceSpan.textContent = isCached ? '💾 Cached' : '⬇️ API';
                sourceSpan.style.background = isCached ? '#e3f2fd' : '#fff3e0';
                sourceSpan.style.color = isCached ? '#1976d2' : '#e65100';
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
            weatherInfoContainer.style.display = 'none';
        }
    }

    private resetParameters(): void {
        this.parameters = { ...DEFAULT_PARAMETERS };
        this.updateUI();
        this.onParametersChange(this.parameters);
    }

    public isValid(): boolean {
        return this.parameters.system_mass > 0 &&
               this.parameters.rho > 0 &&
               this.parameters.eta > 0 &&
               this.parameters.cda_min < this.parameters.cda_max &&
               this.parameters.crr_min < this.parameters.crr_max;
    }
}