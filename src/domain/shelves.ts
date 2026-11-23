import {
  SHELF_DEFAULT_DEVICES,
  SHELF_TYPES,
  SHELF_USABLE_DEPTH_MM,
  shelfDeviceSlots,
  shelfTypeDepth,
  shelfTypeU,
} from './constants'
import { isCustomShelfType } from './types'
import type { DeviceType, PartStyle, Shelf, ShelfSide, ShelfType, ShelfU } from './types'
import { customShelf } from './custom-shelves'
import { DEFAULT_STYLES } from './defaults'

/** Which rails a shelf hangs on. Shelves saved before rear shelves are front. */
export function shelfSide(shelf: Pick<Shelf, 'side'>): ShelfSide {
  return shelf.side ?? 'front'
}

/**
 * A copy of `shelf` on `side`. Front is stored as an absent field, so builds
 * that never use rear shelves serialize exactly as they did before.
 */
export function withShelfSide(shelf: Shelf, side: ShelfSide): Shelf {
  const next: Shelf = { ...shelf, side }
  if (side === 'front') delete next.side
  return next
}

/**
 * Whether a shelf on `side` with depth `depth` clashes with `other`, ignoring
 * rows. Same side always clashes; opposite sides clash only when the two parts
 * together are deeper than the rack's usable depth.
 */
function sideDepthConflict(side: ShelfSide, depth: number, other: Shelf): boolean {
  return side === shelfSide(other) || depth + shelfTypeDepth(other.shelfType) > SHELF_USABLE_DEPTH_MM
}

/**
 * Two shelves conflict when their rows overlap and they can't share that
 * space: the same side, or opposite sides whose depths sum past the usable
 * depth. So a front plate and a back plate can share a row, but a front tray
 * and a back tray cannot.
 */
export function shelvesConflict(a: Shelf, b: Shelf): boolean {
  if (a.startU + a.u <= b.startU || b.startU + b.u <= a.startU) return false
  return sideDepthConflict(shelfSide(a), shelfTypeDepth(a.shelfType), b)
}

/**
 * Deterministic id (Date.now/Math.random are avoided for reproducible
 * state) derived from the highest existing `sN` id in `existing` — a plain
 * incrementing module counter would restart at `s1` on every page load and
 * collide with ids already in a persisted/rehydrated shelf list.
 */
export function nextShelfId(existing: Shelf[]): string {
  let max = 0
  for (const s of existing) {
    const n = Number(/^s(\d+)$/.exec(s.id)?.[1])
    if (Number.isFinite(n)) max = Math.max(max, n)
  }
  return `s${max + 1}`
}

function makeShelf(
  shelfType: ShelfType,
  startU: number,
  existing: Shelf[],
  template?: Pick<PartStyle, 'color' | 'pattern' | 'solid'>,
): Shelf {
  const style = template ?? DEFAULT_STYLES.shelves
  return {
    id: nextShelfId(existing),
    u: shelfTypeU(shelfType),
    shelfType,
    startU,
    solid: style.solid,
    color: style.color,
    pattern: style.pattern,
    devices: normalizeShelfDevices(shelfType, undefined),
  }
}

const VALID_SHELF_TYPES = new Set(SHELF_TYPES.map((t) => t.id))

/**
 * Best-effort `shelfType` for a shelf that may predate this field (persisted
 * saves, share links) or carry a stale/unknown id — inferred from `solid` and
 * `u` so old builds still render as something sensible instead of crashing.
 */
export function normalizeShelfType(shelf: Shelf): ShelfType {
  // A custom id is kept on its syntax alone: builds load before the owner's
  // catalog arrives, and the shelf should still be there once it does.
  if (isCustomShelfType(shelf.shelfType)) return shelf.shelfType
  if (shelf.shelfType && VALID_SHELF_TYPES.has(shelf.shelfType)) return shelf.shelfType
  if (shelf.solid) return shelf.u >= 2 ? 'plate-2u' : 'plate-1u'
  return 'shelf-open-1u'
}

/**
 * Reshape a shelf's fitted-device list to its shelf type's own slot count —
 * always returns an array exactly `slots.length` long, `null` for empty slots.
 * Backfills shelves saved before `devices` existed (undefined -> the type's
 * `SHELF_DEFAULT_DEVICES` where one is declared, else all empty), trims the
 * list when the shelf type changed to one with fewer slots, and drops device
 * ids the new type doesn't accept, so a stale persisted/shared shelf can never
 * render more (or other) devices than the model has slots.
 */
export function normalizeShelfDevices(shelfType: ShelfType, devices: unknown): (DeviceType | null)[] {
  const slots = shelfDeviceSlots(shelfType)
  const out: (DeviceType | null)[] = new Array(slots.length).fill(null)
  // A zero-length list is a legacy artifact (this type had no slots when the
  // build was saved), not a user choice — no current path produces one for a
  // slotted type — so it heals to defaults exactly like a missing list.
  if (!Array.isArray(devices) || devices.length === 0) {
    // Mini-ITX 2U: three distinct components, one per slot.
    if (shelfType === 'shelf-minitx-2u') {
      out[0] = 'minitx-motherboard'
      out[1] = 'minitx-power-button'
      out[2] = 'minitx-pcie-card'
      return out
    }
    const def = isCustomShelfType(shelfType) ? undefined : SHELF_DEFAULT_DEVICES[shelfType]
    if (def) {
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].accepts.includes(def)) out[i] = def
      }
    }
    return out
  }
  for (let i = 0; i < slots.length; i++) {
    const device = devices[i]
    if (typeof device === 'string' && slots[i].accepts.includes(device as DeviceType)) {
      out[i] = device as DeviceType
    }
  }
  return out
}

export function sumU(shelves: Shelf[]): number {
  return shelves.reduce((n, s) => n + s.u, 0)
}

/** Rack units used by shelves on each side. */
export function sumUBySide(shelves: Shelf[]): { front: number; back: number } {
  const out = { front: 0, back: 0 }
  for (const s of shelves) out[shelfSide(s)] += s.u
  return out
}

/**
 * Rows (0-indexed from the bottom) a candidate shelf on `side` with depth
 * `depth` cannot use, because some other shelf in that row conflicts with it.
 */
function occupiedRows(
  shelves: Shelf[],
  rackU: number,
  side: ShelfSide = 'front',
  depth = 8,
  excludeId?: string,
): boolean[] {
  const occupied = new Array(rackU).fill(false)
  for (const s of shelves) {
    if (s.id === excludeId) continue
    if (!sideDepthConflict(side, depth, s)) continue
    for (let i = s.startU; i < s.startU + s.u && i < rackU; i++) {
      if (i >= 0) occupied[i] = true
    }
  }
  return occupied
}

/**
 * First available row with `size` contiguous free rows on `side`, scanning
 * from the TOP of the rack down — so the first shelf added lands at the top,
 * and each one after it fills into the next gap below. `depth` is the
 * candidate's depth (defaults to a 1U plate). Returns null if no such gap
 * exists anywhere, used to decide whether "add shelf" is enabled.
 */
export function findFirstGap(
  shelves: Shelf[],
  rackU: number,
  size: ShelfU = 1,
  side: ShelfSide = 'front',
  depth = 8,
): number | null {
  const occupied = occupiedRows(shelves, rackU, side, depth)
  for (let start = rackU - size; start >= 0; start--) {
    let fits = true
    for (let i = start; i < start + size; i++) {
      if (occupied[i]) {
        fits = false
        break
      }
    }
    if (fits) return start
  }
  return null
}

/**
 * How large a shelf whose top sits at `topRow` could grow, extending
 * downward with its top held fixed, without overlapping another shelf or
 * going below row 0. Growth has to extend *down*, not up: shelves are
 * always placed flush against whatever's directly above them (see
 * `findFirstGap`, which always returns the highest free row), so there's
 * never free space above a shelf to grow into — only below it. Used to cap
 * the shelf-type selector so a shelf can never be resized into occupied or
 * out-of-bounds space.
 */
export function maxDownGrowth(
  shelves: Shelf[],
  shelfId: string,
  topRow: number,
  side: ShelfSide = 'front',
  depth = 8,
): number {
  const occupied = new Set<number>()
  for (const s of shelves) {
    if (s.id === shelfId) continue
    if (!sideDepthConflict(side, depth, s)) continue
    for (let i = s.startU; i < s.startU + s.u; i++) occupied.add(i)
  }
  let size = 0
  for (let row = topRow; row >= 0; row--) {
    if (occupied.has(row)) break
    size++
  }
  return size
}

/**
 * Drop shelves that no longer fit at all after a rack resize. Each shelf is
 * now a fixed-size real part (size follows `shelfType`, e.g. always 2U for
 * plate-2u), so a shelf that no longer fits can't be shrunk to fit — it's
 * dropped instead. Also backfills `shelfType` on older saves that predate
 * it, and reassigns a fresh id to any shelf whose id collides with an
 * earlier one in the list (self-healing a previous id-generation bug —
 * see `nextShelfId` — rather than leaving broken persisted/shared state
 * stuck with duplicate React keys forever). No auto-fill — gaps (including
 * "no shelves at all") are allowed; this only removes what genuinely
 * doesn't fit anymore.
 *
 * Also the one place a shelf's fitted-device list is normalized to its type's
 * own slot count (see `normalizeShelfDevices`), which is what keeps persisted
 * and shared builds that predate `devices` — or that carry a shelf type the
 * build no longer uses — rendering instead of crashing.
 */
export function clampShelvesToRack(shelves: Shelf[], rackU: number): Shelf[] {
  let maxId = 0
  for (const s of shelves) {
    const n = Number(/^s(\d+)$/.exec(s.id)?.[1])
    if (Number.isFinite(n)) maxId = Math.max(maxId, n)
  }
  const result: Shelf[] = []
  const seenIds = new Set<string>()
  for (const shelf of shelves) {
    if (!Number.isFinite(shelf.startU) || !Number.isFinite(shelf.u)) continue
    if (shelf.startU < 0 || shelf.startU >= rackU) continue
    const shelfType = normalizeShelfType(shelf)
    // A custom shelf the catalog does not know yet keeps the U it was saved
    // with (the catalog's U takes over once it loads), not the 1U fallback.
    const u =
      isCustomShelfType(shelfType) && !customShelf(shelfType)
        ? (Number.isInteger(shelf.u) && shelf.u >= 1 && shelf.u <= 4 ? shelf.u : 1)
        : shelfTypeU(shelfType)
    if (shelf.startU + u > rackU) continue
    const id = seenIds.has(shelf.id) ? `s${++maxId}` : shelf.id
    seenIds.add(id)
    const clamped: Shelf = { ...shelf, id, shelfType, u, devices: normalizeShelfDevices(shelfType, shelf.devices) }
    // Only 'back' is kept; anything else is a front shelf (field omitted).
    if (shelf.side === 'back') clamped.side = 'back'
    else delete clamped.side
    result.push(clamped)
  }
  return result
}

/** Default build: a single 1U example shelf at the top of the rack. */
export function defaultShelves(rackU: number): Shelf[] {
  const shelfType: ShelfType = 'plate-1u'
  return [makeShelf(shelfType, rackU - shelfTypeU(shelfType), [])]
}

export { makeShelf }
