import { describe, expect, it } from "vitest";
import { buildZip, crc32, readZip } from "./zip";

const text = (value: string) => new TextEncoder().encode(value);

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Build a minimal DEFLATED zip by hand — what Explorer/Finder produce and the
 * store-only writer never will, so the reader's method-8 path has no other
 * coverage.
 */
async function buildDeflatedZip(name: string, content: Uint8Array): Promise<Uint8Array> {
	const nameBytes = text(name);
	const compressed = await deflateRaw(content);
	const local = new Uint8Array(30 + nameBytes.length + compressed.length);
	const lv = new DataView(local.buffer);
	lv.setUint32(0, 0x04034b50, true);
	lv.setUint16(8, 8, true); // method: deflate
	lv.setUint32(14, crc32(content), true);
	lv.setUint32(18, compressed.length, true);
	lv.setUint32(22, content.length, true);
	lv.setUint16(26, nameBytes.length, true);
	local.set(nameBytes, 30);
	local.set(compressed, 30 + nameBytes.length);

	const central = new Uint8Array(46 + nameBytes.length);
	const cv = new DataView(central.buffer);
	cv.setUint32(0, 0x02014b50, true);
	cv.setUint16(10, 8, true);
	cv.setUint32(16, crc32(content), true);
	cv.setUint32(20, compressed.length, true);
	cv.setUint32(24, content.length, true);
	cv.setUint16(28, nameBytes.length, true);
	cv.setUint32(42, 0, true);
	central.set(nameBytes, 46);

	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, 1, true);
	ev.setUint16(10, 1, true);
	ev.setUint32(12, central.length, true);
	ev.setUint32(16, local.length, true);

	const out = new Uint8Array(local.length + central.length + 22);
	out.set(local, 0);
	out.set(central, local.length);
	out.set(eocd, local.length + central.length);
	return out;
}

describe("buildZip / readZip", () => {
	it("round-trips two entries byte-for-byte", async () => {
		const fit = new Uint8Array([0x0e, 0x10, 0x43, 0x08, 0x2e, 0x46, 0x49, 0x54, 7, 0]);
		const zipped = buildZip([
			{ name: "ride.fit", data: fit },
			{ name: "ride.ve-settings.json", data: text('{"a":1}') },
		]);
		const entries = await readZip(zipped);
		expect(entries.map(e => e.name)).toEqual(["ride.fit", "ride.ve-settings.json"]);
		expect(Array.from(entries[0].data)).toEqual(Array.from(fit));
		expect(new TextDecoder().decode(entries[1].data)).toBe('{"a":1}');
	});

	it("reads a DEFLATED zip, the shape OS archivers produce", async () => {
		const content = text("deflated settings payload ".repeat(40));
		const entries = await readZip(await buildDeflatedZip("bundle/ride.json", content));
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe("bundle/ride.json");
		expect(new TextDecoder().decode(entries[0].data)).toBe(
			new TextDecoder().decode(content),
		);
	});

	it("skips directory entries", async () => {
		const zipped = buildZip([
			{ name: "folder/", data: new Uint8Array(0) },
			{ name: "folder/ride.fit", data: text("x") },
		]);
		const entries = await readZip(zipped);
		expect(entries.map(e => e.name)).toEqual(["folder/ride.fit"]);
	});

	it("refuses a non-zip payload with a plain message", async () => {
		await expect(readZip(text("just some text, not a zip"))).rejects.toThrow(
			/not a zip file/i,
		);
	});

	it("refuses an entry whose bytes fail the CRC check", async () => {
		const zipped = buildZip([{ name: "ride.fit", data: text("healthy bytes") }]);
		zipped[38] ^= 0xff; // first content byte: 30-byte header + 8-byte name
		await expect(readZip(zipped)).rejects.toThrow(/integrity/i);
	});
});
