// Simple test script to verify WASM module works
import init, { parse_fit_file } from './backend/pkg/virtual_elevation_analyzer.js';

async function testWasm() {
    try {
        console.log('Initializing WASM module...');
        await init();
        console.log('✅ WASM module initialized successfully!');

        // Create test FIT file data (minimal valid header)
        const testData = new Uint8Array([
            12,    // header size
            16,    // protocol version
            1, 0,  // profile version (little endian)
            100, 0, 0, 0,  // data size (little endian)
            46, 70, 73, 84  // ".FIT" signature
        ]);

        console.log('Testing FIT file parsing...');
        const result = parse_fit_file(testData);
        console.log('✅ FIT file parsed successfully!');
        console.log('Statistics:', {
            fileSize: result.parsing_statistics.file_size,
            recordCount: result.parsing_statistics.record_count,
            lapCount: result.parsing_statistics.lap_count,
            hasPowerData: result.parsing_statistics.has_power_data,
            hasGpsData: result.parsing_statistics.has_gps_data
        });

    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

testWasm();