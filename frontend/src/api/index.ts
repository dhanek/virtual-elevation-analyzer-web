/**
 * The headless JSON API, in one import for the CLI shim
 * (`frontend/scripts/ve-run.ts`) and the round-trip tests.
 */
export { loadRunActivity } from "./loadActivity";
export type { LoadedRunActivity } from "./loadActivity";
export { runAnalysis } from "./runAnalysis";
export * from "./schema";
export { validateRunConfig } from "./validateRunConfig";
