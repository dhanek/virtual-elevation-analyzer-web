import { log } from '../../utils/log'

/**
 * Typed DOM element lookup by ID.
 * Returns null if element is not found or is not an instance of T.
 */
export function getElement<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null
}

/**
 * Typed DOM element lookup by ID that throws if not found.
 * Use this when the element MUST exist for the feature to work.
 */
export function getRequiredElement<T extends HTMLElement>(id: string, context?: string): T {
    const element = getElement<T>(id)
    if (!element) {
        const message = context
            ? `Required DOM element "#${id}" not found (context: ${context})`
            : `Required DOM element "#${id}" not found`
        log.error(message)
        throw new Error(message)
    }
    return element
}
