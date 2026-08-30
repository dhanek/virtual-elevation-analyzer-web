/**
 * Minimal FIT file writer, used only by tests.
 *
 * It exists so a parser regression can be pinned to ONE field being absent
 * rather than to a whole opaque binary: a test builds two files that differ by
 * a single lap field and asserts what the parser does with each.
 *
 * Only the slice of the FIT binary protocol the tests need is implemented:
 * little-endian, definition + data messages, no compressed timestamps, no
 * developer fields.
 */

/** FIT global message numbers used here. */
const MESG_FILE_ID = 0;
const MESG_RECORD = 20;
const MESG_LAP = 19;

/** FIT base type ids (the byte written into a field definition). */
const BASE_ENUM = 0x00;
const BASE_UINT8 = 0x02;
const BASE_SINT32 = 0x85;
const BASE_UINT16 = 0x84;
const BASE_UINT32 = 0x86;

type FieldDef = {
	/** Field definition number from the FIT profile for the owning message. */
	num: number;
	baseType: number;
	/** Encoded (scaled) value, as it appears on the wire. */
	value: number;
};

const CRC_TABLE = [
	0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001,
	0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function fitCrc(bytes: Uint8Array, seed = 0): number {
	let crc = seed;
	for (const byte of bytes) {
		let tmp = CRC_TABLE[crc & 0xf];
		crc = (crc >> 4) & 0x0fff;
		crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];

		tmp = CRC_TABLE[crc & 0xf];
		crc = (crc >> 4) & 0x0fff;
		crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
	}
	return crc & 0xffff;
}

function sizeOfBaseType(baseType: number): number {
	switch (baseType) {
		case BASE_ENUM:
		case BASE_UINT8:
			return 1;
		case BASE_UINT16:
			return 2;
		case BASE_SINT32:
		case BASE_UINT32:
			return 4;
		default:
			throw new Error(`unsupported base type 0x${baseType.toString(16)}`);
	}
}

/** Accumulates FIT data-section bytes and remembers the local message types. */
class FitWriter {
	private readonly chunks: number[] = [];
	/** Definition signature per local message type, so a repeat is not re-emitted. */
	private readonly defined = new Map<number, string>();

	private push(...bytes: number[]): void {
		this.chunks.push(...bytes);
	}

	private writeValue(baseType: number, value: number): void {
		const size = sizeOfBaseType(baseType);
		const buf = new DataView(new ArrayBuffer(size));
		if (size === 1) buf.setUint8(0, value & 0xff);
		else if (size === 2) buf.setUint16(0, value & 0xffff, true);
		else if (baseType === BASE_SINT32) buf.setInt32(0, value, true);
		else buf.setUint32(0, value >>> 0, true);
		this.push(...new Uint8Array(buf.buffer));
	}

	message(localType: number, globalNum: number, fields: FieldDef[]): void {
		const signature = `${globalNum}:${fields
			.map((f) => `${f.num}/${f.baseType}`)
			.join(",")}`;

		if (this.defined.get(localType) !== signature) {
			// Definition message: header bit 6 set, architecture 0 (little endian).
			this.push(0x40 | localType, 0x00, 0x00);
			this.push(globalNum & 0xff, (globalNum >> 8) & 0xff);
			this.push(fields.length);
			for (const field of fields) {
				this.push(field.num, sizeOfBaseType(field.baseType), field.baseType);
			}
			this.defined.set(localType, signature);
		}

		this.push(localType);
		for (const field of fields) {
			this.writeValue(field.baseType, field.value);
		}
	}

	finish(): Uint8Array {
		const data = Uint8Array.from(this.chunks);

		const header = new Uint8Array(14);
		const headerView = new DataView(header.buffer);
		headerView.setUint8(0, 14);
		headerView.setUint8(1, 0x10); // protocol version 1.0
		headerView.setUint16(2, 1320, true); // profile version
		headerView.setUint32(4, data.length, true);
		header.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
		headerView.setUint16(12, fitCrc(header.subarray(0, 12)), true);

		const file = new Uint8Array(header.length + data.length + 2);
		file.set(header, 0);
		file.set(data, header.length);
		new DataView(file.buffer).setUint16(
			file.length - 2,
			fitCrc(file.subarray(0, file.length - 2)),
			true,
		);
		return file;
	}
}

/** FIT timestamps count seconds since 1989-12-31T00:00:00Z. */
const FIT_EPOCH_OFFSET = 631_065_600;
/** The activity's first timestamp, as written on the wire (FIT epoch). */
export const FIT_START_TIME = 1_156_886_040;
/** The same instant as the parser reports it, in Unix seconds. */
export const UNIX_START_TIME = FIT_START_TIME + FIT_EPOCH_OFFSET;
export const SYNTHETIC_RECORD_COUNT = 60;

/** Constant power on every record, in watts. */
export const SYNTHETIC_POWER_W = 220;
/** Constant speed on every record, in m/s (8000 mm/s on the wire). */
export const SYNTHETIC_SPEED_MS = 8;
/** Distance advanced per record, in metres (800 cm on the wire). */
export const SYNTHETIC_STEP_M = 8;

// Semicircles: 2^31 / 180 per degree. Roughly the Santa Barbara coast.
const LAT_SEMICIRCLES = Math.round((34.4662 * 2 ** 31) / 180);
const LON_SEMICIRCLES = Math.round((-119.777 * 2 ** 31) / 180);
/** Coordinates of the first record, in degrees, after the parser's conversion. */
export const SYNTHETIC_START_LAT = (LAT_SEMICIRCLES * 180) / 2 ** 31;
export const SYNTHETIC_START_LON = (LON_SEMICIRCLES * 180) / 2 ** 31;

export type SyntheticFitOptions = {
	/**
	 * Emit `lap.total_elapsed_time` (field 7). GoldenCheetah's "export a
	 * selection" writes a lap WITHOUT it, which is the case this switch exists
	 * to reproduce.
	 */
	lapTotalElapsedTime: boolean;
	/**
	 * Emit the lap summary fields (`total_distance`, `avg_speed`, `max_speed`,
	 * `avg_power`). GoldenCheetah omits these too. The values written are
	 * deliberately NOT what the records imply, so a test can tell whether the
	 * parser reported the lap's own summary or a derived one.
	 */
	lapSummaryFields?: boolean;
};

/** Lap summary values written when `lapSummaryFields` is on. */
export const DECOY_LAP_SUMMARY = {
	totalDistance: 1234,
	avgSpeed: 5,
	maxSpeed: 11,
	avgPower: 199,
};

/**
 * One activity file: a file_id, `SYNTHETIC_RECORD_COUNT` one-second records
 * carrying GPS/power/speed/distance, and a single lap covering all of them.
 */
export function buildSyntheticFit(options: SyntheticFitOptions): Uint8Array {
	const writer = new FitWriter();

	writer.message(0, MESG_FILE_ID, [
		{ num: 0, baseType: BASE_ENUM, value: 4 }, // type = activity
		{ num: 1, baseType: BASE_UINT16, value: 1 }, // manufacturer
		{ num: 2, baseType: BASE_UINT16, value: 1 }, // product
		{ num: 3, baseType: BASE_UINT32, value: 1 }, // serial_number
		{ num: 4, baseType: BASE_UINT32, value: FIT_START_TIME }, // time_created
	]);

	for (let i = 0; i < SYNTHETIC_RECORD_COUNT; i++) {
		writer.message(1, MESG_RECORD, [
			{ num: 253, baseType: BASE_UINT32, value: FIT_START_TIME + i },
			{ num: 0, baseType: BASE_SINT32, value: LAT_SEMICIRCLES + i * 40 },
			{ num: 1, baseType: BASE_SINT32, value: LON_SEMICIRCLES + i * 40 },
			{ num: 2, baseType: BASE_UINT16, value: 3429 + i }, // altitude, (m + 500) * 5
			{
				num: 5,
				baseType: BASE_UINT32,
				value: i * SYNTHETIC_STEP_M * 100, // distance, cm
			},
			{
				num: 6,
				baseType: BASE_UINT16,
				value: SYNTHETIC_SPEED_MS * 1000, // speed, mm/s
			},
			{ num: 7, baseType: BASE_UINT16, value: SYNTHETIC_POWER_W }, // power, W
		]);
	}

	const lapFields: FieldDef[] = [
		{
			num: 253,
			baseType: BASE_UINT32,
			value: FIT_START_TIME + SYNTHETIC_RECORD_COUNT,
		}, // timestamp = lap end
		{ num: 254, baseType: BASE_UINT16, value: 0 }, // message_index
		{ num: 0, baseType: BASE_ENUM, value: 9 }, // event = lap
		{ num: 1, baseType: BASE_ENUM, value: 1 }, // event_type = stop
		{ num: 2, baseType: BASE_UINT32, value: FIT_START_TIME }, // start_time
	];
	if (options.lapTotalElapsedTime) {
		lapFields.push({
			num: 7,
			baseType: BASE_UINT32,
			value: SYNTHETIC_RECORD_COUNT * 1000, // total_elapsed_time, ms
		});
	}
	if (options.lapSummaryFields) {
		lapFields.push(
			{
				num: 9,
				baseType: BASE_UINT32,
				value: DECOY_LAP_SUMMARY.totalDistance * 100, // total_distance, cm
			},
			{
				num: 13,
				baseType: BASE_UINT16,
				value: DECOY_LAP_SUMMARY.avgSpeed * 1000, // avg_speed, mm/s
			},
			{
				num: 14,
				baseType: BASE_UINT16,
				value: DECOY_LAP_SUMMARY.maxSpeed * 1000, // max_speed, mm/s
			},
			{ num: 19, baseType: BASE_UINT16, value: DECOY_LAP_SUMMARY.avgPower },
		);
	}
	lapFields.push({ num: 24, baseType: BASE_ENUM, value: 7 }); // lap_trigger

	writer.message(2, MESG_LAP, lapFields);

	return writer.finish();
}
