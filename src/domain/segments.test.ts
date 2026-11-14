import { describe, expect, it } from 'vitest'
import {
  buildSlug,
  defaultSegments,
  isValidSegments,
  normalizeSegments,
  segmentLabel,
  segmentOptions,
  segmentTally,
} from './segments'

describe('segmentOptions', () => {
  it('lists every minimum-joint split, largest-first', () => {
    expect(segmentOptions(12)).toEqual([
      [5, 5, 2],
      [5, 4, 3],
      [4, 4, 4],
    ])
  })

  it('handles two-segment heights', () => {
    expect(segmentOptions(7)).toEqual([
      [5, 2],
      [4, 3],
    ])
  })

  it('returns a single segment at or below 5U', () => {
    expect(segmentOptions(5)).toEqual([[5]])
  })

  it('returns no options for a zero-height rack', () => {
    expect(segmentOptions(0)).toEqual([])
  })

  it('starts every list with the default stacking', () => {
    for (let n = 1; n <= 12; n++) {
      expect(segmentOptions(n)[0]).toEqual(defaultSegments(n))
    }
  })
})

describe('labels', () => {
  it('formats a split as segmentLabel', () => {
    expect(segmentLabel([5, 4, 3])).toBe('5+4+3')
  })

  it('tallies rails per length, largest length first', () => {
    expect(segmentTally([5, 5, 2])).toBe('5U ×2 · 2U ×1')
  })

  it('builds a filename-safe slug', () => {
    expect(buildSlug(12, [5, 5, 2])).toBe('12u-5-5-2')
    expect(buildSlug(5, [5])).toBe('5u')
  })
})

describe('isValidSegments', () => {
  it('accepts a split with the right count and sum', () => {
    expect(isValidSegments(12, [5, 5, 2])).toBe(true)
  })

  it('rejects a split whose sum is wrong', () => {
    expect(isValidSegments(12, [6, 6])).toBe(false)
    expect(isValidSegments(12, [5, 5])).toBe(false)
  })

  it('rejects non-arrays', () => {
    expect(isValidSegments(12, 'x')).toBe(false)
  })

  it('rejects a split with the wrong number of segments', () => {
    expect(isValidSegments(12, [4, 4, 4, 0])).toBe(false)
  })
})

describe('normalizeSegments', () => {
  // Sort behaviour is being added in parallel; this asserts the intended result.
  it('sorts a valid split largest-first', () => {
    expect(normalizeSegments(12, [2, 5, 5])).toEqual([5, 5, 2])
  })

  it('falls back to the default stacking for an invalid split', () => {
    expect(normalizeSegments(7, [5, 5, 2])).toEqual(defaultSegments(7))
    expect(normalizeSegments(7, [5, 5, 2])).toEqual([5, 2])
  })
})
