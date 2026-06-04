/**
 * Pure function generating Section 3 sidebar HTML.
 *
 * Extracted from initializeSection3 in main.ts to make template generation
 * testable and separate from DOM mounting and event binding.
 *
 * Per D-08: preserves exact HTML structure and CSS classes for visual parity.
 */
import type { SelectableCardItem } from "../dom/selectableCards";
import { renderSelectableCards } from "../dom/selectableCards";

/**
 * Input for Section 3 template generation.
 * Formatters are injected so the function stays pure and testable.
 */
export interface Section3TemplateInput {
	/** Activity laps from FIT data */
	laps: any[]; // ActivityLapLike[]
	/** Currently selected FIT lap numbers (1-based); kept across mode changes */
	selectedLaps: number[];
	/** Whether GPS data is available */
	hasGpsData: boolean;
	/** Whether to show GPS lap detection panel */
	showGpsLapDetection: boolean;
	/** Whether to show out-and-back detection panel */
	showOutAndBack: boolean;
	/** Current GPS analysis mode (None, GPS based lap splitting, etc.) */
	gpsAnalysisMode: string;
	/** Format elapsed seconds as duration string */
	formatDuration: (seconds: number) => string;
	/** Format meters as distance string */
	formatDistance: (meters: number) => string;
	/** Format watts as power string */
	formatPower: (watts: number) => string;
}

/**
 * Generate the complete Section 3 sidebar HTML.
 * Returns the same HTML that was previously constructed inline in initializeSection3.
 *
 * Uses renderSelectableCards for the FIT lap list to leverage the shared
 * shell/dom helper instead of inline .map().join('') template.
 */
export function renderSection3Template(input: Section3TemplateInput): string {
	const {
		laps,
		selectedLaps,
		hasGpsData,
		showGpsLapDetection,
		showOutAndBack,
		gpsAnalysisMode,
		formatDuration,
		formatDistance,
		formatPower,
	} = input;

	// Build FIT lap selectable cards using the shared shell helper.
	// Reflect the retained selection so changing GPS mode (which re-renders this
	// template) keeps the user's chosen laps checked.
	const lapItems: SelectableCardItem[] = laps.map(
		(lap: any, index: number) => ({
			id: `lap-${index + 1}`,
			label: `Lap ${index + 1}`,
			details: `${formatDuration(lap.total_elapsed_time)} \u2022 ${formatDistance(lap.total_distance)} \u2022 ${lap.avg_power > 0 ? formatPower(lap.avg_power) : "N/A"}`,
			checked: selectedLaps.includes(index + 1),
			dataAttr: "lap",
			dataValue: index + 1,
		}),
	);
	const lapCardsHtml = renderSelectableCards(lapItems, "lap-checkbox");

	return `
        <div class="analysis-layout">
            <div class="analysis-sidebar">
                ${
									hasGpsData
										? `
                <!-- GPS Mode Selector (shown only when GPS data available) -->
                <div class="gps-mode-selector">
                    <label for="gpsAnalysisMode">GPS Analysis Mode</label>
                    <select id="gpsAnalysisMode" data-gps-mode="${gpsAnalysisMode}">
                        <option value="None" ${gpsAnalysisMode === "None" ? "selected" : ""}>None</option>
                        <option value="GPS based lap splitting" ${gpsAnalysisMode === "GPS based lap splitting" ? "selected" : ""}>GPS based lap splitting</option>
                        <option value="GPS based out and back" ${gpsAnalysisMode === "GPS based out and back" ? "selected" : ""}>GPS based out and back</option>
                        <option value="GPS gate one way" ${gpsAnalysisMode === "GPS gate one way" ? "selected" : ""}>GPS gate one way</option>
                    </select>
                </div>
                `
										: ""
								}
                <!-- FIT Lap Selection (always shown) -->
                <div class="lap-selection">
                    <h4>Lap Selection</h4>
                    <div class="lap-controls">
                        <button class="select-all-btn" id="selectAllLaps">Select / Deselect All</button>
                    </div>
                    <div class="lap-list" id="lapList">
                        ${lapCardsHtml}
                    </div>
                </div>
                ${
									showGpsLapDetection
										? `
                <!-- GPS Lap Detection Panel (shown below lap selection when enabled) -->
                <div class="gps-lap-detection-panel" id="gpsLapDetectionPanel" style="margin-top: 0.5rem;">
                    <h4>GPS Virtual Lap Detection</h4>
                    <p style="font-size: 0.75rem; color: #666; margin-bottom: 0.5rem;">
                        Select FIT laps above, then set gate position to detect virtual laps.
                    </p>
                    <div class="gps-gate-slider-controls" id="gpsGateSliderControls" style="display: none;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <label style="font-size: 0.85rem; white-space: nowrap;">Gate Position:</label>
                            <input type="range" id="gpsGateSlider" min="0" max="100" value="5" step="1" style="flex: 1;">
                            <input type="number" id="gpsGateValue" value="5" min="0" step="1" style="width: 50px; text-align: right;">
                            <span style="font-size: 0.85rem;">s</span>
                        </div>
                        <div id="gpsGatePositionInfo" style="font-size: 0.75rem; color: #666;"></div>
                    </div>
                    <div id="gpsDetectedLapsInfo" style="margin-top: 1rem; display: none;">
                        <div style="font-size: 0.9em; color: #666; margin-bottom: 0.5rem;">
                            Detected <span id="gpsLapCount">0</span> virtual laps
                        </div>
                        <div class="lap-list" id="gpsLapList" style="max-height: 200px; overflow-y: auto;">
                            <!-- GPS detected laps will be populated here -->
                        </div>
                    </div>
                </div>
                `
										: ""
								}
                ${
									showOutAndBack
										? `
                <!-- Out and Back Detection Panel -->
                <div class="gps-lap-detection-panel" id="outAndBackPanel" style="margin-top: 0.5rem;">
                    <h4>Out &amp; Back Detection</h4>
                    <p style="font-size: 0.75rem; color: #666; margin-bottom: 0.5rem;">
                        Set two gates: A (start/end) and B (turnaround). B must be after A.
                    </p>
                    <div class="oab-gate-slider-controls" id="oabGateSliderControls" style="display: none;">
                        <div style="margin-bottom: 0.75rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                                <label style="font-size: 0.85rem; white-space: nowrap; color: #00aa00; font-weight: 500;">Gate A:</label>
                                <input type="range" id="oabGateASlider" min="0" max="100" value="5" step="1" style="flex: 1;">
                                <input type="number" id="oabGateAValue" value="5" min="0" step="1" style="width: 50px; text-align: right;">
                                <span style="font-size: 0.85rem;">s</span>
                            </div>
                            <div id="oabGateAInfo" style="font-size: 0.75rem; color: #666; margin-left: 3.5rem;"></div>
                        </div>
                        <div>
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                                <label style="font-size: 0.85rem; white-space: nowrap; color: #0066cc; font-weight: 500;">Gate B:</label>
                                <input type="range" id="oabGateBSlider" min="0" max="100" value="60" step="1" style="flex: 1;">
                                <input type="number" id="oabGateBValue" value="60" min="0" step="1" style="width: 50px; text-align: right;">
                                <span style="font-size: 0.85rem;">s</span>
                            </div>
                            <div id="oabGateBInfo" style="font-size: 0.75rem; color: #666; margin-left: 3.5rem;"></div>
                        </div>
                    </div>
                    <div id="outAndBackSectionsInfo" style="margin-top: 1rem; display: none;">
                        <div style="font-size: 0.9em; color: #666; margin-bottom: 0.5rem;">
                            Detected <span id="outAndBackSectionCount">0</span> out-and-back sections
                        </div>
                        <div class="lap-list" id="outAndBackSectionList" style="max-height: 200px; overflow-y: auto;">
                            <!-- Out and Back sections will be populated here -->
                        </div>
                    </div>
                </div>
                `
										: ""
								}
                ${
									!showGpsLapDetection && !showOutAndBack
										? `
                <div class="map-trim-controls" id="mapTrimControls" style="display: none;">
                    <div class="map-trim-group">
                        <label>Trim Start:</label>
                        <input type="range" id="mapTrimStartSlider" class="ve-slider-compact">
                        <input type="number" id="mapTrimStartValue" class="ve-value-input-compact">
                    </div>
                    <div class="map-trim-group">
                        <label>Trim End:</label>
                        <input type="range" id="mapTrimEndSlider" class="ve-slider-compact">
                        <input type="number" id="mapTrimEndValue" class="ve-value-input-compact">
                    </div>
                </div>
                `
										: ""
								}
            </div>
            ${
							hasGpsData
								? `
            <div class="analysis-main">
                <div class="map-container">
                    <div id="mapView"></div>
                </div>
            </div>
            `
								: `
            <div class="analysis-main">
                <div style="padding: 2rem; text-align: center; background: #f7fafc; border: 2px dashed #cbd5e0; border-radius: 8px;">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">\u{1F4CD}</div>
                    <h3 style="margin-bottom: 0.5rem;">No GPS Data Available</h3>
                    <p style="color: #718096; margin-bottom: 1rem;">This file contains power and speed data but no GPS coordinates.</p>
                    <p style="color: #718096; margin: 0;">Velodrome mode has been automatically enabled (zero altitude reference).</p>
                </div>
            </div>
            `
						}
        </div>
        <div class="analysis-actions" style="margin-top: 2rem;">
            <button id="analyzeBtn" class="primary-btn" disabled>Select Laps to Analyze</button>
        </div>
    `;
}
