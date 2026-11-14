import type { BuildState, DeviceType, JoinerModel, PartType, ShelfType } from './types'
import { BASE_QUANTITIES, deviceLabel, isOptional, shelfTypeLabel, shelfTypeU } from './constants'
import { sourceFor, type PartSource } from './sources'
import {
  DEVICE_TYPE_PARTS,
  MODEL_FILES,
  SHELF_TYPE_FILES,
  SIDE_PANEL_FILES,
  VERTICAL_RAIL_FILES,
  joinerCountFor,
} from './models'

/**
 * How a row in the print manifest may be used:
 * - `print`       the file in this repo is the printable part, as modelled.
 * - `review`      printable, but the mesh has open shells — repair before slicing.
 * - `source-only` listed for completeness; the file here is *not* a print source
 *                 (a bought device's visualisation mesh, a squashed viz mesh, or
 *                 a panel that is cut from acrylic rather than printed).
 * - `download`    required by the build and printed in the real thing, but this
 *                 app has no mesh for it — only a flat stand-in drawn for the 3D
 *                 view, or nothing at all. The row points at the source page and
 *                 is never written into the archive, so nobody hunts for a file
 *                 that was never there. Used by the side and bottom panels.
 */
export type PrintStatus = 'print' | 'review' | 'source-only' | 'download'

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
  /** Where the file came from — see domain/sources.ts. */
  source?: PartSource
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
  'panel-top-bottom-fan.stl': [228.05, 171.5, 3],
  'post-joiner.stl': [23.85, 39.7, 7],
  // Measured on the 3MF's own mesh (3D/Objects/object_18.model), not the plate:
  // the plate holds two copies 217.7 × 39.7 × 7 mm side by side.
  'joiner-brass-insert-PETG.3mf': [217.7, 39.7, 7],
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

/** Rails only exist in 1U–5U segments; a rack is stacked from them. */
function segmentFiles(
  segments: number[],
  files: Record<number, string>,
  part: string,
  perRack: number,
): PrintFile[] {
  return segments.map((u) => ({
    file: files[u],
    part: `${part} ${u}U`,
    quantity: perRack,
    status: 'print',
    group: 'frame',
    u,
  }))
}

/**
 * Side panels also come in 1U–5U segments, but the panel files in this repo are
 * flat 12-triangle boxes drawn to give the 3D view something upright — they are
 * not the designer's parts. So a printed panel is a `download` row that sends
 * the maker to the page holding the real panel, never a row that offers the
 * stand-in as a file to slice.
 */
function sidePanelFiles(segments: number[], material: 'printed' | 'acrylic'): PrintFile[] {
  const stacked = segments.length > 1
  const note =
    material === 'acrylic'
      ? "Acrylic option: cut from sheet, not printed — the size listed is this app's " +
        "outline; take edge and hole details from the designer's panel on the source page."
      : 'This app only has a flat stand-in of this panel for the 3D view; print ' +
        "the designer's panel from the posts & panels page (1294478)."
  // Every side panel here is its segment height + 5.9 mm in this app's outline,
  // so stacking two segments makes the panels overlap by that much at the joint.
  // Nothing in this app says which panels the designer intends for added
  // segments, so the note points at the extension pack rather than guessing.
  const stackNote =
    material === 'acrylic'
      ? 'Cut one full-height sheet per side rather than stacking segment outlines, ' +
        "which overlap 5.9 mm at each joint in this app's outline."
      : "In this app's outline each panel is 5.9 mm taller than its segment, so " +
        "stacked panels overlap at every joint — check the designer's extension " +
        'pack (1304384, https://makerworld.com/en/models/1304384) for the panels ' +
        'meant for added segments.'

  return segments.map((u) => ({
    file: SIDE_PANEL_FILES[u],
    part: `Side panel ${u}U`,
    quantity: BASE_QUANTITIES.sidePanels ?? 2,
    status: material === 'acrylic' ? 'source-only' : 'download',
    group: 'frame',
    u,
    note: stacked ? `${note} ${stackNote}` : note,
  }))
}

/**
 * Printable file(s) for one fixed structural part. Rail and panel lengths are
 * greedy-stacked segments, so an 8U rack needs 5U + 3U rails, not an 8U rail.
 */
export function printFilesForPart(state: BuildState, part: PartType): PrintFile[] {
  const material = state.parts[part]?.material ?? 'printed'

  switch (part) {
    case 'verticalRails':
      return segmentFiles(
        state.segments,
        VERTICAL_RAIL_FILES,
        'Height rail',
        BASE_QUANTITIES.verticalRails ?? 4,
      )
    case 'sidePanels':
      return sidePanelFiles(state.segments, material)
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
    // The top cover is the kit's vented panel — the part with the fan openings,
    // and the only top file here that is a real mesh. The plain slab is a
    // 12-triangle stand-in drawn for the viewer, so the bottom row below points
    // at the page with the real panel instead of offering that file.
    case 'topPanel':
      return [
        {
          file: MODEL_FILES.panelTopBottomFan,
          part: 'Top panel (vented)',
          quantity: 1,
          status: material === 'acrylic' ? 'source-only' : 'print',
          group: 'frame',
          note:
            material === 'acrylic'
              ? "Acrylic option: cut from sheet, not printed — the size listed is this app's " +
                "outline; take edge and hole details from the designer's panel on the source page."
              : 'The 5U kit\u2019s top cover: same footprint as the slab, with the fan openings cut in.',
        },
      ]
    case 'bottomPanel':
      return [
        {
          file: MODEL_FILES.panelTopBottom,
          part: 'Bottom panel',
          quantity: 1,
          // Same story as the side panels: the slab here is a stand-in, so a
          // printed bottom is a row that names the real panel and its page.
          status: material === 'acrylic' ? 'source-only' : 'download',
          group: 'frame',
          note:
            material === 'acrylic'
              ? "Acrylic option: cut from sheet, not printed — the size listed is this app's " +
                "outline; take edge and hole details from the designer's panel on the source page."
              : "This app only has a flat stand-in of this panel; get the designer's " +
                'top/bottom panel from the 5U kit page (1294480), or print the vented ' +
                'top cover `panel-top-bottom-fan.stl` a second time — same outer size ' +
                '(228.05 × 171.5 × 3 mm); check its holes suit the bottom.',
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
// Empty on purpose: the last entry was `panel-top-bottom.stl`, and that row now
// carries its own `download` status and note — a file-level override here would
// only fight it. The map stays for the next mesh that needs one.
const FILE_NOTES: Partial<Record<string, { status: PrintStatus; note: string }>> = {}

/** Devices that are printed rather than bought. Everything else is real hardware. */
const PRINTED_DEVICES: Partial<Record<DeviceType, true>> = {
  'hdd-caddy-handle': true,
}

const DEVICE_NOTES: Partial<Record<DeviceType, string>> = {
  'hdd-caddy-handle': 'One printed handle per HDD bay — 8 per 8-bay enclosure.',
}

/**
 * Rails and panels are stacked from 1–5U segments, so every rack taller than 5U
 * has at least one joint, and the designer's joiner is a printed part: one per
 * post, four posts. 8U stacks 5+3 → 4 joiners; 12U stacks 5+5+2 → 8, and the
 * same 12U stacked 4+4+4 also needs 8 — the count follows the number of
 * segments, which is why this takes the split rather than the height.
 */
export function joinerCount(segments: number[]): number {
  return joinerCountFor(segments, BASE_QUANTITIES.verticalRails ?? 4)
}

/**
 * The joiner ships in the designer's extension pack (model 1304384) rather than
 * in the 5U kit, so it was the one frame part missing from this repo. It is now
 * in `public/models-3d`, taken from that pack — never redrawn, because a joiner
 * drawn from a description is a joiner that does not fit the posts.
 *
 * The pack carries two variants: `Brass Insert Post Joiner.stl`, which matches
 * the heat-set inserts the rest of the frame uses, and a bolted 3MF for the
 * bolted kit. This build is the insert one; the bolted variant is on the model
 * page for anyone running `1464819`.
 *
 * The long 3MF is the same idea stretched over 217.7 mm instead of 39.7 mm — a
 * file the owner supplied, kept byte-for-byte (see REFERENCE_HASHES) and
 * offered as a second choice for the joint rather than redrawn.
 */
export const JOINER_FILE = 'post-joiner.stl'
export const LONG_JOINER_FILE = 'joiner-brass-insert-PETG.3mf'

export function joinerFile(model: JoinerModel): string {
  return model === 'long' ? LONG_JOINER_FILE : JOINER_FILE
}

/**
 * `8 × post-joiner.stl` for the short plate; for the long 3MF, whose plate
 * carries two joiners, `8 joiners — print joiner-…3mf ×4 (2 per plate)`. Used
 * by the readme and the Requirements sheet so neither tells a maker to print
 * the two-up plate once per joiner.
 */
export function joinerPrintSummary(model: JoinerModel, joiners: number): string {
  if (model === 'long') {
    return `${joiners} joiners — print ${LONG_JOINER_FILE} ×${Math.ceil(joiners / 2)} (2 per plate)`
  }
  return `${joiners} × ${JOINER_FILE}`
}

/** One line per joiner choice, so the print list says which plate to print. */
function joinerNote(model: JoinerModel, joints: number, joiners: number): string {
  // "above 5U" was only true for 5+…; a 4+4+4 split has its joints at 4U and 8U.
  const jointText = joints === 1 ? 'One joint' : `${joints} joints`
  if (model === 'long') {
    // The 3MF's plate already carries two joiners, so the quantity (joiners)
    // is not the number of times to print the file.
    const plates = Math.ceil(joiners / 2)
    return (
      `${jointText}, one joiner per post — four posts per joint. Long brass-insert ` +
      'version: 217.7 mm against the short plate’s 39.7 mm, PETG. The 3MF plate ' +
      `holds two joiners: print it ${plates} ${plates === 1 ? 'time' : 'times'} for ${joiners}.`
    )
  }
  return (
    `${jointText}, one joiner per post — four posts per joint. ` +
    'Brass-insert plate, from the extension pack.'
  )
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
    // A `download` row means the mesh here is a stand-in, so its status is final.
    const next: PrintFile = {
      ...f,
      ...(fileNote
        ? {
            status:
              f.status === 'source-only' || f.status === 'download' ? f.status : fileNote.status,
            note: f.note ?? fileNote.note,
          }
        : {}),
      source: f.source ?? sourceFor(f.file),
    }
    const existing = merged.get(f.file)
    if (!existing) {
      merged.set(f.file, { ...next, sizeMm })
      return
    }
    existing.quantity += next.quantity
    // A stand-in must never become printable: `download` wins over any other row.
    if (next.status === 'download' || existing.status === 'download') {
      existing.status = 'download'
    } else if (existing.status === 'print' && next.status !== 'print') {
      // Keep the most cautious status if a file is shared by two rows.
      existing.status = next.status
    }
    if (!existing.note && next.note) existing.note = next.note
  }

  for (const part of ['verticalRails', 'heroEdge', 'widthRails', 'horizontalEdges', 'sidePanels', 'topPanel', 'bottomPanel', 'handles', 'feet'] as PartType[]) {
    if (isOptional(part) && !state.toggles[part]) continue
    for (const f of printFilesForPart(state, part)) add(f)
  }

  const joiners = joinerCount(state.segments)
  if (joiners > 0) {
    const joints = state.segments.length - 1
    add({
      file: joinerFile(state.joinerModel),
      part: 'Post joiner',
      quantity: joiners,
      status: 'print',
      group: 'frame',
      note: joinerNote(state.joinerModel, joints, joiners),
    })
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
  const statusOrder: Record<PrintStatus, number> = { print: 0, review: 1, download: 2, 'source-only': 3 }
  const uKey = (f: PrintFile) => (f.u === undefined ? Number.POSITIVE_INFINITY : f.u)
  return [...merged.values()].sort(
    (a, b) =>
      order[a.group] - order[b.group] ||
      uKey(a) - uKey(b) ||
      statusOrder[a.status] - statusOrder[b.status] ||
      a.part.localeCompare(b.part),
  )
}
