# Comprehensive Migration Plan: Python Virtual Elevation Analyzer → Rust/WebAssembly Web Application

## Executive Summary

This plan transforms the Virtual Elevation Analyzer from a Python desktop application into a privacy-respecting web application that processes all data locally using Rust/WebAssembly for high-performance calculations.

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
wasm-bindgen = "0.2"
web-sys = "0.3"
js-sys = "0.3"

# Numerical Computing
ndarray = "0.15"
nalgebra = "0.32"
num-traits = "0.2"

# FIT File Processing
fitparse-rs = "0.1"  # or implement custom parser
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Geospatial
proj4rs = "0.1"     # Coordinate transformations
geo = "0.25"        # Geometric operations

# Utilities
thiserror = "1.0"
console_error_panic_hook = "0.1.7"
```

### 1.3 Frontend Dependencies Setup
```json
{
  "dependencies": {
    "vite": "^4.0",
    "typescript": "^5.0",
    "chart.js": "^4.0",
    "leaflet": "^1.9",
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

## Phase 6: Deployment & Security

### 6.1 Static Site Generation
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

### 6.2 Security Features
```typescript
// frontend/src/security/DataProtection.ts
class DataProtection {
  static validateFileType(file: File): boolean {
    // Only allow .fit files
    return file.name.endsWith('.fit') && file.type === 'application/octet-stream';
  }
  
  static sanitizeInput(input: any): any {
    // Sanitize all user inputs
    // Prevent injection attacks
  }
  
  static clearSensitiveData(): void {
    // Clear all data from memory and storage
    // GDPR compliance
  }
}
```

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

## Risk Mitigation

### Technical Risks
1. **Large FIT files**: Implement streaming processing
2. **Memory limitations**: Use Web Workers and chunked processing
3. **DEM data size**: Tile-based loading with caching
4. **Browser compatibility**: Target modern browsers only

### Privacy Compliance
1. **No server uploads**: All processing client-side
2. **Data clearing**: Automatic cleanup on page close
3. **Consent management**: Clear data usage policies
4. **Local storage**: IndexedDB with user control

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

### Migration Strategy

The migration prioritizes:
1. **Core functionality first**: Virtual elevation algorithm
2. **Data processing second**: FIT parsing and coordinate transforms
3. **UI/UX third**: Interactive visualization and user experience
4. **Advanced features last**: Multiple analysis types and optimizations

This approach ensures a working prototype early in the process while building toward full feature parity with the Python version.
