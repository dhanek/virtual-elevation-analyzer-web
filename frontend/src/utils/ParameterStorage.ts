import { AnalysisParameters } from '../components/AnalysisParameters';

interface StoredParameters {
    fileHash: string;
    parameters: AnalysisParameters;
    lastUsed: number; // timestamp
    fileName?: string; // optional, for debugging
}

export class ParameterStorage {
    private dbName = 'VirtualElevationAnalyzer';
    private storeName = 'fileParameters';
    private db: IDBDatabase | null = null;

    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log('🗄️ Opening IndexedDB:', this.dbName, 'version: 1');
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => {
                console.error('❌ IndexedDB failed to open:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ IndexedDB opened successfully');
                console.log('   Database version:', this.db.version);
                console.log('   Object stores:', Array.from(this.db.objectStoreNames));
                resolve();
            };

            request.onupgradeneeded = (event) => {
                console.log('🔧 IndexedDB upgrade needed');
                console.log('   Old version:', (event as IDBVersionChangeEvent).oldVersion);
                console.log('   New version:', (event as IDBVersionChangeEvent).newVersion);

                const db = (event.target as IDBOpenDBRequest).result;

                // Create object store if it doesn't exist
                if (!db.objectStoreNames.contains(this.storeName)) {
                    console.log('📦 Creating object store:', this.storeName);
                    const objectStore = db.createObjectStore(this.storeName, { keyPath: 'fileHash' });
                    objectStore.createIndex('lastUsed', 'lastUsed', { unique: false });
                    console.log('✅ Object store created');
                } else {
                    console.log('ℹ️ Object store already exists:', this.storeName);
                }
            };
        });
    }

    /**
     * Calculate a hash from file data for identification
     * Uses first 8KB + file size for speed (not cryptographic hash)
     */
    async calculateFileHash(file: File): Promise<string> {
        const chunkSize = 8192; // 8KB
        const buffer = await file.slice(0, Math.min(chunkSize, file.size)).arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // Simple hash: combine first bytes with file size and name
        let hash = file.size.toString(36);

        // Add sample bytes from start
        for (let i = 0; i < Math.min(64, bytes.length); i += 4) {
            hash += bytes[i].toString(36);
        }

        // Add filename (sanitized)
        hash += '_' + file.name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);

        console.log('🔑 Calculated file hash:', hash, 'for file:', file.name, 'size:', file.size);
        return hash;
    }

    /**
     * Save parameters for a file
     */
    async saveParameters(fileHash: string, parameters: AnalysisParameters, fileName?: string): Promise<void> {
        if (!this.db) {
            console.warn('IndexedDB not initialized, cannot save parameters');
            return;
        }

        console.log('💾 Saving parameters with hash:', fileHash, 'fileName:', fileName);

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            const data: StoredParameters = {
                fileHash,
                parameters,
                lastUsed: Date.now(),
                fileName
            };

            const request = objectStore.put(data);

            request.onsuccess = () => {
                console.log('✅ Parameters saved successfully for:', fileName || fileHash);
                // Verify the save
                const verifyRequest = objectStore.get(fileHash);
                verifyRequest.onsuccess = () => {
                    console.log('✅ Verification: Data exists in DB for hash:', fileHash, ':', !!verifyRequest.result);
                };
                resolve();
            };

            request.onerror = () => {
                console.error('❌ Failed to save parameters:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Load parameters for a file
     */
    async loadParameters(fileHash: string): Promise<AnalysisParameters | null> {
        if (!this.db) {
            console.warn('IndexedDB not initialized, cannot load parameters');
            return null;
        }

        console.log('📂 Loading parameters for hash:', fileHash);

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.get(fileHash);

            request.onsuccess = () => {
                const result = request.result as StoredParameters | undefined;
                if (result) {
                    console.log('✅ Parameters found and loaded for:', result.fileName || fileHash);
                    console.log('📋 Loaded parameters:', result.parameters);
                    resolve(result.parameters);
                } else {
                    console.log('⚠️ No saved parameters found for file hash:', fileHash);
                    // Debug: show what hashes we DO have
                    objectStore.getAllKeys().onsuccess = (e: any) => {
                        console.log('📋 Available hashes in DB:', e.target.result);
                    };
                    resolve(null);
                }
            };

            request.onerror = () => {
                console.error('❌ Failed to load parameters:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get all stored file hashes (for debugging)
     */
    async getAllStoredFiles(): Promise<StoredParameters[]> {
        if (!this.db) return [];

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.getAll();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('Failed to get all files:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Clean up old entries (keep only last N files or last X days)
     */
    async cleanup(maxFiles: number = 50, maxAgeDays: number = 30): Promise<void> {
        if (!this.db) return;

        try {
            const allFiles = await this.getAllStoredFiles();

            // Sort by lastUsed descending
            allFiles.sort((a, b) => b.lastUsed - a.lastUsed);

            const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
            const cutoffTime = Date.now() - maxAgeMs;

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            let deleteCount = 0;

            // Delete files beyond maxFiles or older than maxAgeDays
            for (let i = 0; i < allFiles.length; i++) {
                const file = allFiles[i];
                if (i >= maxFiles || file.lastUsed < cutoffTime) {
                    objectStore.delete(file.fileHash);
                    deleteCount++;
                }
            }

            if (deleteCount > 0) {
                console.log(`Cleaned up ${deleteCount} old parameter entries`);
            }
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    }

    /**
     * Clear all stored parameters (for debugging or user request)
     */
    async clearAll(): Promise<void> {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.clear();

            request.onsuccess = () => {
                console.log('All stored parameters cleared');
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to clear parameters:', request.error);
                reject(request.error);
            };
        });
    }
}
