import { afterEach, describe, expect, it } from 'vitest'
import { setCustomShelves, type CustomShelf } from './custom-shelves'
import { shelfTypeDepth, shelfTypeLabel, shelfTypeU } from './constants'
import { makeDefaultBuild } from './defaults'
import { printFiles } from './print-files'
import { normalizeShelfType } from './shelves'
import type { BuildState, Shelf } from './types'

const TRAY: CustomShelf = {
  id: 'custom-1234abcd',
  label: 'Owner tray',
  u: 2,
  depthMm: 40,
  sizeMm: [252, 86.45, 40],
  rotX: 0,
  rotY: 0,
  rotZ: 90,
  file: 'custom-1234abcd.stl',
  originalName: 'Owner tray v2.stl',
  sha256: 'ab'.repeat(32),
  sourceUrl: 'https://example.com/tray',
  addedAt: '2026-11-20T00:00:00.000Z',
}

function shelfOf(shelfType: string): Shelf {
  return {
    id: 's2',
    u: 2,
    shelfType: shelfType as Shelf['shelfType'],
    startU: 0,
    solid: false,
    color: '#111111',
    pattern: 'none',
  }
}

function buildWith(shelves: Shelf[]): BuildState {
  return { ...makeDefaultBuild(), shelves }
}

afterEach(() => setCustomShelves([]))

describe('custom shelf registry', () => {
  it('looks up u, label and depth from the catalog', () => {
    setCustomShelves([TRAY])
    expect(shelfTypeU(TRAY.id)).toBe(2)
    expect(shelfTypeLabel(TRAY.id)).toBe('Owner tray')
    expect(shelfTypeDepth(TRAY.id)).toBe(40)
  })

  it('falls back to 1U, the id as label and a plate depth for an unknown id', () => {
    expect(shelfTypeU('custom-deadbeef')).toBe(1)
    expect(shelfTypeLabel('custom-deadbeef')).toBe('custom-deadbeef')
    expect(shelfTypeDepth('custom-deadbeef')).toBe(8)
  })
})

describe('normalizeShelfType for custom ids', () => {
  it('keeps a custom id even when the catalog is empty', () => {
    expect(normalizeShelfType(shelfOf('custom-1234abcd'))).toBe('custom-1234abcd')
  })
})

describe('printFiles for owner shelves', () => {
  it('emits a print row with the upload name, size and owner source', () => {
    setCustomShelves([TRAY])
    const row = printFiles(buildWith([shelfOf(TRAY.id)])).find((f) => f.customShelfId === TRAY.id)
    expect(row).toMatchObject({
      file: 'Owner_tray_v2.stl',
      part: 'Owner tray',
      quantity: 1,
      status: 'print',
      group: 'shelves',
      u: 2,
      sizeMm: [252, 86.45, 40],
      note: 'Added by the owner, source: https://example.com/tray',
      source: { kind: 'owner', label: 'Owner upload', url: 'https://example.com/tray' },
    })
  })

  it('skips a custom id the catalog does not know', () => {
    const shelvesRows = printFiles(buildWith([shelfOf('custom-deadbeef')])).filter(
      (f) => f.group === 'shelves',
    )
    expect(shelvesRows).toHaveLength(0)
  })
})
