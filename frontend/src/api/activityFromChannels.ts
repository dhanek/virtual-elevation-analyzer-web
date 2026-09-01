/**
 * ONE zero-fill from decoded channel arrays to an `ActivityDataLike`
 * (Convergence plan, C2). Extracted from `loadGoldenRide.ts`, which now calls
 * it — one definition, so the fixture loader and the API cannot drift on
 * which absent channels are zero-filled.
 *
 * The arrays a caller does not supply (`wind_speed`, `air_density_data`,
 * `road_speed`, `battery_soc`, `heart_rate`, `cadence`, ...) are zero-filled
 * rather than omitted: the pipeline reads them, but none of them influences a
 * VE number.
 */
import type { ActivityDataLike } from "../state/AppState";
import type { RunActivityChannels } from "./schema";

export function activityFromChannels(
	channels: RunActivityChannels,
): ActivityDataLike {
	const zeros = (): number[] =>
		new Array<number>(channels.record_count).fill(0);

	return {
		timestamps: channels.timestamps,
		position_lat: channels.position_lat,
		position_long: channels.position_long,
		altitude: channels.altitude,
		velocity: channels.velocity,
		power: channels.power,
		air_speed: channels.air_speed ?? zeros(),
		distance: channels.distance,
		wind_speed: channels.wind_speed ?? zeros(),
		wind_yaw: channels.wind_yaw ?? zeros(),
		air_density_data: channels.air_density_data ?? zeros(),
		road_speed: channels.road_speed ?? zeros(),
		temperature: channels.temperature ?? zeros(),
		battery_soc: zeros(),
		heart_rate: zeros(),
		cadence: zeros(),
		record_count: channels.record_count,
	} as ActivityDataLike;
}
