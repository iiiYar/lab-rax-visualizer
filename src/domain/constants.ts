import type {
  DeviceType,
  OptionalPart,
  PartMaterial,
  PartType,
  PatternId,
  ShelfType,
  ShelfU,
} from './types'

// Work the whole scene in metres-ish units: divide mm by this scale factor so
// three.js camera framing stays in a comfortable range.
export const SCALE = 100

// --- Size range --------------------------------------------------------------
export const MIN_U = 4
export const MAX_U = 12
export const DEFAULT_U = 6

// --- Part types (menu order) -------------------------------------------------
export const PART_TYPES: PartType[] = [
  'horizontalEdges',
  'heroEdge',
  'widthRails',
  'verticalRails',
  'sidePanels',
  'topPanel',
  'bottomPanel',
  'handles',
  'feet',
  'shelves',
]

export const PART_LABELS: Record<PartType, string> = {
  horizontalEdges: 'Depth rails',
  heroEdge: 'Hero rail (front width)',
  widthRails: 'Width rails',
  verticalRails: 'Height rails',
  sidePanels: 'Side panels',
  topPanel: 'Top panel',
  bottomPanel: 'Bottom panel',
  handles: 'Handles',
  feet: 'Feet',
  shelves: 'Shelves',
}

export const OPTIONAL_PARTS: OptionalPart[] = [
  'sidePanels',
  'topPanel',
  'bottomPanel',
  'handles',
  'feet',
]

export function isOptional(part: PartType): part is OptionalPart {
  return (OPTIONAL_PARTS as PartType[]).includes(part)
}

// --- Patterns ----------------------------------------------------------------
export interface PatternDef {
  id: PatternId
  label: string
}

export const PATTERNS: PatternDef[] = [
  { id: 'none', label: 'None (plain)' },
  { id: 'honeycomb', label: 'Honeycomb' },
  { id: 'grid', label: 'Grid' },
  { id: 'vents', label: 'Vent slots' },
  { id: 'perf', label: 'Perforated' },
]

export function patternLabel(id: PatternId): string {
  return PATTERNS.find((p) => p.id === id)?.label ?? id
}

// --- Part materials ----------------------------------------------------------
// How a part is made, which drives how RackReal renders it. Panels can be cut
// from clear acrylic instead of printed; everything else is printed by default.
export interface MaterialDef {
  id: PartMaterial
  label: string
}

export const PART_MATERIALS: MaterialDef[] = [
  { id: 'printed', label: 'Printed' },
  { id: 'acrylic', label: 'Acrylic' },
]

export function materialLabel(id: PartMaterial): string {
  return PART_MATERIALS.find((m) => m.id === id)?.label ?? id
}

/** Parts whose material can be switched (the flat panels). */
export const MATERIAL_PARTS: PartType[] = ['sidePanels', 'topPanel', 'bottomPanel']

export function hasMaterialChoice(part: PartType): boolean {
  return MATERIAL_PARTS.includes(part)
}

// --- Shelf types ---------------------------------------------------------
// Real Lab Rax shelf parts, each its own fixed-size STL (see domain/models.ts).
export interface ShelfTypeDef {
  id: ShelfType
  label: string
  u: ShelfU
}

export const SHELF_TYPES: ShelfTypeDef[] = [
  { id: 'plate-1u', label: 'Plate (1U)', u: 1 },
  { id: 'plate-2u', label: 'Plate (2U)', u: 2 },
  { id: 'shelf-open-1u', label: 'Open shelf (1U)', u: 1 },
  { id: 'shelf-slotted-1u', label: 'Slotted shelf (1U)', u: 1 },
  { id: 'shelf-plate-40mm-fan-1u', label: '40mm fan plate (1U)', u: 1 },
  { id: 'shelf-plate-80mm-fan-2u', label: '80mm fan plate (2U)', u: 2 },
  { id: 'shelf-plate-keystone-1u', label: 'Keystone plate (1U)', u: 1 },
  { id: 'shelf-sbc-7-2u', label: 'SBC holder ×7 (2U)', u: 2 },
  { id: 'shelf-minisforum-ms-1u', label: 'Minisforum MS (1U)', u: 1 },
  { id: 'shelf-tiny-rack-left-keystone', label: 'Tiny rack left keystone (1U)', u: 1 },
]

export function shelfTypeU(id: ShelfType): ShelfU {
  return SHELF_TYPES.find((t) => t.id === id)?.u ?? 1
}

export function shelfTypeLabel(id: ShelfType): string {
  return SHELF_TYPES.find((t) => t.id === id)?.label ?? id
}

// --- Devices -----------------------------------------------------------------
// Real parts that bolt *into* a shelf's own mounting slots (fans behind a fan
// plate, drives in a cage, ...). Registry and labels live here; each device's
// own model parts (files + default colours) live in domain/models.ts
// (DEVICE_TYPE_PARTS).
export interface DeviceTypeDef {
  id: DeviceType
  label: string
}

export const DEVICE_TYPES: DeviceTypeDef[] = [
  { id: 'fan-noctua-40mm', label: 'Noctua 40mm fan' },
  { id: 'keystone-jack', label: 'Keystone jack' },
  { id: 'minisforum-ms-01', label: 'Minisforum MS-01' },
  { id: 'lenovo-tiny', label: 'Lenovo ThinkCentre Tiny' },
]

export function deviceLabel(id: DeviceType): string {
  return DEVICE_TYPES.find((d) => d.id === id)?.label ?? id
}

/**
 * Where a shelf model's device slots sit, measured from the model itself.
 * `x`/`y`/`z` are millimetres in the shelf part's own local frame — the same
 * frame the shelf mesh is positioned in at render time (origin at the
 * footprint centre, y = 0 on the shelf's bottom face, z centred on its own
 * thickness). A device's own geometry is also pivot-at-bottom-centre, so it
 * lands in a slot at `y - deviceHeight/2` and `z - deviceDepth/2`.
 */
export interface DeviceSlot {
  x: number
  y: number
  z: number
  /** Devices this slot accepts (first entry is what the editor's "fill all" uses). */
  accepts: DeviceType[]
}

export interface ShelfDeviceSlots {
  slots: DeviceSlot[]
}

/** X centres of the 1U keystone plate's ten socket openings, measured from the
 * model's own edge list: 15mm-wide bays on a 22mm pitch, centres at
 * ±(11, 33, 55, 77, 99)mm from the plate's centre, with 7mm walls between them
 * (and a 7mm seam either side of the middle). */
const KEYSTONE_PLATE_SLOT_X = [-99, -77, -55, -33, -11, 11, 33, 55, 77, 99]

/** The 1U keystone plate's socket bays in the shelf's own local frame: y is
 * the plate's vertical centre (measured 44.5mm between the outer rails), z is
 * the plate's rear face (measured 9.51mm thick, centred). */
const PLATE_KEYSTONE_OPEN_Y = 22.25
const PLATE_KEYSTONE_REAR_Z = -4.755

/** X centres of the 1U fan plate's five 38mm fan openings, measured from the
 * model: exactly 0, ±43.5, ±87mm from the plate's centre. */
const FAN_PLATE_SLOT_X = [-87, -43.5, 0, 43.5, 87]

export const SHELF_DEVICE_SLOTS: Partial<Record<ShelfType, ShelfDeviceSlots>> = {
  // "1U 40mm Fan Plate v2": a 252 x 42 x 6mm front plate with five 38 x 42mm
  // openings (43.5mm pitch) that take one 40mm fan each. The plate's own
  // mid-plane is z = 0 and it's 6mm thick, so its rear face is z = -3 — fans
  // mount flush behind it, blowing out through the openings.
  'shelf-plate-40mm-fan-1u': {
    slots: FAN_PLATE_SLOT_X.map((x) => ({ x, y: 21, z: -3, accepts: ['fan-noctua-40mm' as DeviceType] })),
  },
  // "Keystone plate (1U)": a 254 x 44.5 x 9.5mm front plate with ten 15mm
  // socket bays in a row (22mm pitch, 7mm walls). Each bay takes one standard
  // keystone jack, slid in from the rear: the jack body (16.6 x 18 x 28mm) is
  // wider than the 15mm bay, so it butts against the plate's rear face
  // (z = -4.755) with its dark socket insert facing out through the opening.
  'shelf-plate-keystone-1u': {
    slots: KEYSTONE_PLATE_SLOT_X.map((x) => ({
      x,
      y: PLATE_KEYSTONE_OPEN_Y,
      z: PLATE_KEYSTONE_REAR_Z,
      accepts: ['keystone-jack' as DeviceType],
    })),
  },
  // "Minisforum 10\" rack mount" body: 253.9 x 44.25 x 179mm printed shell that
  // replaces the machine's stock case, so the MS-01 (196 x 189 x 48mm) is the
  // one device that goes inside it. The machine is 10mm deeper than the shell
  // (the author's "a bit thicker than 1U" caveat), so the overhang is split:
  // front aligned 3mm behind the printed bezel face, taking 7mm at the rear.
  // Bottom sits on the shell's floor (y = 48/2 = 24); centred on X.
  'shelf-minisforum-ms-1u': {
    slots: [{ x: 0, y: 24, z: 86.5, accepts: ['minisforum-ms-01' as DeviceType] }],
  },
  // "Tiny rack mount left keystone" (STEP part "M720Q 1U v16"): a 254 x 44.45 x
  // 190mm 1U tray. Sectioning the STEP shows its floor is not the part's
  // underside but a raised deck at Z = -17.5 (prepared Y = 4.73mm), with the
  // walls rising to the 1U top — 39.7mm of usable interior, so the Lenovo Tiny
  // (182.9 x 179 x 34.5mm) fits with ~5mm of headroom. It sits centred on X, on
  // that raised floor, front-aligned 4mm behind the tray's front edge.
  'shelf-tiny-rack-left-keystone': {
    slots: [{ x: 0, y: 21.98, z: 91, accepts: ['lenovo-tiny' as DeviceType] }],
  },
}

export function shelfDeviceSlots(shelfType: ShelfType): DeviceSlot[] {
  return SHELF_DEVICE_SLOTS[shelfType]?.slots ?? []
}

/** Device types any slot of this shelf type accepts (empty = no device menu). */
export function shelfAcceptsDevices(shelfType: ShelfType): DeviceType[] {
  const out: DeviceType[] = []
  for (const slot of shelfDeviceSlots(shelfType)) {
    for (const d of slot.accepts) if (!out.includes(d)) out.push(d)
  }
  return out
}

export function shelfHasDeviceSlots(shelfType: ShelfType): boolean {
  return shelfDeviceSlots(shelfType).length > 0
}

// --- Base quantities for the parts list --------------------------------------
// Fixed-count parts. Shelves are computed from the shelf list, not this table.
export const BASE_QUANTITIES: Partial<Record<PartType, number>> = {
  verticalRails: 4, // four posts
  feet: 4,
  handles: 2,
  sidePanels: 2,
  topPanel: 1,
  bottomPanel: 1,
  heroEdge: 1,
  widthRails: 3, // the other 3 width rails (hero counted separately)
  horizontalEdges: 4, // top-left/top-right/bottom-left/bottom-right depth rails
}
