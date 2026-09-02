/**
 * Minimal zip support for the settings bundle export/import — zero
 * dependencies, on purpose: the site is static Pages with four runtime deps,
 * and a zip library would be a fifth for what is ~200 lines of stable format.
 *
 * WRITER: store-only (method 0). The bundle is one FIT file (already a dense
 * binary) and one small JSON — compression would save little and cost a
 * deflate implementation.
 *
 * READER: methods 0 (stored) and 8 (deflate), because the import zone accepts
 * zips the USER made with OS tools, and Explorer/Finder both deflate. Deflate
 * is inflated with the platform's own `DecompressionStream("deflate-raw")`
 * (Chrome 103+, Firefox 113+, Safari 16.4+, Node 18+ — all older than the
 * WASM this app already requires), which is what keeps the reader
 * dependency-free too. Every entry's CRC-32 is verified on read: a corrupt
 * FIT that parses far enough to "work" is worse than a refused import.
 */

export interface ZipEntry {
	/** Path as stored in the archive (may contain directories). */
	name: string;
	data: Uint8Array;
}

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** General-purpose flag bit 11: the entry name is UTF-8. */
const UTF8_NAME_FLAG = 0x0800;

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c;
	}
	return table;
})();

export function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Build a store-only zip. Entry names must be unique and non-empty. */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const nameBytes = encoder.encode(entry.name);
		const crc = crc32(entry.data);

		const local = new Uint8Array(30 + nameBytes.length + entry.data.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, LOCAL_HEADER_SIG, true);
		lv.setUint16(4, 20, true); // version needed
		lv.setUint16(6, UTF8_NAME_FLAG, true);
		lv.setUint16(8, 0, true); // method: stored
		// Timestamps deliberately zero: the export is content, not history,
		// and a stable byte stream makes bundles diffable.
		lv.setUint32(14, crc, true);
		lv.setUint32(18, entry.data.length, true);
		lv.setUint32(22, entry.data.length, true);
		lv.setUint16(26, nameBytes.length, true);
		local.set(nameBytes, 30);
		local.set(entry.data, 30 + nameBytes.length);
		locals.push(local);

		const central = new Uint8Array(46 + nameBytes.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, CENTRAL_HEADER_SIG, true);
		cv.setUint16(4, 20, true); // version made by
		cv.setUint16(6, 20, true); // version needed
		cv.setUint16(8, UTF8_NAME_FLAG, true);
		cv.setUint16(10, 0, true); // method
		cv.setUint32(16, crc, true);
		cv.setUint32(20, entry.data.length, true);
		cv.setUint32(24, entry.data.length, true);
		cv.setUint16(28, nameBytes.length, true);
		cv.setUint32(42, offset, true);
		central.set(nameBytes, 46);
		centrals.push(central);

		offset += local.length;
	}

	const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, EOCD_SIG, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);

	const out = new Uint8Array(offset + centralSize + 22);
	let cursor = 0;
	for (const part of [...locals, ...centrals, eocd]) {
		out.set(part, cursor);
		cursor += part.length;
	}
	return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read every file entry of a zip. Directory entries are skipped. Throws with
 * a plain-language message on anything malformed — the caller shows it.
 */
export async function readZip(data: Uint8Array): Promise<ZipEntry[]> {
	// EOCD: scan back from the end (it ends with a variable-length comment).
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let eocdOffset = -1;
	for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
		if (view.getUint32(i, true) === EOCD_SIG) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset < 0) {
		throw new Error("Not a zip file (no end-of-archive record found).");
	}
	const entryCount = view.getUint16(eocdOffset + 10, true);
	let cursor = view.getUint32(eocdOffset + 16, true);

	const decoder = new TextDecoder();
	const entries: ZipEntry[] = [];
	for (let n = 0; n < entryCount; n++) {
		if (view.getUint32(cursor, true) !== CENTRAL_HEADER_SIG) {
			throw new Error("Corrupt zip: central directory entry missing.");
		}
		const method = view.getUint16(cursor + 10, true);
		const crc = view.getUint32(cursor + 16, true);
		const compressedSize = view.getUint32(cursor + 20, true);
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const commentLength = view.getUint16(cursor + 32, true);
		const localOffset = view.getUint32(cursor + 42, true);
		const name = decoder.decode(
			data.subarray(cursor + 46, cursor + 46 + nameLength),
		);
		cursor += 46 + nameLength + extraLength + commentLength;

		if (name.endsWith("/")) continue; // directory

		// The local header repeats name/extra with possibly different extra
		// length, so the data offset must be derived from the LOCAL header.
		if (view.getUint32(localOffset, true) !== LOCAL_HEADER_SIG) {
			throw new Error(`Corrupt zip: bad local header for "${name}".`);
		}
		const localNameLength = view.getUint16(localOffset + 26, true);
		const localExtraLength = view.getUint16(localOffset + 28, true);
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		const raw = data.subarray(dataStart, dataStart + compressedSize);

		let content: Uint8Array;
		if (method === 0) {
			content = new Uint8Array(raw);
		} else if (method === 8) {
			content = await inflateRaw(raw);
		} else {
			throw new Error(
				`Unsupported zip compression (method ${method}) for "${name}".`,
			);
		}
		if (crc32(content) !== crc) {
			throw new Error(`Corrupt zip: "${name}" failed its integrity check.`);
		}
		entries.push({ name, data: content });
	}
	return entries;
}
