/**
 * `plotly.js-basic-dist` ships a prebuilt bundle with no type declarations, and
 * the DefinitelyTyped package for it describes the full build rather than basic.
 *
 * The codebase already treats the Plotly handle as `any` at every call site
 * (`gpsLapPlots.ts:635`, `renderGpsLap.ts:75`, …), so declaring a richer type
 * here would be a fiction that the consumers immediately widen again. This
 * declaration exists to make the import resolve, nothing more.
 */
declare module "plotly.js-basic-dist" {
	const Plotly: unknown;
	export default Plotly;
}
