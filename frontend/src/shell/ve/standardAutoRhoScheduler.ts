import type { AnalysisParametersComponent } from "../../components/AnalysisParameters";
import type { AppState } from "../../state/AppState";
import type { ShellServices } from "../analysis/types";
import { log } from "../../utils/log";
import { calculateAutoRho } from "./autoRho";

interface PendingStandardAutoRho {
	owner: object | null;
	timer: ReturnType<typeof setTimeout> | null;
	generation: number;
	activeRuns: number;
	promise: Promise<void>;
	resolve: () => void;
	getParametersComponent: () => AnalysisParametersComponent | null;
	services: ShellServices;
}

const pendingByState = new WeakMap<AppState, PendingStandardAutoRho>();

function finishPending(
	appState: AppState,
	pending: PendingStandardAutoRho,
): void {
	if (pendingByState.get(appState) === pending) pendingByState.delete(appState);
	if (appState.standardPendingAutoRhoDebounce?.promise === pending.promise) {
		appState.standardPendingAutoRhoDebounce = null;
	}
	pending.resolve();
}

function replaceOwner(
	appState: AppState,
	pending: PendingStandardAutoRho,
): void {
	if (pending.timer) clearTimeout(pending.timer);
	finishPending(appState, pending);
}

/**
 * Debounce Standard weather for both faces of the one trim window.
 *
 * Section 3 owns the map listeners and the Standard binder owns the panel
 * listeners, but they must share one deadline and one pending boundary. The
 * returned promise settles only after the last gesture's weather operation,
 * including a changed-input successor queued behind an older flight.
 */
export function scheduleStandardAutoRho(
	appState: AppState,
	getParametersComponent: () => AnalysisParametersComponent | null,
	services: ShellServices,
): Promise<void> {
	const owner = appState.standardPanelOwner;
	let pending = pendingByState.get(appState);
	if (pending && pending.owner !== owner) {
		replaceOwner(appState, pending);
		pending = undefined;
	}

	if (!pending) {
		let resolve!: () => void;
		const promise = new Promise<void>((done) => {
			resolve = done;
		});
		pending = {
			owner,
			timer: null,
			generation: 0,
			activeRuns: 0,
			promise,
			resolve,
			getParametersComponent,
			services,
		};
		pendingByState.set(appState, pending);
	}

	pending.getParametersComponent = getParametersComponent;
	pending.services = services;
	pending.generation += 1;
	const generation = pending.generation;
	if (pending.timer) clearTimeout(pending.timer);

	if (owner && appState.standardInitialAutoRhoOwner === owner) {
		appState.standardPendingAutoRhoDebounce = {
			owner,
			promise: pending.promise,
		};
	}

	pending.timer = setTimeout(async () => {
		pending!.timer = null;
		pending!.activeRuns += 1;
		try {
			const stillOwnsPanel =
				pending!.owner === null ||
				appState.standardPanelOwner === pending!.owner;
			if (stillOwnsPanel && appState.currentParameters?.auto_calculate_rho) {
				await calculateAutoRho(
					appState,
					pending!.getParametersComponent(),
					pending!.services,
				);
			}
		} catch (err) {
			log.error("Auto-rho calculation error on Standard trim change:", err);
		} finally {
			pending!.activeRuns -= 1;
			if (
				pending!.generation === generation &&
				pending!.timer === null &&
				pending!.activeRuns === 0
			) {
				finishPending(appState, pending!);
			}
		}
	}, 500);

	return pending.promise;
}
