export type PatternId = 'none' | 'honeycomb' | 'grid' | 'vents' | 'perf'

export type PartType =
  | 'horizontalEdges'
  | 'heroEdge'
  | 'widthRails'
  | 'verticalRails'
  | 'sidePanels'
  | 'topPanel'
  | 'bottomPanel'
  | 'handles'
  | 'feet'
  | 'shelves'

/** Parts that can be toggled on/off (the rest are always present). */
export type OptionalPart =
  | 'handles'
  | 'feet'
  | 'sidePanels'
  | 'topPanel'
  | 'bottomPanel'

/**
 * How a part is made, which drives how it renders. `printed` is the default
 * opaque filament look; `acrylic` is a clear/tinted panel (transparent, low
 * roughness) — e.g. laser-cut acrylic side panels instead of printed ones.
 */
export type PartMaterial = 'printed' | 'acrylic'

export interface PartStyle {
  color: string
  pattern: PatternId
  /** When a pattern is set: true = solid backplate behind voids, false = open voids. */
  solid: boolean
  material: PartMaterial
}

export type ShelfU = 1 | 2 | 3 | 4

/** Real Lab Rax shelf parts, each modeled as its own fixed-size STL/3MF. */
export type ShelfType =
  | 'plate-1u'
  | 'plate-2u'
  | 'shelf-open-1u'
  | 'shelf-slotted-1u'
  | 'shelf-plate-40mm-fan-1u'
  | 'shelf-plate-80mm-fan-2u'
  | 'shelf-plate-keystone-1u'
  | 'shelf-sbc-7-2u'
  | 'shelf-minisforum-ms-1u'
  | 'shelf-tiny-rack-left-keystone'

/**
 * Devices that can be fitted *into* a shelf's own mounting slots (fans behind
 * a fan plate, keystone jacks in a keystone plate, ...). Each shelf type
 * declares how many slots it has and which devices each slot accepts — see
 * `SHELF_DEVICE_SLOTS` in domain/constants.ts and the model files in
 * domain/models.ts.
 */
export type DeviceType = 'fan-noctua-40mm' | 'keystone-jack' | 'minisforum-ms-01' | 'lenovo-tiny'

export interface Shelf {
  id: string
  /** Derived from `shelfType` — kept as its own field since it drives layout
   * (row math, gap-finding) independently of which model renders. */
  u: ShelfU
  shelfType: ShelfType
  /** Row (0-indexed from the bottom of the rack) this shelf's bottom sits at.
   * Shelves are independently positioned — gaps and "no shelves" are both
   * valid; they are not forced to fill or stack contiguously. */
  startU: number
  /** true = solid shelf, false = shelf with a center hole (for visualization). */
  solid: boolean
  color: string
  pattern: PatternId
  /** Devices fitted into this shelf's own slots, in the shelf model's slot
   * order — one entry per slot, `null` = empty. Always normalized to the
   * shelf type's slot count by `clampShelvesToRack`, so persisted builds and
   * share links that predate the field (or carry a stale shelf type) can't
   * leave it a different length than the model renders. */
  devices?: (DeviceType | null)[]
  /** Per-part colour overrides for the devices fitted above, index-parallel to
   * that device's own parts (see `DEVICE_TYPE_PARTS` in domain/models.ts) — any
   * missing entry falls back to the part's real-world default, so the list
   * needs no length normalization. */
  deviceColors?: string[]
}
export type Toggles = Record<OptionalPart, boolean>

/**
 * Per-part-type viewport visibility. Distinct from Toggles: a part can be
 * included in the build (and export) but temporarily hidden in the 3D view,
 * or vice versa. Not part of BuildState — it's a viewing preference, not
 * something to persist or share.
 */
export type PartVisibility = Record<PartType, boolean>

export const PALETTE_SIZE = 6

/** A shared 6-color palette; part swatches pick from this instead of a full picker. */
export type Palette = string[]

export interface BuildState {
  rackU: number
  parts: Record<PartType, PartStyle>
  toggles: Toggles
  shelves: Shelf[]
  palette: Palette
}
