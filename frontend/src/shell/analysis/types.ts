/**
 * Shell dependency types for analysis delegation.
 *
 * Per D-05: ShellServices carries state references and thin UI-feedback callbacks only.
 * No DOM nodes, Plotly containers, Leaflet objects, or service singletons.
 * AppState stays state-only — ShellServices is a wiring container.
 */
import type { AppState } from '../../state/AppState';

export interface ShellServices {
    appState: AppState;
    showLoading: (message: string) => void;
    hideLoading: () => void;
    showError: (message: string) => void;
}

export interface ShellAnalysisContext extends ShellServices {
    waitForPlotly: () => Promise<void>;
}
