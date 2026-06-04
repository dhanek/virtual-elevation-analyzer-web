import { describe, expect, it } from 'vitest'
import { getActivityFileType, validateActivityFile, validateFitMagicNumber } from './FileValidation'

function createFile(name: string, bytes: number[]): File {
    return new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream' })
}

describe('FileValidation', () => {
    it('detects supported activity file types from extensions', () => {
        expect(getActivityFileType(createFile('ride.fit', [1]))).toBe('fit')
        expect(getActivityFileType(createFile('ride.csv', [1]))).toBe('csv')
        expect(getActivityFileType(createFile('ride.txt', [1]))).toBe('unknown')
    })

    it('validates supported upload files by type and size', () => {
        expect(validateActivityFile(createFile('ride.fit', [1, 2, 3]))).toBe(true)
        expect(validateActivityFile(createFile('ride.csv', [1, 2, 3]))).toBe(true)
        expect(validateActivityFile(createFile('ride.txt', [1, 2, 3]))).toBe(false)
        expect(validateActivityFile(createFile('empty.fit', []))).toBe(false)
    })

    it('checks the FIT magic number in the header', async () => {
        const validFit = createFile('ride.fit', [14, 1, 0, 0, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54])
        const invalidFit = createFile('ride.fit', [14, 1, 0, 0, 0, 0, 0, 0, 0x2e, 0x58, 0x49, 0x54])

        await expect(validateFitMagicNumber(validFit)).resolves.toBe(true)
        await expect(validateFitMagicNumber(invalidFit)).resolves.toBe(false)
    })
})
