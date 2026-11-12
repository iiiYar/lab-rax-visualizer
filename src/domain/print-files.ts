import type { BuildState, DeviceType, PartType, ShelfType } from './types'
import { BASE_QUANTITIES, deviceLabel, isOptional, shelfTypeLabel, shelfTypeU } from './constants'
import {
  DEVICE_TYPE_PARTS,
  MODEL_FILES,
  SHELF_TYPE_FILES,
  SIDE_PANEL_FILES,
  VERTICAL_RAIL_FILES,
  decomposeIntoSegments,
} from './models'

/**
 * How a row in the print manifest may be used:
 * - `print`       the file in this repo is the printable part, as modelled.
 * - `review`      printable, but the mesh has open shells — repair before slicing.
 * - `source-only` listed for completeness; the file here is *not* a print source
 *                 (a bought device's visualisation mesh, a squashed viz mesh, or
 *                 a panel that is cut from acrylic rather than printed).
 */
export type PrintStatus = 'print' | 'review' | 'source-only'

export type PrintGroup = 'frame' | 'shelves' | 'accessories'

export interface PrintFile {
  file: string
  /** Human label for the part this file makes. */
  part: string
  /** How many copies the current build needs. */
  quantity: number
  status: PrintStatus
  group: PrintGroup
  note?: string
  /** Bounding box in the file's own axes, measured from the mesh (mm). */
  sizeMm?: [number, number, number]
  /**
   * Rack units this part occupies (1–12). Undefined for parts that do not map
   * to a U slot — feet, handles, top/bottom panels, and bought devices.
   */
  u?: number
}

/**
 * Measured with trimesh (`mesh.extents`) on every file in `public/models-3d`
 * — regenerate this table if a model is replaced. Kept here so the Excel
 * manifest and the zip README can tell a maker whether a part fits the bed
 * before they slice it.
 */
const FILE_SIZES: Record<string, [number, number, number]> = {
  // frame
  'rail-height-1u.stl': [30, 35, 44.45],
  'rail-height-2u.stl': [30, 35, 88.9],
  'rail-height-3u.stl': [30, 35, 133.35],
  'rail-height-4u.stl': [30, 35, 177.8],
  'rail-height-5u.stl': [30, 35, 222.25],
  'panel-side-1u.stl': [175.9, 3, 50.35],
  'panel-side-2u.stl': [175.9, 3, 94.8],
  'panel-side-3u.stl': [175.9, 3, 139.25],
  'panel-side-4u.stl': [175.9, 3, 183.7],
  'panel-side-5u.stl': [175.9, 3, 228.15],
  'rail-width.3mf': [282.25, 54.85, 54.85],
  'rail-depth.stl': [30, 170, 35],
  'panel-top-bottom.stl': [228.05, 171.5, 3],
  'foot.3mf': [26, 26, 12],
  'handle.3mf': [20, 170, 32.5],
  // shelves
  'plate-1u.stl': [252, 42, 8],
  'plate-2u.stl': [252, 86.45, 8],
  'shelf-open-1u.stl': [252.98, 180.12, 44.02],
  'shelf-slotted-1u.stl': [252, 237, 42],
  'shelf-plate-40mm-fan-1u.3mf': [252, 6, 42],
  'shelf-plate-80mm-fan-2u.stl': [252, 86.45, 5],
  'shelf-plate-keystone-1u.stl': [254, 44.5, 9.51],
  'shelf-sbc-7-2u.stl': [252, 9, 86.45],
  'shelf-minisforum-ms-1u.stl': [253.9, 179, 44.25],
  'shelf-tiny-rack-left-keystone.stl': [254, 190, 44.45],
  'shelf-hdd-8bay-3u.stl': [222, 193.5, 133.35],
  'shelf-minitx-2u.stl': [254, 181, 88.75],
  'shelf-minitx-gpu-3u.stl': [254, 180.88, 133.35],
  'shelf-mx64-1u.stl': [254.8, 180.4, 44.45],
  // printed accessories
  'device-hdd-caddy-handle.stl': [17.65, 9.5, 83.15],
}

/** Rails and side panels only exist in 1U–5U segments; a rack is stacked from them. */
function segmentFiles(
  rackU: number,
  files: Record<number, string>,
  part: string,
  perRack: number,
  material: 'printed' | 'acrylic',
): PrintFile[] {
  return decomposeIntoSegments(rackU).map((u) => ({
    file: files[u],
    part: `${part} ${u}U`,
    quantity: perRack,
    status: material === 'acrylic' ? 'source-only' : 'print',
    group: 'frame',
    u,
    note:
      material === 'acrylic'
        ? 'Acrylic option: cut from sheet, not printed — use the mesh outline as a cutting reference.'
        : undefined,
  }))
}

/**
 * Printable file(s) for one fixed structural part. Rail and panel lengths are
 * greedy-stacked segments, so an 8U rack needs 5U + 3U rails, not an 8U rail.
 */
export function printFilesForPart(state: BuildState, part: PartType): PrintFile[] {
  const rackU = state.rackU
  const material = state.parts[part]?.material ?? 'printed'

  switch (part) {
    case 'verticalRails':
      return segmentFiles(rackU, VERTICAL_RAIL_FILES, 'Height rail', BASE_QUANTITIES.verticalRails ?? 4, 'printed')
    case 'sidePanels':
      return segmentFiles(rackU, SIDE_PANEL_FILES, 'Side panel', BASE_QUANTITIES.sidePanels ?? 2, material)
    case 'widthRails':
      return [
        {
          file: MODEL_FILES.railHorizontalWidth,
          part: 'Width rail',
          quantity: BASE_QUANTITIES.widthRails ?? 3,
          status: 'print',
          group: 'frame',
          u: 1,
        },
      ]
    case 'heroEdge':
      return [
        {
          file: MODEL_FILES.railHorizontalWidth,
          part: 'Width rail',
          quantity: BASE_QUANTITIES.heroEdge ?? 1,
          status: 'print',
          group: 'frame',
          u: 1,
        },
      ]
    case 'horizontalEdges':
      return [
        {
          file: MODEL_FILES.railHorizontalDepth,
          part: 'Depth rail',
          quantity: BASE_QUANTITIES.horizontalEdges ?? 4,
          status: 'print',
          group: 'frame',
          u: 1,
        },
      ]
    case 'topPanel':
    case 'bottomPanel':
      return [
        {
          file: MODEL_FILES.panelTopBottom,
          part: 'Top / bottom panel',
          quantity: 1,
          status: material === 'acrylic' ? 'source-only' : 'print',
          group: 'frame',
          note:
            material === 'acrylic'
              ? 'Acrylic option: cut from sheet, not printed — use the mesh outline as a cutting reference.'
              : undefined,
        },
      ]
    case 'handles':
      return [
        {
          file: MODEL_FILES.handle,
          part: 'Handle',
          quantity: BASE_QUANTITIES.handles ?? 2,
          status: 'print',
          group: 'frame',
        },
      ]
    case 'feet':
      return [
        {
          file: MODEL_FILES.foot,
          part: 'Foot',
          quantity: BASE_QUANTITIES.feet ?? 4,
          status: 'print',
          group: 'frame',
        },
      ]
    default:
      return []
  }
}

/**
 * Per-shelf-type print caveats. Only the two entries that need one are listed;
 * every other shelf file is sliced as-is.
 */
const SHELF_NOTES: Partial<Record<ShelfType, { status: PrintStatus; note: string }>> = {
  'shelf-hdd-8bay-3u': {
    status: 'source-only',
    note:
      'Visualisation mesh: the real 147.5 mm shell is Z-squashed to exactly 3U here. ' +
      'Print from the MakerWorld "8-Bay Hard Drive Enclosure For Mini Rack" source (ID 2503273).',
  },
  'shelf-minisforum-ms-1u': {
    status: 'review',
    note:
      'Main shell is watertight, but the mesh also carries 12 small open front-panel ' +
      'detail shells. Delete them or run a manifold repair before slicing.',
  },
  'shelf-mx64-1u': {
    status: 'print',
    note:
      'Multi-body mesh: 64 separate closed solids (faceplate, rails, brackets). ' +
      'Lay them out as individual parts in the slicer.',
  },
}

/**
 * Caveats that belong to a mesh rather than to a build slot — the same file can
 * be reached from more than one part, so keying them by filename keeps them
 * from going stale when a row changes.
 */
const FILE_NOTES: Record<string, { status: PrintStatus; note: string }> = {
  'panel-top-bottom.stl': {
    status: 'review',
    note:
      'This mesh is a plain 228 x 171.5 x 3 mm slab (12 triangles, no screw holes). ' +
      'Use it as a cutting/drill template, or print panel-top-bottom-fan.stl, which ' +
      'shares the same footprint and carries the real cutouts.',
  },
}

/** Devices that are printed rather than bought. Everything else is real hardware. */
const PRINTED_DEVICES: Partial<Record<DeviceType, true>> = {
  'hdd-caddy-handle': true,
}

const DEVICE_NOTES: Partial<Record<DeviceType, string>> = {
  'hdd-caddy-handle': 'One printed handle per HDD bay — 8 per 8-bay enclosure.',
}

/**
 * Every file the current build references, flattened for the manifest and the
 * STL bundle. Quantities are summed per file, so an 8U build shows
 * `rail-height-5u.stl ×4` and `rail-height-3u.stl ×4`.
 */
export function printFiles(state: BuildState): PrintFile[] {
  const merged = new Map<string, PrintFile>()

  const add = (f: PrintFile) => {
    const sizeMm = FILE_SIZES[f.file]
    const fileNote = FILE_NOTES[f.file]
    const next: PrintFile = fileNote
      ? { ...f, status: f.status === 'source-only' ? f.status : fileNote.status, note: f.note ?? fileNote.note }
      : f
    const existing = merged.get(f.file)
    if (!existing) {
      merged.set(f.file, { ...next, sizeMm })
      return
    }
    existing.quantity += next.quantity
    // Keep the most cautious status if a file is shared by two rows.
    if (existing.status === 'print' && next.status !== 'print') existing.status = next.status
    if (!existing.note && next.note) existing.note = next.note
  }

  for (const part of ['verticalRails', 'heroEdge', 'widthRails', 'horizontalEdges', 'sidePanels', 'topPanel', 'bottomPanel', 'handles', 'feet'] as PartType[]) {
    if (isOptional(part) && !state.toggles[part]) continue
    for (const f of printFilesForPart(state, part)) add(f)
  }

  for (const shelf of state.shelves) {
    const note = SHELF_NOTES[shelf.shelfType]
    add({
      file: SHELF_TYPE_FILES[shelf.shelfType],
      part: shelfTypeLabel(shelf.shelfType),
      quantity: 1,
      status: note?.status ?? 'print',
      group: 'shelves',
      u: shelfTypeU(shelf.shelfType),
      note: note?.note,
    })
  }

  const deviceCounts = new Map<DeviceType, number>()
  for (const shelf of state.shelves) {
    for (const device of shelf.devices ?? []) {
      if (!device) continue
      deviceCounts.set(device, (deviceCounts.get(device) ?? 0) + 1)
    }
  }
  for (const [device, quantity] of deviceCounts) {
    const [first] = DEVICE_TYPE_PARTS[device]
    const printed = Boolean(PRINTED_DEVICES[device])
    add({
      file: first.file,
      part: deviceLabel(device),
      quantity,
      status: printed ? 'print' : 'source-only',
      group: 'accessories',
      note: printed
        ? DEVICE_NOTES[device]
        : 'Bought hardware, not printed — the mesh is a visualisation only.',
    })
  }

  // Group first, then rack height (1U → 12U) so a mixed build reads bottom-up
  // like the rack itself; parts outside the U grid (feet, panels, devices) go
  // last within their group.
  const order: Record<PrintGroup, number> = { frame: 0, shelves: 1, accessories: 2 }
  const statusOrder: Record<PrintStatus, number> = { print: 0, review: 1, 'source-only': 2 }
  const uKey = (f: PrintFile) => (f.u === undefined ? Number.POSITIVE_INFINITY : f.u)
  return [...merged.values()].sort(
    (a, b) =>
      order[a.group] - order[b.group] ||
      uKey(a) - uKey(b) ||
      statusOrder[a.status] - statusOrder[b.status] ||
      a.part.localeCompare(b.part),
  )
}
