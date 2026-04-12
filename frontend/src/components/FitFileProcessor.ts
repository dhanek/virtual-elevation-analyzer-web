import { log } from '../utils/log';
export class FitFileProcessor {
  private wasmModule: any = null;
  private isInitialized: boolean = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      log.debug('WASM already initialized, skipping...');
      return;
    }

    try {
      log.debug('Starting WASM module import...');

      // Try multiple import strategies
      let wasmModule;

      // Use the alias import
      wasmModule = await import('@wasm/virtual_elevation_analyzer.js');
      log.debug('✅ WASM imported via alias');

      log.debug('WASM module imported successfully:', Object.keys(wasmModule));

      log.debug('Initializing WASM...');
      // Initialize WASM - the default export is the init function
      if (typeof wasmModule.default === 'function') {
        await wasmModule.default();
        log.debug('WASM default() called successfully');
      } else {
        log.warn('No default export found, checking for init function...');
        if (typeof wasmModule.init === 'function') {
          wasmModule.init();
          log.debug('WASM init() called successfully');
        } else {
          throw new Error('No initialization function found in WASM module');
        }
      }

      // Store the module for later use
      this.wasmModule = wasmModule;
      this.isInitialized = true;

      log.debug('✅ WASM module initialized successfully');
    } catch (error) {
      log.error('❌ Failed to load WASM module:', error);
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Error details:', {
        message: err.message,
        stack: err.stack,
        name: err.name
      });
      throw new Error(`Failed to initialize WebAssembly module: ${err.message}`);
    }
  }

  async processFitFile(file: File): Promise<any> {
    if (!this.wasmModule) {
      throw new Error('WASM module not initialized');
    }

    try {
      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Parse using WASM
      const result = this.wasmModule.parse_fit_file(uint8Array);

      return {
        fit_data: result.fit_data,
        laps: result.laps,
        parsing_statistics: result.parsing_statistics
      };
    } catch (error) {
      log.error('Error processing FIT file:', error);
      throw error;
    }
  }
}