/**
 * The app's Plotly: core plus exactly the trace types it draws.
 *
 * `plotly.js/lib/core` carries `scatter` and every API the app calls (`react`,
 * `newPlot`, `purge`, `toImage`, `downloadImage`, `Plots.resize`). On top of
 * it: `contour` for the wind / power / VD / Convergence grids, and
 * `scatterpolar` for the Calibration tab's wind rose. A trace type that is not
 * registered here renders as nothing, so a new one has to be added below.
 *
 * Loaded only through `plotlyLoader.ts`'s dynamic `import()`, which keeps it in
 * its own chunk.
 */
import Plotly from "plotly.js/lib/core";
import contour from "plotly.js/lib/contour";
import scatterpolar from "plotly.js/lib/scatterpolar";

Plotly.register([contour, scatterpolar]);

export default Plotly;
