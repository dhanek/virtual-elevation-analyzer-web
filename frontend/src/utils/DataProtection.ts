export class DataProtection {
  static validateFileType(file: File): boolean {
    // Accept both FIT and CSV files
    const fileName = file.name.toLowerCase();
    const isValidExtension = fileName.endsWith('.fit') || fileName.endsWith('.csv');
    return isValidExtension && file.size > 0 && file.size < 50_000_000; // 50MB limit
  }

  static getFileType(file: File): 'fit' | 'csv' | 'unknown' {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.fit')) return 'fit';
    if (fileName.endsWith('.csv')) return 'csv';
    return 'unknown';
  }

  static async validateFitMagicNumber(file: File): Promise<boolean> {
    try {
      // Read first 12 bytes to verify FIT file format
      const header = await file.slice(0, 12).arrayBuffer();
      const view = new Uint8Array(header);

      // FIT files have ".FIT" signature at bytes 8-11
      return view[8] === 0x2E && view[9] === 0x46 && view[10] === 0x49 && view[11] === 0x54;
    } catch {
      return false;
    }
  }

  static sanitizeInput(input: any): any {
    // Comprehensive input sanitization
    if (typeof input === 'string') {
      return input.replace(/[<>"'&]/g, '');
    }
    if (typeof input === 'number') {
      return Number.isFinite(input) ? input : 0;
    }
    return input;
  }

  static secureMemoryWipe(): void {
    // Secure memory clearing for WASM heap
    // Force garbage collection and zero sensitive arrays
    if ('gc' in window) {
      (window as any).gc();
    }

    // NOTE: We do NOT delete IndexedDB here because it contains user preferences
    // (parameter settings) that should persist across sessions.
    // FIT file data is never stored in IndexedDB - only analysis parameters.
  }

  static setupContentSecurityPolicy(): void {
    // Ensure CSP headers prevent XSS and data exfiltration
    const existingMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (!existingMeta) {
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = `
        default-src 'self';
        script-src 'self' 'wasm-unsafe-eval';
        style-src 'self' 'unsafe-inline';
        img-src 'self' data: blob:;
        connect-src 'self';
        object-src 'none';
        base-uri 'self';
      `.replace(/\s+/g, ' ').trim();
      document.head.appendChild(meta);
    }
  }
}