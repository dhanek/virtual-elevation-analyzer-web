/**
 * Configuration and persistence for remote DEM sources
 */

export type DEMSourceType = 'manual' | 'opentopography' | 'aws-terrain';

const STORAGE_KEYS = {
    API_KEY: 'opentopo-api-key',
    SOURCES: 'remote-dem-sources',
    DATASET: 'remote-dem-dataset',
} as const;

export class RemoteDEMConfig {
    /**
     * Get OpenTopography API key.
     * Resolution order: localStorage → VITE env var
     */
    static getOpenTopoApiKey(): string | null {
        const stored = localStorage.getItem(STORAGE_KEYS.API_KEY);
        if (stored) return stored;

        // Fallback to build-time env var
        try {
            const envKey = (import.meta as any).env?.VITE_OPENTOPO_API_KEY;
            if (envKey) return envKey;
        } catch {
            // Not available
        }

        return null;
    }

    static setOpenTopoApiKey(key: string): void {
        if (key.trim()) {
            localStorage.setItem(STORAGE_KEYS.API_KEY, key.trim());
        } else {
            localStorage.removeItem(STORAGE_KEYS.API_KEY);
        }
    }

    static clearOpenTopoApiKey(): void {
        localStorage.removeItem(STORAGE_KEYS.API_KEY);
    }

    /**
     * Get preferred remote DEM sources
     */
    static getPreferredSources(): DEMSourceType[] {
        const stored = localStorage.getItem(STORAGE_KEYS.SOURCES);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch {
                return [];
            }
        }
        return [];
    }

    static setPreferredSources(sources: DEMSourceType[]): void {
        localStorage.setItem(STORAGE_KEYS.SOURCES, JSON.stringify(sources));
    }

    /**
     * Get preferred OpenTopography dataset (default: COP30)
     */
    static getPreferredDataset(): string {
        return localStorage.getItem(STORAGE_KEYS.DATASET) || 'COP30';
    }

    static setPreferredDataset(dataset: string): void {
        localStorage.setItem(STORAGE_KEYS.DATASET, dataset);
    }
}
