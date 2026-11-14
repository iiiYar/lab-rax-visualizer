import { describe, expect, it } from 'vitest'
import {
  JOINER_FILE,
  LONG_JOINER_FILE,
  joinerCount,
  joinerFile,
  printFiles,
} from './print-files'
import { makeDefaultBuild } from './defaults'

describe('joinerCount', () => {
  it('needs no joiners for a single segment', () => {
    expect(joinerCount([5])).toBe(0)
  })

  it('needs four joiners per joint', () => {
    expect(joinerCount([5, 3])).toBe(4)
    expect(joinerCount([5, 5, 2])).toBe(8)
    expect(joinerCount([4, 4, 4])).toBe(8)
  })
})

describe('joinerFile', () => {
  it('maps the short and long joiner models to their files', () => {
    expect(joinerFile('short')).toBe(JOINER_FILE)
    expect(joinerFile('long')).toBe(LONG_JOINER_FILE)
  })
})

describe('printFiles', () => {
  const build = {
    ...makeDefaultBuild(),
    rackU: 12,
    segments: [5, 4, 3],
    joinerModel: 'long' as const,
  }

  it('lists the long joiner with one per post per joint', () => {
    const rows = printFiles(build)
    const joiner = rows.find((r) => r.file === LONG_JOINER_FILE)
    expect(joiner).toBeDefined()
    expect(joiner?.quantity).toBe(8)
  })

  it('lists a height rail row for each segment length', () => {
    const rails = printFiles(build).filter((r) => r.part.startsWith('Height rail'))
    expect(rails.map((r) => r.part).sort()).toEqual([
      'Height rail 3U',
      'Height rail 4U',
      'Height rail 5U',
    ])
    for (const rail of rails) {
      expect(rail.quantity).toBe(4)
    }
  })
})

describe('joinerPrintSummary', () => {
  it('counts plates, not joiners, for the two-up long 3MF', async () => {
    const { joinerPrintSummary, LONG_JOINER_FILE, JOINER_FILE } = await import('./print-files')
    expect(joinerPrintSummary('long', 8)).toBe(`8 joiners — print ${LONG_JOINER_FILE} ×4 (2 per plate)`)
    expect(joinerPrintSummary('short', 8)).toBe(`8 × ${JOINER_FILE}`)
  })
})
