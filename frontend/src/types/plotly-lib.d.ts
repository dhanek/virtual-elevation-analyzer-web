/**
 * `plotly.js` ships its per-trace source modules (`lib/core`, `lib/contour`,
 * `lib/scatterpolar`) as untyped CommonJS, and the DefinitelyTyped package
 * describes the full prebuilt bundle rather than these entry points.
 *
 * The codebase already treats the Plotly handle as `any` at every call site
 * (`gpsLapPlots.ts:635`, `renderGpsLap.ts:75`, …), so declaring a richer type
 * here would be a fiction that the consumers immediately widen again. This
 * declaration exists to make the imports resolve, nothing more.
 */
declare module "plotly.js/lib/core" {
	const Plotly: { register(modules: unknown[]): void };
	export default Plotly;
}

declare module "plotly.js/lib/contour" {
	const contour: unknown;
	export default contour;
}

declare module "plotly.js/lib/scatterpolar" {
	const scatterpolar: unknown;
	export default scatterpolar;
}
