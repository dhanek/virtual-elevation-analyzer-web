export const DEM_INTERPOLATED_SMOOTHING_WINDOW = 5;

export function smoothDemMovingAverage(input: number[]): number[] {
	if (input.length === 0) {
		return [];
	}

	const radius = Math.floor(DEM_INTERPOLATED_SMOOTHING_WINDOW / 2);
	const output = new Array<number>(input.length);

	for (let i = 0; i < input.length; i++) {
		let sum = 0;
		let count = 0;
		const start = Math.max(0, i - radius);
		const end = Math.min(input.length - 1, i + radius);

		for (let j = start; j <= end; j++) {
			const value = input[j];
			if (!Number.isNaN(value)) {
				sum += value;
				count++;
			}
		}

		output[i] = count > 0 ? sum / count : input[i];
	}

	return output;
}
