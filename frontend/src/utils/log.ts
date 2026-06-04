export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 50,
}

function resolveLogLevel(): LogLevel {
    const configured = import.meta.env.VITE_LOG_LEVEL
    if (isLogLevel(configured)) {
        return configured
    }

    return import.meta.env.DEV ? 'info' : 'warn'
}

function isLogLevel(value: unknown): value is LogLevel {
    return typeof value === 'string' && value in LOG_LEVEL_PRIORITY
}

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[resolveLogLevel()]
}

function write(level: Exclude<LogLevel, 'silent'>, scope: string | undefined, args: unknown[]): void {
    if (!shouldLog(level)) {
        return
    }

    const prefixedArgs = scope ? [`[${scope}]`, ...args] : args
    switch (level) {
        case 'debug':
            console.debug(...prefixedArgs)
            break
        case 'info':
            console.info(...prefixedArgs)
            break
        case 'warn':
            console.warn(...prefixedArgs)
            break
        case 'error':
            console.error(...prefixedArgs)
            break
    }
}

export function createLogger(scope?: string) {
    return {
        debug: (...args: unknown[]) => write('debug', scope, args),
        info: (...args: unknown[]) => write('info', scope, args),
        warn: (...args: unknown[]) => write('warn', scope, args),
        error: (...args: unknown[]) => write('error', scope, args),
    }
}

export const log = createLogger()
