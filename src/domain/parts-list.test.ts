import { describe, expect, it } from 'vitest'
import { buildPartsList } from './parts-list'
import { makeDefaultBuild } from './defaults'

const build12 = (segments: number[]) => ({ ...makeDefaultBuild(), rackU: 12, segments })

describe('buildPartsList height rails', () => {
  it('splits 5+5+2 into one row per rail length, totalling 12', () => {
    const rails = buildPartsList(build12([5, 5, 2])).filter((r) => r.part.startsWith('Height rails'))
    const byLength = Object.fromEntries(rails.map((r) => [r.part, r.quantity]))
    expect(byLength).toEqual({
      'Height rails — 5u': 8,
      'Height rails — 2u': 4,
    })
    expect(rails.reduce((n, r) => n + r.quantity, 0)).toBe(12)
  })

  it('keeps 4+4+4 as a single 4U row totalling 12', () => {
    const rails = buildPartsList(build12([4, 4, 4])).filter((r) => r.part.startsWith('Height rails'))
    expect(rails).toHaveLength(1)
    expect(rails[0].part).toBe('Height rails — 4u')
    expect(rails[0].quantity).toBe(12)
  })
})
