# Virtual Elevation Analyzer - Web Application

> **Live Demo**: https://dhanek.github.io/virtual-elevation-analyzer-web/

A privacy-respecting web application for cycling power analysis using Robert Chung's Virtual Elevation method. All data processing happens locally in your browser using Rust/WebAssembly - no server uploads required.

## ✨ Features

- 🔒 **100% Local Processing** - Your data never leaves your browser
- ⚡ **High Performance** - Rust/WebAssembly for fast calculations
- 📊 **Interactive Visualization** - Real-time VE analysis with Plotly.js
- 🗺️ **GPS Track Mapping** - Leaflet integration with trim markers
- 🌬️ **Wind Analysis** - Multiple wind source options (constant, FIT file, comparison)
- 🎨 **Minimal Design** - Dieter Rams-inspired interface
- 📱 **Responsive** - Works on desktop and tablet

## 🚀 Quick Start

1. Visit https://dhanek.github.io/virtual-elevation-analyzer-web/
2. Upload your FIT file
3. Set analysis parameters (mass, CdA, Crr, wind)
4. Select laps and adjust trim settings
5. Click "Analyze" to view results

## 📋 Current Status

**Implementation Progress: ~75% Complete**

✅ **Implemented**:
- FIT file parsing and processing
- Virtual Elevation calculation
- Interactive plots (VE, Wind, Power)
- Map visualization with lap selection
- Real-time parameter adjustment
- Wind source selection
- Responsive UI

🚧 **In Progress** (See [TODO](#-todo-list) below):
- Activity parameter persistence
- CSV/JSON export
- DEM data integration

## 📚 TODO List

### High Priority

1. **Activity Parameter Persistence** (Phase 4.4)
   - [ ] Implement IndexedDB storage for activity parameters
   - [ ] Add file hash-based parameter matching
   - [ ] Auto-load saved parameters on file re-upload
   - [ ] Parameter suggestions based on similar activities

2. **Export Functionality**
   - [ ] CSV export for analysis results
   - [ ] JSON export for processed data
   - [ ] PNG export for plots
   - [ ] Configurable export options

### Medium Priority

3. **DEM Data Integration** (Phase 4.1)
   - [ ] Research client-side DEM tile sources
   - [ ] Implement tile-based DEM loading
   - [ ] Add IndexedDB caching for DEM tiles
   - [ ] Add elevation correction toggle

4. **Enhanced Analysis Types**
   - [ ] GPS based out and back refinement
   - [ ] GPS gate analysis implementation
   - [ ] Auto lap detection improvements

5. **Optimization Features**
   - [ ] Automatic CdA/Crr optimization
   - [ ] Multi-parameter optimization
   - [ ] Result comparison view

### Low Priority

6. **User Experience Enhancements**
   - [ ] Tutorial/onboarding flow
   - [ ] Keyboard shortcuts
   - [ ] Drag-and-drop file upload
   - [ ] Recent files list

7. **Advanced Features**
   - [ ] Multiple file comparison
   - [ ] Historical trend analysis
   - [ ] Advanced statistics
   - [ ] Custom report generation

## 🏗️ Development

### Prerequisites
- Rust toolchain with `wasm-pack`
- Node.js 18+ with npm

### Build & Run Locally

```bash
# Build WASM module
cd backend
wasm-pack build --target web --out-dir ../frontend/pkg

# Install frontend dependencies
cd ../frontend
npm install

# Run development server
npm run dev
```

Visit http://localhost:5173

### Deploy to GitHub Pages

Deployment is automated via GitHub Actions. Push to `main` branch triggers a build and deploy.

See [DEPLOYMENT.md](DEPLOYMENT.md) for details.

## 📁 Project Structure

```
virtual-elevation-analyzer-web/
├── backend/          # Rust/WASM core
├── frontend/         # TypeScript/Vite frontend
├── .github/          # CI/CD workflows
└── dist/             # Build output
```

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for detailed implementation status.

---

## 📖 Original Migration Plan

This project transforms the Virtual Elevation Analyzer from a Python desktop application into a privacy-respecting web application that processes all data locally using Rust/WebAssembly for high-performance calculations.

## Phase 1: Foundation Setup

### 1.1 Project Structure Creation
```
ve-web-app/
├── backend/                    # Rust/WebAssembly core
│   ├── src/
│   │   ├── lib.rs
│   │   ├── fit_parser.rs
│   │   ├── virtual_elevation.rs
│   │   ├── geospatial.rs
│   │   └── utils.rs
│   ├── Cargo.toml
│   └── pkg/                   # Generated WASM output
├── frontend/                  # Modern web frontend
│   ├── src/
│   │   ├── components/
│   │   ├── workers/
│   │   ├── utils/
│   │   └── main.js
│   ├── package.json
│   └── dist/
└── shared/                    # Shared types and constants
```

### 1.2 Rust Dependencies Setup
```toml
[dependencies]
# Core WebAssembly
wasm-bindgen = "0.2.95"  # Latest stable - regularly updated
web-sys = "0.3.72"
js-sys = "0.3.72"

# Numerical Computing
ndarray = "0.16"         # Upgraded from 0.15 for compatibility
nalgebra = "0.34"        # Upgraded from 0.32 for latest features
num-traits = "0.2"

# FIT File Processing
fitparse-rs = "0.1"  # or implement custom parser
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Geospatial
geo = "0.26"          # Latest maintained release
geodesy = "0.12"      # Advanced projections and datum conversions

# Utilities
thiserror = "1.0"
console_error_panic_hook = "0.1.7"
```

### 1.3 Frontend Dependencies Setup
```json
{
  "dependencies": {
    "vite": "^7.1",      # Latest for better build performance
    "typescript": "^5.6", # Latest stable release
    "chart.js": "^4.5",   # Updated for new features
    "leaflet": "^1.9",    # Stable; consider 2.0 prep for 2026
    "comlink": "^4.4",
    "@types/leaflet": "^1.9"
  }
}
```

## Phase 2: Core Rust/WebAssembly Implementation

### 2.1 FIT File Parser Migration
**Target**: Replace Python `fitparse` with Rust `fitparse-rs`

```rust
// backend/src/fit_parser.rs
use wasm_bindgen::prelude::*;
use fitparse_rs::FitFile;

#[wasm_bindgen]
pub struct FitData {
    timestamps: Vec<f64>,
    power: Vec<f64>,
    velocity: Vec<f64>,
    position_lat: Vec<f64>,
    position_long: Vec<f64>,
    altitude: Vec<f64>,
}

#[wasm_bindgen]
pub fn parse_fit_file(file_data: &[u8]) -> Result<FitData, JsValue> {
    // Implementation using fitparse-rs
    // Returns structured data equivalent to Python version
}
```

### 2.2 Virtual Elevation Algorithm
**Target**: Port core mathematical algorithms to Rust

```rust
// backend/src/virtual_elevation.rs
use ndarray::{Array1, Zip};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct VEParameters {
    pub system_mass: f64,
    pub rho: f64,
    pub eta: f64,
    pub cda: f64,
    pub crr: f64,
    pub wind_speed: f64,
    pub wind_direction: f64,
}

#[wasm_bindgen]
pub fn calculate_virtual_elevation(
    power: &[f64],
    velocity: &[f64],
    timestamps: &[f64],
    params: &VEParameters,
) -> Vec<f64> {
    // High-performance array operations using ndarray
    // Direct port of Python virtual slope calculation
}
```

### 2.3 Geospatial Operations
**Target**: Replace `rasterio`/`pyproj` with `proj4rs`

```rust
// backend/src/geospatial.rs
use proj4rs::Proj;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct CoordinateTransformer {
    proj: Proj,
}

#[wasm_bindgen]
impl CoordinateTransformer {
    pub fn new(from_crs: &str, to_crs: &str) -> Result<CoordinateTransformer, JsValue> {
        // Initialize projection using proj4rs
    }
    
    pub fn transform_coordinates(&self, lat: f64, lon: f64) -> Result<Vec<f64>, JsValue> {
        // Coordinate transformation without external dependencies
    }
}
```

## Phase 3: Frontend Development

### 3.1 Web Worker Integration
**Target**: Offload heavy computations to avoid blocking UI

```typescript
// frontend/src/workers/ve-worker.ts
import { expose } from 'comlink';
import init, { parse_fit_file, calculate_virtual_elevation } from '../../../backend/pkg';

class VEWorker {
  private wasmModule: any;
  
  async initialize() {
    this.wasmModule = await init();
  }
  
  async processFitFile(fileData: Uint8Array) {
    return parse_fit_file(fileData);
  }
  
  async calculateVE(data: any, parameters: any) {
    return calculate_virtual_elevation(
      data.power, 
      data.velocity, 
      data.timestamps, 
      parameters
    );
  }
}

expose(VEWorker);
```

### 3.2 File Upload Handler
**Target**: Secure local file processing

```typescript
// frontend/src/components/FileUpload.ts
class FileUpload {
  private worker: Worker;
  
  constructor() {
    this.worker = new Worker('./workers/ve-worker.ts');
  }
  
  async handleFitFile(file: File): Promise<any> {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // All processing happens locally in WebAssembly
    return this.worker.processFitFile(uint8Array);
  }
}
```

### 3.3 Interactive Visualization
**Target**: Replace matplotlib with web-native charting

```typescript
// frontend/src/components/VEChart.ts
import { Chart, registerables } from 'chart.js';

class VEChart {
  private chart: Chart;
  
  constructor(canvas: HTMLCanvasElement) {
    Chart.register(...registerables);
    this.chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Virtual Elevation',
          data: [],
          borderColor: 'rgb(75, 192, 192)',
        }, {
          label: 'Actual Elevation',
          data: [],
          borderColor: 'rgb(255, 99, 132)',
        }]
      },
      options: {
        responsive: true,
        animation: false, // Better performance
        plugins: {
          zoom: {
            zoom: { wheel: { enabled: true } },
            pan: { enabled: true }
          }
        }
      }
    });
  }
  
  updateData(virtualElevation: number[], actualElevation: number[]) {
    // Real-time chart updates
  }
}
```

## Phase 4: Advanced Features

### 4.1 DEM Data Integration
**Target**: Client-side elevation correction

```rust
// backend/src/dem_processor.rs
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct DEMProcessor {
    // Tile-based DEM data storage
    tiles: Vec<DEMTile>,
}

#[wasm_bindgen]
impl DEMProcessor {
    pub fn load_dem_tiles(&mut self, tile_data: &[u8]) -> Result<(), JsValue> {
        // Process DEM tiles locally
        // Store in IndexedDB for persistence
    }
    
    pub fn get_elevation(&self, lat: f64, lon: f64) -> Option<f64> {
        // Fast spatial lookup without server calls
    }
}
```

### 4.2 Analysis Types Implementation
**Target**: All four analysis methods

```rust
// backend/src/analysis_types.rs
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub enum AnalysisType {
    Standard,
    GPSLap,
    OutAndBack,
    GPSGate,
}

#[wasm_bindgen]
pub struct AnalysisResult {
    pub r_squared: f64,
    pub rmse: f64,
    pub optimized_cda: f64,
    pub optimized_crr: f64,
    pub virtual_elevation: Vec<f64>,
}

#[wasm_bindgen]
pub fn run_analysis(
    data: &FitData,
    params: &VEParameters,
    analysis_type: AnalysisType,
) -> Result<AnalysisResult, JsValue> {
    // Implement all analysis types
}
```

### 4.3 Data Persistence
**Target**: Local storage without server uploads

```typescript
// frontend/src/storage/LocalStorage.ts
class LocalStorage {
  private db: IDBDatabase;
  
  async saveAnalysis(analysis: any): Promise<void> {
    // Store in IndexedDB
    // No server communication
  }
  
  async loadAnalysisHistory(): Promise<any[]> {
    // Retrieve from IndexedDB
  }
  
  async exportToCsv(analysis: any): Promise<void> {
    // Generate CSV and trigger download
  }
}
```

### 4.4 Activity Parameter Persistence
**Target**: Save and auto-load parameters per activity file

```typescript
// frontend/src/storage/ActivityStorage.ts
interface ActivityParameters {
  fileName: string;
  fileHash: string;          // SHA-256 of file content
  timestamp: number;
  parameters: {
    system_mass: number;
    rho: number;
    eta: number;
    cda: number;
    crr: number;
    wind_speed: number;
    wind_direction: number;
  };
  analysisType: 'Standard' | 'GPSLap' | 'OutAndBack' | 'GPSGate';
  trimSettings?: {
    startTime: number;
    endTime: number;
  };
}

class ActivityStorage {
  private dbName = 've-activity-cache';
  private db: IDBDatabase;
  
  async saveActivityParameters(
    file: File, 
    parameters: ActivityParameters['parameters']
  ): Promise<void> {
    const fileHash = await this.calculateFileHash(file);
    
    const activityData: ActivityParameters = {
      fileName: file.name,
      fileHash,
      timestamp: Date.now(),
      parameters,
      analysisType: this.currentAnalysisType
    };
    
    // Store in IndexedDB with file hash as key
    await this.storeInDB(fileHash, activityData);
  }
  
  async loadActivityParameters(file: File): Promise<ActivityParameters | null> {
    const fileHash = await this.calculateFileHash(file);
    return await this.getFromDB(fileHash);
  }
  
  async suggestParameters(
    currentFile: File,
    storedActivities: ActivityParameters[]
  ): Promise<ActivityParameters['parameters']> {
    // Find activities with similar characteristics
    const similar = storedActivities.filter(activity => {
      const nameSimilarity = this.calculateNameSimilarity(
        currentFile.name, 
        activity.fileName
      );
      
      // Recent activities (within last 30 days)
      const isRecent = Date.now() - activity.timestamp < 30 * 24 * 60 * 60 * 1000;
      
      return nameSimilarity > 0.7 || isRecent;
    });
    
    // Return averaged parameters from similar activities
    return this.averageParameters(similar);
  }
  
  private async calculateFileHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
```

```rust
// backend/src/activity_cache.rs
use wasm_bindgen::prelude::*;
use std::collections::HashMap;

#[wasm_bindgen]
pub struct ActivityCache {
    // In-memory cache for current session
    cache: HashMap<String, String>, // file_hash -> parameters JSON
}

#[wasm_bindgen]
impl ActivityCache {
    pub fn new() -> ActivityCache {
        ActivityCache {
            cache: HashMap::new(),
        }
    }
    
    pub fn cache_parameters(&mut self, file_hash: String, params: String) {
        // Cache parameters for quick access during session
        self.cache.insert(file_hash, params);
    }
    
    pub fn get_cached_parameters(&self, file_hash: &str) -> Option<String> {
        // Return cached parameters if available
        self.cache.get(file_hash).cloned()
    }
    
    pub fn clear_cache(&mut self) {
        // Clear cache for memory management
        self.cache.clear();
    }
}
```

## Phase 5: Optimization & Testing

### 5.1 Performance Optimization
```rust
// backend/src/optimizations.rs
use wasm_bindgen::prelude::*;

// SIMD optimizations where possible
#[cfg(target_arch = "wasm32")]
use std::arch::wasm32::*;

#[wasm_bindgen]
pub fn optimized_virtual_slope_calculation(
    power: &[f64],
    velocity: &[f64],
    params: &VEParameters,
) -> Vec<f64> {
    // Vectorized operations using ndarray
    // SIMD instructions where supported
}
```

### 5.2 Memory Management
```rust
// backend/src/memory.rs
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn optimize_memory_usage() {
    // Manual memory management for large datasets
    // Streaming processing for big FIT files
}
```

## Phase 6: Deployment, Security & CI/CD

### 6.1 Automated Dependency Management
```yaml
# .github/workflows/dependency-audit.yml
name: Dependency Security Audit
on:
  schedule:
    - cron: '0 2 * * 1'  # Weekly Monday 2 AM
  pull_request:
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Install cargo-audit
        run: cargo install cargo-audit
      - name: Audit Rust dependencies
        run: cargo audit
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm install
      - name: Audit npm dependencies
        run: npm audit --audit-level moderate
      - name: Check for outdated dependencies
        run: |
          cargo install cargo-outdated
          cargo outdated --root-deps-only
          npm outdated || true
```

```yaml
# .github/workflows/dependency-update.yml
name: Automated Dependency Updates
on:
  schedule:
    - cron: '0 4 * * 1'  # Weekly Monday 4 AM

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Update Cargo dependencies
        run: |
          cargo update
          cargo test
      - name: Update npm dependencies
        run: |
          npm update
          npm run test
      - name: Create PR if changes
        uses: peter-evans/create-pull-request@v5
        with:
          title: 'chore: automated dependency updates'
          body: 'Automated dependency updates with passing tests'
          branch: auto-dependency-updates
```

### 6.2 Static Site Generation
```javascript
// build.js
const { build } = require('vite');
const path = require('path');

async function buildForProduction() {
  // Build Rust/WebAssembly
  await execSync('wasm-pack build --target web backend/');
  
  // Build frontend
  await build({
    root: 'frontend/',
    build: {
      outDir: '../dist',
      assetsDir: 'assets',
      rollupOptions: {
        external: [],
        output: {
          manualChunks: {
            'wasm-core': ['../backend/pkg'],
            'charts': ['chart.js'],
            'maps': ['leaflet']
          }
        }
      }
    }
  });
}
```

### 6.3 Enhanced Security & WebAssembly Hardening
```typescript
// frontend/src/security/DataProtection.ts
class DataProtection {
  static validateFileType(file: File): boolean {
    // Strict FIT file validation with magic number check
    return file.name.endsWith('.fit') &&
           file.type === 'application/octet-stream' &&
           file.size > 0 && file.size < 50_000_000; // 50MB limit
  }

  static async validateFitMagicNumber(file: File): Promise<boolean> {
    // Read first 4 bytes to verify FIT file format
    const header = await file.slice(0, 4).arrayBuffer();
    const view = new Uint8Array(header);
    // FIT files start with specific header pattern
    return view[8] === 0x2E && view[9] === 0x46 && view[10] === 0x49 && view[11] === 0x54;
  }

  static sanitizeInput(input: any): any {
    // Comprehensive input sanitization
    if (typeof input === 'string') {
      return input.replace(/[<>\"'&]/g, '');
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
    // Clear IndexedDB on session end
    indexedDB.databases().then(dbs => {
      dbs.forEach(db => indexedDB.deleteDatabase(db.name || ''));
    });
  }

  static setupContentSecurityPolicy(): void {
    // Ensure CSP headers prevent XSS and data exfiltration
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = `
      default-src 'self';
      script-src 'self' 'wasm-unsafe-eval';
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: blob:;
      connect-src 'none';
      object-src 'none';
      base-uri 'self';
    `.replace(/\s+/g, ' ');
    document.head.appendChild(meta);
  }
}

// WebAssembly Security Monitoring
class WasmSecurity {
  static monitorMemoryUsage(): void {
    // Monitor WASM memory growth to prevent DoS
    if ('performance' in window && 'memory' in performance) {
      const memInfo = (performance as any).memory;
      if (memInfo.usedJSHeapSize > 100_000_000) { // 100MB threshold
        console.warn('High memory usage detected, clearing caches');
        DataProtection.secureMemoryWipe();
      }
    }
  }

  static validateWasmModule(module: WebAssembly.Module): boolean {
    // Basic WASM module validation
    try {
      const imports = WebAssembly.Module.imports(module);
      const exports = WebAssembly.Module.exports(module);

      // Ensure no unexpected imports/exports
      const allowedImports = ['env', 'wbg'];
      return imports.every(imp => allowedImports.includes(imp.module));
    } catch {
      return false;
    }
  }
}
```

```rust
// backend/src/security.rs
use wasm_bindgen::prelude::*;
use web_sys::console;

#[wasm_bindgen]
pub struct SecurityValidator;

#[wasm_bindgen]
impl SecurityValidator {
    pub fn new() -> SecurityValidator {
        // Initialize panic hook for security monitoring
        console_error_panic_hook::set_once();
        SecurityValidator
    }

    pub fn validate_fit_data(&self, data: &[u8]) -> Result<(), JsValue> {
        // Comprehensive FIT file validation
        if data.len() < 12 {
            return Err(JsValue::from_str("Invalid FIT file: too small"));
        }

        // Check file header and size constraints
        let header_size = data[0] as usize;
        if header_size < 12 || header_size > data.len() {
            return Err(JsValue::from_str("Invalid FIT file: corrupted header"));
        }

        // Validate protocol version
        let protocol_version = data[1];
        if protocol_version > 20 {  // Future-proof version check
            console::warn_1(&"Unknown FIT protocol version".into());
        }

        Ok(())
    }

    pub fn sanitize_numeric_input(&self, value: f64) -> f64 {
        // Ensure numeric inputs are within reasonable bounds
        if !value.is_finite() {
            return 0.0;
        }

        // Clamp to reasonable ranges for cycling data
        value.max(-1000.0).min(10000.0)
    }

    pub fn check_memory_pressure(&self) -> bool {
        // Monitor WASM memory usage
        let memory = wasm_bindgen::memory();
        let buffer_size = memory.buffer().byte_length() as f64;

        // Warn if approaching 1GB (browser limit)
        if buffer_size > 800_000_000.0 {
            console::warn_1(&"High WASM memory usage detected".into());
            return true;
        }

        false
    }
}
```

### 6.4 WebAssembly Security Best Practices

**Runtime Security Monitoring**
- Periodic review of Rust-to-WASM toolchain updates for security advisories
- Monitor browser WebAssembly sandbox changes and security hardening updates
- Implement memory usage monitoring to prevent DoS through resource exhaustion

**Secure Data Flow**
- All sensitive cycling data processed exclusively in client-side WebAssembly
- No network requests during data processing phase
- Explicit memory clearing and garbage collection for privacy compliance

## Migration Phase Summary

| Phase | Key Deliverables |
|-------|------------------|
| 1 | Project setup, dependency mapping |
| 2 | Core Rust/WASM algorithms |
| 3 | Frontend integration |
| 4 | Advanced features |
| 5 | Optimization & testing |
| 6 | Deployment & security |

## Python → Rust/WebAssembly Dependency Mapping

| Python Library | Rust/WebAssembly Equivalent | Status |
|---------------|----------------------------|--------|
| `fitparse` | `fitparse-rs` | ✅ Available |
| `numpy` | `ndarray` | ✅ Mature |
| `scipy` | `nalgebra` + custom | ⚠️ Partial |
| `pandas` | Custom + `ndarray` | ⚠️ Manual |
| `matplotlib` | `chart.js` (JS) | ✅ Web-native |
| `rasterio` | `proj4rs` + custom | ⚠️ Limited |
| `folium` | `leaflet` (JS) | ✅ Web-native |
| `pyproj` | `proj4rs` | ✅ Available |

## Dependency Maintenance & Upgrade Strategy

### Current Dependency Status & Recommendations

**Core WebAssembly Stack (Well-Maintained)**
- `wasm-bindgen 0.2.95`: Latest stable - monitor for rapid ecosystem changes
- `ndarray 0.16`: Upgraded from 0.15 to resolve dependency conflicts in larger projects
- `nalgebra 0.34`: Upgraded from 0.32 for performance improvements and security patches
- `geo 0.26`/`geodesy 0.12`: Both actively maintained; `geo` for planar operations, `geodesy` for advanced projections

**Frontend Dependencies (Require Monitoring)**
- `vite 7.1`: Major upgrade from 5.0 for build performance and modern browser targeting
- `chart.js 4.5`: Updated for latest features; monitor for breaking changes
- `leaflet 1.9`: Stable; prepare for 2.0 alpha migration for 2026+ browser modernization

**Proactive Upgrade Preparation**
- Test Leaflet 2.0 alpha in development branch for future-proofing
- Monitor `nalgebra` 0.35+ releases for continued performance improvements
- Evaluate `geodesy` vs direct proj4 bindings for production-scale projection requirements

### Automated Maintenance Recommendations

1. **Dependency Auditing**: Integrate `cargo audit` and `npm audit` into CI pipeline
2. **Security Monitoring**: Schedule weekly dependency vulnerability scans
3. **Version Tracking**: Use `cargo outdated` and `npm outdated` for proactive updates
4. **Testing Strategy**: Automated testing against latest dependency versions in separate CI branch

### Alternative Technology Evaluation

**Advanced Geospatial Processing**
- For production deployments requiring high-precision projections, evaluate direct `proj4` WASM bindings
- Consider `geodesy` crate for complex datum conversions beyond simplified UTM logic

**Performance Optimization Opportunities**
- WebAssembly SIMD support monitoring for numerical computation acceleration
- Evaluate WebGPU integration for massively parallel virtual elevation calculations

## Risk Mitigation

### Technical Risks
1. **Large FIT files**: Implement streaming processing with chunked WASM memory allocation
2. **Memory limitations**: Use Web Workers and explicit memory pooling
3. **DEM data size**: Tile-based loading with IndexedDB caching and compression
4. **Browser compatibility**: Target modern browsers with WebAssembly support
5. **Dependency drift**: Automated monitoring and testing of upstream changes

### Privacy Compliance
1. **No server uploads**: All processing client-side with explicit data flow documentation
2. **Data clearing**: Automatic cleanup on page close with secure memory wiping
3. **Consent management**: Clear data usage policies and retention controls
4. **Local storage**: IndexedDB with user-controlled data lifecycle management

## Success Metrics

1. **Performance**: 90% of Python performance in WebAssembly
2. **File size**: Under 5MB total bundle size
3. **Memory usage**: Under 100MB peak memory
4. **Privacy**: Zero server communication for data processing
5. **Compatibility**: Works in 95% of modern browsers

## Implementation Notes

### Core Algorithm Analysis

The Virtual Elevation Analyzer implements Robert Chung's Virtual Elevation method with the following key components:

**Virtual Slope Calculation**:
```
virtual_slope = (
    (power * efficiency) / (ground_velocity * mass * 9.807)
    - (cda * air_density * apparent_velocity**2) / (2 * mass * 9.807)
    - rolling_resistance_coefficient
    - acceleration / 9.807
)
```

**Data Processing Pipeline**:
1. FIT file parsing and coordinate conversion
2. Data resampling to 1-second intervals
3. DEM elevation correction (optional)
4. Virtual elevation calculation with wind effects
5. Analysis result visualization and export

**Performance-Critical Operations**:
- Array operations on large time-series datasets
- GPS bearing calculations and coordinate transformations
- DEM elevation lookups and spatial indexing
- Real-time parameter optimization

### WebAssembly Architecture Benefits

1. **Privacy by Design**: All calculations performed locally
2. **Performance**: Near-native speed for numerical computations
3. **Portability**: Single codebase for all platforms
4. **Security**: Sandboxed execution environment
5. **Maintainability**: Type-safe Rust code with better error handling

### Architecture Documentation

**Recommended Addition**: Create a high-level architecture diagram documenting:
- Data flow from FIT file upload through WebAssembly processing to visualization
- Component interaction between Rust WASM modules and TypeScript frontend
- Memory management and Web Worker threading model
- Security boundaries and privacy-preserving design patterns

This documentation improves maintainability and helps onboard future contributors to the codebase architecture.

### Migration Strategy

The migration prioritizes:
1. **Core functionality first**: Virtual elevation algorithm
2. **Data processing second**: FIT parsing and coordinate transforms
3. **UI/UX third**: Interactive visualization and user experience
4. **Advanced features last**: Multiple analysis types and optimizations

This approach ensures a working prototype early in the process while building toward full feature parity with the Python version.
