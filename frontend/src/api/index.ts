/**
 * The headless JSON API, in one import for the CLI shim
 * (`frontend/scripts/ve-run.ts`) and the round-trip tests.
 */
export { activityFromChannels } from "./activityFromChannels";
export { buildRunState } from "./buildRunState";
export { createHeadlessCallbacks } from "./headlessCallbacks";
export { loadRunActivity } from "./loadActivity";
export type { LoadedRunActivity, LoadRunActivityInput } from "./loadActivity";
export { runAnalysis } from "./runAnalysis";
export * from "./schema";
export { serializeRunResult } from "./serializeResult";
export { validateRunConfig } from "./validateRunConfig";
export type { ValidateRunConfigResult } from "./validateRunConfig";
