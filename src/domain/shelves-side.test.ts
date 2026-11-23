import { describe, expect, it } from 'vitest'
import { shelfTypeU } from './constants'
import {
  clampShelvesToRack,
  findFirstGap,
  shelfSide,
  shelvesConflict,
  sumUBySide,
} from './shelves'
import type { Shelf, ShelfSide, ShelfType } from './types'

function shelf(id: string, shelfType: ShelfType, startU: number, side?: ShelfSide): Shelf {
  const s: Shelf = {
    id,
    u: shelfTypeU(shelfType),
    shelfType,
    startU,
    solid: true,
    color: '#000000',
    pattern: 'none',
  }
  if (side) s.side = side
  return s
}

describe('shelvesConflict', () => {
  it('lets a front plate and a back plate share a row', () => {
    const a = shelf('a', 'plate-1u', 5, 'front')
    const b = shelf('b', 'plate-1u', 5, 'back')
    expect(shelvesConflict(a, b)).toBe(false)
  })

  it('does not let a front open tray and a back open tray share a row', () => {
    const a = shelf('a', 'shelf-open-1u', 5, 'front')
    const b = shelf('b', 'shelf-open-1u', 5, 'back')
    expect(shelvesConflict(a, b)).toBe(true)
  })

  it('lets a front tray and a back plate share a row (180.12 + 8 fits)', () => {
    const a = shelf('a', 'shelf-open-1u', 5, 'front')
    const b = shelf('b', 'plate-1u', 5, 'back')
    expect(shelvesConflict(a, b)).toBe(false)
  })

  it('lets a slotted shelf (237) and a plate (8) share a row (245 fits)', () => {
    const a = shelf('a', 'shelf-slotted-1u', 5, 'front')
    const b = shelf('b', 'plate-1u', 5, 'back')
    expect(shelvesConflict(a, b)).toBe(false)
  })

  it('lets a slotted shelf (237) and a 40mm fan plate (6) share a row (243 fits)', () => {
    const a = shelf('a', 'shelf-slotted-1u', 5, 'front')
    const b = shelf('b', 'shelf-plate-40mm-fan-1u', 5, 'back')
    expect(shelvesConflict(a, b)).toBe(false)
  })

  it('stops a slotted shelf (237) and a keystone plate (9.51) sharing a row (246.51 is too deep)', () => {
    const a = shelf('a', 'shelf-slotted-1u', 5, 'front')
    const b = shelf('b', 'shelf-plate-keystone-1u', 5, 'back')
    expect(shelvesConflict(a, b)).toBe(true)
  })

  it('ignores shelves whose rows do not overlap', () => {
    const a = shelf('a', 'shelf-open-1u', 5, 'front')
    const b = shelf('b', 'shelf-open-1u', 4, 'back')
    expect(shelvesConflict(a, b)).toBe(false)
  })

  it('treats a shelf without side as front', () => {
    const legacy = shelf('a', 'plate-1u', 5)
    expect(shelfSide(legacy)).toBe('front')
    expect(shelvesConflict(legacy, shelf('b', 'plate-1u', 5, 'front'))).toBe(true)
    expect(shelvesConflict(legacy, shelf('c', 'plate-1u', 5, 'back'))).toBe(false)
  })
})

describe('findFirstGap by side', () => {
  it('ignores a front plate in the top row when looking for a back gap', () => {
    const shelves = [shelf('a', 'plate-1u', 5, 'front')]
    expect(findFirstGap(shelves, 6, 1, 'back')).toBe(5)
  })

  it('skips the top row for a front gap when a front plate is there', () => {
    const shelves = [shelf('a', 'plate-1u', 5, 'front')]
    expect(findFirstGap(shelves, 6, 1, 'front')).toBe(4)
  })

  it('treats a shelf without side as front when finding a gap', () => {
    const shelves = [shelf('a', 'plate-1u', 5)]
    expect(findFirstGap(shelves, 6, 1)).toBe(4)
    expect(findFirstGap(shelves, 6, 1, 'back')).toBe(5)
  })
})

describe('sumUBySide', () => {
  it('reports front and back units separately', () => {
    const shelves = [
      shelf('a', 'plate-2u', 4, 'front'),
      shelf('b', 'plate-1u', 3),
      shelf('c', 'shelf-open-1u', 2, 'back'),
    ]
    expect(sumUBySide(shelves)).toEqual({ front: 3, back: 1 })
  })
})

describe('clampShelvesToRack keeps side', () => {
  it('keeps back and drops anything else to front', () => {
    const out = clampShelvesToRack(
      [shelf('a', 'plate-1u', 5, 'back'), shelf('b', 'plate-1u', 4, 'front')],
      6,
    )
    expect(out.find((s) => s.id === 'a')?.side).toBe('back')
    expect(out.find((s) => s.id === 'b')?.side).toBeUndefined()
  })
})
