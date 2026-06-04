/**
 * Named render delegate factories for analysis modes.
 *
 * Per D-06: delegates do NOT change analysis semantics. They are thin wrappers
 * that add logging and provide named import points for handleAnalyze to use
 * instead of anonymous inline lambdas.
 */
import type { ModeRenderCallbacks, StandardRenderArgs } from '../../modes/analysis/types';
import { log } from '../../utils/log';

/**
 * Wraps a standard-mode render function in a named delegate with debug logging.
 */
export function createStandardRenderDelegate(
    renderFn: (args: StandardRenderArgs) => Promise<void> | void,
): (args: StandardRenderArgs) => Promise<void> | void {
    return (args) => {
        log.debug('Standard render delegate invoked');
        return renderFn(args);
    };
}

/**
 * Wraps a GPS-lap render function in a named delegate with debug logging.
 */
export function createGpsLapRenderDelegate(
    renderFn: ModeRenderCallbacks['gpsLap'],
): ModeRenderCallbacks['gpsLap'] {
    return (args) => {
        log.debug('GPS lap render delegate invoked');
        return renderFn(args);
    };
}

/**
 * Wraps an out-and-back render function in a named delegate with debug logging.
 */
export function createOutAndBackRenderDelegate(
    renderFn: ModeRenderCallbacks['outAndBack'],
): ModeRenderCallbacks['outAndBack'] {
    return (args) => {
        log.debug('Out-and-back render delegate invoked');
        return renderFn(args);
    };
}

/**
 * Convenience factory that wraps each render callback in its named delegate
 * and returns a properly typed ModeRenderCallbacks object.
 *
 * This replaces the inline `callbacks: { standard: ..., gpsLap: ..., outAndBack: ... }`
 * construction currently in handleAnalyze.
 */
export function createModeRenderCallbacks(
    callbacks: {
        standard: (args: StandardRenderArgs) => Promise<void> | void;
        gpsLap: ModeRenderCallbacks['gpsLap'];
        outAndBack: ModeRenderCallbacks['outAndBack'];
    },
): ModeRenderCallbacks {
    return {
        standard: createStandardRenderDelegate(callbacks.standard),
        gpsLap: createGpsLapRenderDelegate(callbacks.gpsLap),
        outAndBack: createOutAndBackRenderDelegate(callbacks.outAndBack),
    };
}
