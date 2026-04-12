const MAX_UPLOAD_BYTES = 50_000_000
const MIN_FIT_HEADER_BYTES = 12
const FIT_SIGNATURE_OFFSET = 8
const FIT_SIGNATURE = [0x2e, 0x46, 0x49, 0x54] as const

export type SupportedActivityFileType = 'fit' | 'csv' | 'unknown'

export function validateActivityFile(file: File): boolean {
    const fileType = getActivityFileType(file)
    return fileType !== 'unknown' && file.size > 0 && file.size < MAX_UPLOAD_BYTES
}

export function getActivityFileType(file: File): SupportedActivityFileType {
    const fileName = file.name.toLowerCase()
    if (fileName.endsWith('.fit')) return 'fit'
    if (fileName.endsWith('.csv')) return 'csv'
    return 'unknown'
}

export async function validateFitMagicNumber(file: File): Promise<boolean> {
    try {
        const header = await file.slice(0, MIN_FIT_HEADER_BYTES).arrayBuffer()
        const view = new Uint8Array(header)

        return FIT_SIGNATURE.every((byte, index) => view[FIT_SIGNATURE_OFFSET + index] === byte)
    } catch {
        return false
    }
}
