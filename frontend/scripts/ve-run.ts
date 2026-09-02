/**
 * The headless CLI shim (Convergence plan, C10). Deliberately thin: argv,
 * file reads, WASM boot, stdout/exit-code discipline. Everything with meaning
 * lives in `src/api/` where it is type-checked, linted and tested.
 *
 *   npm run ve -- --config run.json
 *   npm run ve -- --file ride.fit --config run.json
 *   cat run.json | npm run ve -- --config -
 *   npm run ve -- --batch < runs.ndjson > results.ndjson
 *
 * Exit codes: 0 ok · 2 invalid config · 3 activity load / wasm missing ·
 * 4 no valid segments · 1 unexpected. Every code still writes a well-formed
 * `{ok:false, error}` envelope on stdout, so a batch driver never parses
 * stderr for structure.
 */
import { readFileSync, existsSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// STDOUT IS THE RESULT, AND ONLY THE RESULT. In node, console.log/info/debug
// write to stdout, and the update path logs per segment — one stray line
// corrupts every result in a batch, and it surfaces as a JSON error in the
// consumer. Redirect them all to stderr before anything else can run.
/* eslint-disable no-console */
console.log = console.error.bind(console)
console.info = console.error.bind(console)
console.debug = console.error.bind(console)
console.warn = console.error.bind(console)
/* eslint-enable no-console */

import init from '../pkg/virtual_elevation_analyzer.js'
import {
    loadRunActivity,
    runAnalysis,
    validateRunConfig,
    RUN_SCHEMA_VERSION,
    type LoadedRunActivity,
    type RunConfig,
    type RunResult,
} from '../src/api'

/**
 * Async, not `readFileSync(0)`: a stdin PIPE from a parent process (Python's
 * subprocess does this) can be non-blocking, where the sync read throws
 * EAGAIN. The stream API handles both shapes.
 */
async function readStdin(): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks).toString('utf8')
}

const WASM_PATH = fileURLToPath(
    new URL('../pkg/virtual_elevation_analyzer_bg.wasm', import.meta.url),
)

function emit(result: RunResult): void {
    process.stdout.write(JSON.stringify(result) + '\n')
}

function envelope(
    code: 'invalid-config' | 'activity-load-failed' | 'no-valid-segments' | 'internal',
    message: string,
    details?: Array<{ path: string; message: string; received?: unknown }>,
): RunResult {
    return {
        schemaVersion: RUN_SCHEMA_VERSION,
        ok: false,
        error: { code, message, details },
        warnings: [],
    }
}

function loadActivityFor(
    config: RunConfig,
    fileArg: string | null,
    configDir: string,
): LoadedRunActivity {
    if (fileArg) {
        return loadFromPath(fileArg, config.activity?.type)
    }
    if (config.activity?.path) {
        const path = isAbsolute(config.activity.path)
            ? config.activity.path
            : resolve(configDir, config.activity.path)
        return loadFromPath(path, config.activity.type)
    }
    if (config.activity?.inline?.channels) {
        return loadRunActivity({
            kind: 'channels',
            channels: config.activity.inline.channels,
            fileName: config.output?.fileName ?? 'inline',
        })
    }
    throw new Error('no activity: pass --file, activity.path, or activity.inline.channels')
}

function loadFromPath(path: string, declaredType?: 'fit' | 'csv'): LoadedRunActivity {
    const type = declaredType ?? (extname(path).toLowerCase() === '.csv' ? 'csv' : 'fit')
    return type === 'csv'
        ? loadRunActivity({ kind: 'csv', text: readFileSync(path, 'utf8'), fileName: basename(path) })
        : loadRunActivity({ kind: 'fit', bytes: new Uint8Array(readFileSync(path)), fileName: basename(path) })
}

async function runOne(
    raw: unknown,
    fileArg: string | null,
    configDir: string,
): Promise<{ result: RunResult; exitCode: number }> {
    const validated = validateRunConfig(raw)
    if (!validated.ok) {
        return { result: envelope('invalid-config', 'config failed validation', validated.errors), exitCode: 2 }
    }

    let activity: LoadedRunActivity
    try {
        activity = loadActivityFor(validated.value, fileArg, configDir)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { result: envelope('activity-load-failed', message), exitCode: 3 }
    }

    const { result } = await runAnalysis({ config: validated.value, activity })
    return { result, exitCode: result.ok ? 0 : 4 }
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2)
    const flag = (name: string): string | null => {
        const index = argv.indexOf(name)
        return index >= 0 ? argv[index + 1] ?? null : null
    }
    const batch = argv.includes('--batch')
    const fileArg = flag('--file')
    const configArg = flag('--config')

    if (!existsSync(WASM_PATH)) {
        emit(envelope('activity-load-failed',
            'pkg/ is missing — run `wasm-pack build --target web --out-dir ../frontend/pkg` in backend/'))
        process.exitCode = 3
        return
    }
    await init({ module_or_path: readFileSync(WASM_PATH) })

    if (batch) {
        // NDJSON in, NDJSON out: one `{file?, config}` per line, one result per
        // line, tagged nowhere — order is the correlation. A bad line emits its
        // envelope and the stream continues; a batch never aborts mid-sweep.
        const lines = (await readStdin()).split('\n').filter(line => line.trim().length > 0)
        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as { file?: string; config: unknown }
                const { result } = await runOne(entry.config, entry.file ?? null, process.cwd())
                emit(result)
            } catch (error) {
                emit(envelope('internal', error instanceof Error ? error.message : String(error)))
            }
        }
        return
    }

    if (!configArg) {
        emit(envelope('invalid-config', 'pass --config <path|-> (or --batch)'))
        process.exitCode = 2
        return
    }

    const configText = configArg === '-' ? await readStdin() : readFileSync(configArg, 'utf8')
    const configDir = configArg === '-' ? process.cwd() : dirname(resolve(configArg))

    let raw: unknown
    try {
        raw = JSON.parse(configText)
    } catch (error) {
        emit(envelope('invalid-config', `config is not JSON: ${error instanceof Error ? error.message : error}`))
        process.exitCode = 2
        return
    }

    const { result, exitCode } = await runOne(raw, fileArg, configDir)
    emit(result)
    process.exitCode = exitCode
}

void main().catch(error => {
    emit(envelope('internal', error instanceof Error ? error.stack ?? error.message : String(error)))
    process.exitCode = 1
})
