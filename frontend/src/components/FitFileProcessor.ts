export class FitFileProcessor {
  private wasmModule: any = null;
  private isInitialized: boolean = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('WASM already initialized, skipping...');
      return;
    }

    try {
      console.log('Starting WASM module import...');

      // Try multiple import strategies
      let wasmModule;

      // Use the alias import
      wasmModule = await import('@wasm/virtual_elevation_analyzer.js');
      console.log('✅ WASM imported via alias');

      console.log('WASM module imported successfully:', Object.keys(wasmModule));

      console.log('Initializing WASM...');
      // Initialize WASM - the default export is the init function
      if (typeof wasmModule.default === 'function') {
        await wasmModule.default();
        console.log('WASM default() called successfully');
      } else {
        console.warn('No default export found, checking for init function...');
        if (typeof wasmModule.init === 'function') {
          wasmModule.init();
          console.log('WASM init() called successfully');
        } else {
          throw new Error('No initialization function found in WASM module');
        }
      }

      // Store the module for later use
      this.wasmModule = wasmModule;
      this.isInitialized = true;

      console.log('✅ WASM module initialized successfully');
    } catch (error) {
      console.error('❌ Failed to load WASM module:', error);
      console.error('Error details:', {
        message: error?.message,
        stack: error?.stack,
        name: error?.name
      });
      throw new Error(`Failed to initialize WebAssembly module: ${error?.message || error}`);
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
      console.error('Error processing FIT file:', error);
      throw error;
    }
  }
}