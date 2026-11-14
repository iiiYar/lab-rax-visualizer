import { describe, expect, it } from 'vitest'
import { decodeBuild, encodeBuild } from './url-state'
import { makeDefaultBuild } from '../domain/defaults'

// Builds a share payload by hand, so a test can supply a `g` the encoder would
// never produce. Same base64url scheme as encodeBuild (payload is ASCII JSON).
function rawPayload(obj: unknown): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

describe('encodeBuild / decodeBuild', () => {
  it('round-trips rackU, segments and joinerModel', () => {
    const build = {
      ...makeDefaultBuild(),
      rackU: 12,
      segments: [4, 4, 4],
      joinerModel: 'long' as const,
    }
    const decoded = decodeBuild(encodeBuild(build))
    expect(decoded).not.toBeNull()
    expect(decoded?.rackU).toBe(12)
    expect(decoded?.segments).toEqual([4, 4, 4])
    expect(decoded?.joinerModel).toBe('long')
  })

  it('returns null for a malformed payload', () => {
    expect(decodeBuild('garbage!!')).toBeNull()
  })

  it('replaces an invalid split with the default stacking', () => {
    const decoded = decodeBuild(rawPayload({ u: 12, g: [5, 5] }))
    expect(decoded?.rackU).toBe(12)
    expect(decoded?.segments).toEqual([5, 5, 2])
  })
})
