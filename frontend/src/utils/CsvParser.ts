/**
 * CSV Parser for Gibli Aerosensor data
 * Parses CSV files with cycling sensor data and converts to unified format
 */

export interface GibliCsvData {
    // Time series data (all arrays have same length after interpolation)
    timestamps: number[];           // seconds
    velocity: number[];             // m/s (ground speed)
    power: number[];                // watts
    airSpeed: number[];             // m/s (wind magnitude converted)
    windAngle: number[];            // degrees
    altitude: number[];             // meters
    positionLat: number[];          // decimal degrees
    positionLong: number[];         // decimal degrees

    // Environmental data (optional, for rho calculation)
    temperature?: number[];         // °C
    humidity?: number[];            // % RH
    pressure?: number[];            // hPa

    // Reference data
    cdaReference?: number[];        // Reference CdA values (may contain NaN)
    lapNumber?: number[];           // Lap number for each data point

    // Metadata
    hasEnvironmentalData: boolean;  // Temperature, humidity, pressure all present
    hasCdaReference: boolean;       // CdA column present and has valid data
    hasLapData: boolean;            // Lap Number column present
    hasWindAngle: boolean;          // Wind Angle column present

    // Statistics
    dataPointCount: number;
    timeRangeSeconds: number;
}

export interface CsvColumn {
    name: string;
    required: boolean;
    unit?: string;
}

export class CsvParseError extends Error {
    constructor(message: string, public details?: any) {
        super(message);
        this.name = 'CsvParseError';
    }
}

export class GibliCsvParser {
    // Required columns for basic analysis
    private static readonly REQUIRED_COLUMNS: CsvColumn[] = [
        { name: 'Timer (ms)', required: true, unit: 'ms' },
        { name: 'ANT+ Speed (cm/s)', required: true, unit: 'cm/s' },
        { name: 'Power (w)', required: true, unit: 'w' },
        { name: 'Wind Magnitude (km/h)', required: true, unit: 'km/h' },
        { name: 'Latitude', required: true, unit: 'scaled' },
        { name: 'Longitude', required: true, unit: 'scaled' },
        { name: 'GPS Altitude (mm)', required: true, unit: 'mm' },
    ];

    // Optional columns that enhance analysis
    private static readonly OPTIONAL_COLUMNS: CsvColumn[] = [
        { name: 'Temperature', required: false, unit: '°C' },
        { name: 'Humidity (%RH)', required: false, unit: '%' },
        { name: 'Barometric Pressure (Pa)', required: false, unit: 'Pa' },
        { name: 'Wind Angle (deg)', required: false, unit: 'deg' },
        { name: 'CdA', required: false },
        { name: 'Lap Number', required: false },
    ];

    /**
     * Parse CSV file content into structured data
     */
    static parse(csvContent: string): GibliCsvData {
        const lines = csvContent.trim().split('\n');

        if (lines.length < 2) {
            throw new CsvParseError('CSV file is empty or has no data rows');
        }

        // Parse header
        const header = lines[0].split(',').map(h => h.trim());

        // Validate required columns
        this.validateColumns(header);

        // Parse data rows
        const rows = lines.slice(1).map((line, index) => {
            const values = line.split(',');
            if (values.length !== header.length) {
                console.warn(`Row ${index + 2} has ${values.length} columns, expected ${header.length}`);
            }
            return values;
        });

        // Extract and convert data
        const rawData = this.extractRawData(header, rows);

        // Convert units
        const convertedData = this.convertUnits(rawData);

        // Check for optional features
        const metadata = this.analyzeMetadata(rawData, convertedData);

        return {
            ...convertedData,
            ...metadata,
            dataPointCount: convertedData.timestamps.length,
            timeRangeSeconds: convertedData.timestamps[convertedData.timestamps.length - 1] - convertedData.timestamps[0]
        };
    }

    /**
     * Validate that all required columns are present
     */
    private static validateColumns(header: string[]): void {
        const missingColumns: string[] = [];

        for (const col of this.REQUIRED_COLUMNS) {
            if (!header.includes(col.name)) {
                missingColumns.push(col.name);
            }
        }

        if (missingColumns.length > 0) {
            const message = `Missing required columns:\n${missingColumns.map(c => `  - ${c}`).join('\n')}`;
            throw new CsvParseError(message, { missingColumns });
        }
    }

    /**
     * Extract raw data from CSV rows
     */
    private static extractRawData(header: string[], rows: string[][]): Record<string, number[]> {
        const data: Record<string, number[]> = {};

        // Initialize arrays for all columns we care about
        const allColumns = [...this.REQUIRED_COLUMNS, ...this.OPTIONAL_COLUMNS];

        for (const col of allColumns) {
            const columnIndex = header.indexOf(col.name);
            if (columnIndex !== -1) {
                data[col.name] = rows.map(row => {
                    const value = row[columnIndex]?.trim();
                    if (!value || value === '' || value.toLowerCase() === 'nan') {
                        return NaN;
                    }
                    return parseFloat(value);
                });
            }
        }

        return data;
    }

    /**
     * Convert units to standard format
     */
    private static convertUnits(rawData: Record<string, number[]>): Omit<GibliCsvData, 'hasEnvironmentalData' | 'hasCdaReference' | 'hasLapData' | 'hasWindAngle' | 'dataPointCount' | 'timeRangeSeconds'> {
        const result: any = {};

        // Timer (ms) → timestamps (seconds)
        result.timestamps = rawData['Timer (ms)'].map(t => t / 1000);

        // ANT+ Speed (cm/s) → velocity (m/s)
        result.velocity = rawData['ANT+ Speed (cm/s)'].map(v => v / 100);

        // Power (w) → power (watts) - no conversion needed
        result.power = rawData['Power (w)'];

        // Wind Magnitude (km/h) → airSpeed (m/s)
        result.airSpeed = rawData['Wind Magnitude (km/h)'].map(w => w / 3.6);

        // GPS Altitude (mm) → altitude (meters)
        result.altitude = rawData['GPS Altitude (mm)'].map(a => a / 1000);

        // Latitude (scaled) → positionLat (decimal degrees)
        // Assuming format like 433858622.0 → 43.3858622°
        result.positionLat = rawData['Latitude'].map(lat => lat / 1e7);

        // Longitude (scaled) → positionLong (decimal degrees)
        result.positionLong = rawData['Longitude'].map(lon => lon / 1e7);

        // Optional: Wind Angle (deg) - no conversion needed
        if (rawData['Wind Angle (deg)']) {
            result.windAngle = rawData['Wind Angle (deg)'];
        } else {
            result.windAngle = [];
        }

        // Optional: Temperature (°C) - no conversion needed
        if (rawData['Temperature']) {
            result.temperature = rawData['Temperature'];
        }

        // Optional: Humidity (%RH) - no conversion needed
        if (rawData['Humidity (%RH)']) {
            result.humidity = rawData['Humidity (%RH)'];
        }

        // Optional: Barometric Pressure (Pa) → pressure (hPa)
        if (rawData['Barometric Pressure (Pa)']) {
            result.pressure = rawData['Barometric Pressure (Pa)'].map(p => p / 100);
        }

        // Optional: CdA reference - no conversion needed
        if (rawData['CdA']) {
            result.cdaReference = rawData['CdA'];
        }

        // Optional: Lap Number - no conversion needed
        if (rawData['Lap Number']) {
            result.lapNumber = rawData['Lap Number'];
        }

        return result;
    }

    /**
     * Analyze metadata about available data
     */
    private static analyzeMetadata(rawData: Record<string, number[]>, convertedData: any): Pick<GibliCsvData, 'hasEnvironmentalData' | 'hasCdaReference' | 'hasLapData' | 'hasWindAngle'> {
        // Check for environmental data (all three required for rho calculation)
        const hasTemperature = 'Temperature' in rawData;
        const hasHumidity = 'Humidity (%RH)' in rawData;
        const hasPressure = 'Barometric Pressure (Pa)' in rawData;
        const hasEnvironmentalData = hasTemperature && hasHumidity && hasPressure;

        // Check for CdA reference (column exists and has at least some valid data)
        const hasCdaReference = convertedData.cdaReference &&
                                convertedData.cdaReference.some((v: number) => !isNaN(v));

        // Check for lap data
        const hasLapData = convertedData.lapNumber !== undefined;

        // Check for wind angle
        const hasWindAngle = convertedData.windAngle && convertedData.windAngle.length > 0;

        return {
            hasEnvironmentalData,
            hasCdaReference,
            hasLapData,
            hasWindAngle
        };
    }

    /**
     * Get a summary of the parsed data for display
     */
    static getSummary(data: GibliCsvData): string {
        const lines = [
            `Data Points: ${data.dataPointCount}`,
            `Duration: ${(data.timeRangeSeconds / 60).toFixed(1)} minutes`,
            ``,
            `Features:`,
            `  ✅ Basic data (speed, power, GPS, air speed)`,
        ];

        if (data.hasEnvironmentalData) {
            lines.push(`  ✅ Environmental data (temperature, humidity, pressure)`);
        } else {
            lines.push(`  ⚠️  Environmental data (will use Weather API)`);
        }

        if (data.hasCdaReference) {
            const validCda = data.cdaReference!.filter(v => !isNaN(v));
            const avgCda = validCda.reduce((sum, v) => sum + v, 0) / validCda.length;
            lines.push(`  ✅ CdA reference (avg: ${avgCda.toFixed(3)})`);
        } else {
            lines.push(`  ℹ️  No CdA reference data`);
        }

        if (data.hasLapData) {
            const uniqueLaps = new Set(data.lapNumber!.filter(v => !isNaN(v)));
            lines.push(`  ✅ Lap data (${uniqueLaps.size} laps)`);
        } else {
            lines.push(`  ℹ️  No lap data`);
        }

        if (data.hasWindAngle) {
            lines.push(`  ✅ Wind angle data`);
        } else {
            lines.push(`  ⚠️  No wind angle data`);
        }

        return lines.join('\n');
    }
}
