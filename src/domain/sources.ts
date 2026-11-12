/**
 * Where each file in `public/models-3d` came from.
 *
 * Why this exists: the planner ships files a maker is expected to print. A
 * file with no traceable origin is a liability — if it is a visualisation mesh
 * or a rescaled stand-in, printing it wastes filament and the maker has no way
 * to check. Every row in the manifest therefore carries a source, and the
 * generated checklist prints it next to the part.
 *
 * Rules for editing this table:
 * - `makerworld` only when the model page genuinely contains that part. All
 *   pages below were opened in a browser and matched by page title on
 *   2026-11-13 — the ids are not guessed from search results.
 * - `repo` for meshes built by `tools/make-*.py`. Those are visualisation
 *   geometry: they are not print sources and must stay `source-only`.
 * - `unrecorded` when the origin was never written down. Do not invent a link
 *   to fill the gap; the manifest shows it as unverified on purpose.
 */

export type SourceKind = 'makerworld' | 'repo' | 'bought' | 'unrecorded'

export interface PartSource {
  kind: SourceKind
  /** Short label for a table cell. */
  label: string
  /** Canonical page, when one is known. */
  url?: string
  /** MakerWorld model id, when the source is a MakerWorld page. */
  modelId?: string
}

const mw = (modelId: string, label: string): PartSource => ({
  kind: 'makerworld',
  modelId,
  label,
  url: `https://makerworld.com/en/models/${modelId}`,
})

/** The four pages the frame is cut from, by the designer of Lab Rax. */
export const LAB_RAX_SOURCES = {
  rack5U: mw('1294480', 'Lab Rax 10" rack — 5U kit'),
  postsPanels: mw('1294478', 'Lab Rax 1–5U posts & panels'),
  bolted5U: mw('1464819', 'Lab Rax 5U — bolted version'),
  joiners: mw('1304384', 'Lab Rax extension panels & post joiner'),
} as const

/** Rack accessories, one MakerWorld page each. */
export const ACCESSORY_SOURCES: Record<string, PartSource> = {
  'shelf-open-1u.stl': mw('1297318', '1U open shelf'),
  'shelf-plate-keystone-1u.stl': mw('1293816', '12-port keystone panel'),
  'shelf-plate-40mm-fan-1u.3mf': mw('1293794', '1U 5×40mm fan panel'),
  'shelf-sbc-7-2u.stl': mw('1293865', '2U 7× SBC holder'),
}

/** Built by `tools/make-*.py` from measurements — never a print source. */
const repoBuilt = (tool: string): PartSource => ({
  kind: 'repo',
  label: `Built by ${tool} — visualization only`,
})

/** Bought hardware: the mesh here only shows the part in 3D. Nothing to print. */
const BOUGHT: PartSource = {
  kind: 'bought',
  label: 'Bought hardware — mesh is a visualization, not a print file',
}

const UNRECORDED: PartSource = {
  kind: 'unrecorded',
  label: 'Not recorded',
}

export const FILE_SOURCES: Record<string, PartSource> = {
  // frame — the 5U kit holds the horizontal pieces, handles, feet and panels
  'rail-width.3mf': LAB_RAX_SOURCES.rack5U,
  'rail-depth.stl': LAB_RAX_SOURCES.rack5U,
  'foot.3mf': LAB_RAX_SOURCES.rack5U,
  'handle.3mf': LAB_RAX_SOURCES.rack5U,
  'panel-top-bottom.stl': LAB_RAX_SOURCES.rack5U,
  'panel-top-bottom-fan.stl': LAB_RAX_SOURCES.rack5U,
  // posts and side panels ship together in the sizing pack
  'rail-height-1u.stl': LAB_RAX_SOURCES.postsPanels,
  'rail-height-2u.stl': LAB_RAX_SOURCES.postsPanels,
  'rail-height-3u.stl': LAB_RAX_SOURCES.postsPanels,
  'rail-height-4u.stl': LAB_RAX_SOURCES.postsPanels,
  'rail-height-5u.stl': LAB_RAX_SOURCES.postsPanels,
  'panel-side-1u.stl': LAB_RAX_SOURCES.postsPanels,
  'panel-side-2u.stl': LAB_RAX_SOURCES.postsPanels,
  'panel-side-3u.stl': LAB_RAX_SOURCES.postsPanels,
  'panel-side-4u.stl': LAB_RAX_SOURCES.postsPanels,
  'panel-side-5u.stl': LAB_RAX_SOURCES.postsPanels,
  // accessories
  ...ACCESSORY_SOURCES,
  'shelf-hdd-8bay-3u.stl': mw('2503273', '8-bay HDD enclosure'),
  'device-hdd-caddy-handle.stl': mw('2503273', '8-bay HDD enclosure'),
  // device meshes we model ourselves
  'fan-noctua-40mm-frame.stl': repoBuilt('tools/make-fan-noctua-40mm.py'),
  'fan-noctua-40mm-impeller.stl': repoBuilt('tools/make-fan-noctua-40mm.py'),
  'lenovo-tiny-body.stl': repoBuilt('tools/make-lenovo-tiny.py'),
  'lenovo-tiny-front.stl': repoBuilt('tools/make-lenovo-tiny.py'),
  'minisforum-ms-01-body.stl': repoBuilt('tools/make-minisforum-ms01.py'),
  'minisforum-ms-01-front.stl': repoBuilt('tools/make-minisforum-ms01.py'),
  'shelf-mx64-1u.stl': repoBuilt('tools/make-mx64-parts.py'),
  'shelf-minisforum-ms-1u.stl': repoBuilt('tools/make-minisforum-ms01.py'),
  // bought parts the app draws
  'device-keystone-jack-body.stl': BOUGHT,
  'device-keystone-jack-insert.stl': BOUGHT,
  'device-minitx-motherboard.stl': BOUGHT,
  'device-minitx-pcie-card.stl': BOUGHT,
  'device-minitx-power-button.stl': BOUGHT,
  // brought in from somewhere but the reference was never kept
  'plate-1u.stl': UNRECORDED,
  'plate-2u.stl': UNRECORDED,
  'plate-halfu.stl': UNRECORDED,
  'shelf-slotted-1u.stl': UNRECORDED,
  'shelf-plate-80mm-fan-2u.stl': UNRECORDED,
  'shelf-tiny-rack-left-keystone.stl': UNRECORDED,
  'shelf-minitx-2u.stl': UNRECORDED,
  'shelf-minitx-gpu-3u.stl': UNRECORDED,
}

export function sourceFor(file: string): PartSource {
  return FILE_SOURCES[file] ?? UNRECORDED
}

/**
 * The designer's own words, from the Lab Rax write-up: posts stack to 10U, and
 * a second joint past that is possible but the printed parts get too weak for a
 * full rack. The planner still allows 12U, so the checklist has to say this out
 * loud rather than let someone print 8 extra rails for a rack that will sag.
 */
export const DESIGN_LIMIT_U = 10

export const DESIGN_LIMIT_NOTE =
  'Lab Rax is designed for up to 10U. The designer notes a second joint past ' +
  '10U is physically possible but the printed parts become the weak point ' +
  'with a populated rack — plan on a 10U frame, or brace it.'

/** Hardware the frame needs, straight from the designer's bill of materials. */
export const FRAME_HARDWARE = [
  { item: 'M6 × 10mm button-head screws', qty: '24 for the frame' },
  { item: 'M6 brass inserts, 8mm OD × 4mm', qty: '24 for the frame' },
  { item: 'M6 brass inserts for equipment', qty: '6 per rack unit' },
] as const
