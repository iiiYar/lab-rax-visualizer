import type { BuildState, DeviceType, PartType, PatternId, ShelfType } from './types'
import {
  BASE_QUANTITIES,
  PART_LABELS,
  deviceLabel,
  isOptional,
  patternLabel,
  shelfTypeLabel,
} from './constants'
import { DEVICE_TYPE_PARTS, SHELF_TYPE_FILES, devicePartColor } from './models'
import { sourceFor } from './sources'
import { JOINER_FILE, joinerCount, printFilesForPart } from './print-files'

export interface PartRow {
  part: string
  color: string
  pattern: string
  solid: string
  quantity: number
  /** Printable source file(s) for this row, when it has one. */
  files: string[]
  /**
   * Model page to send the maker to when this row has no printable file —
   * e.g. a printed panel this app only draws as a flat stand-in.
   */
  sourceUrl?: string
}

function patternText(pattern: PatternId, solid: boolean): { pattern: string; solid: string } {
  if (pattern === 'none') return { pattern: '—', solid: '—' }
  return { pattern: patternLabel(pattern), solid: solid ? 'Backplate' : 'Open voids' }
}

/**
 * Build the export rows for the current build, honouring toggles and
 * grouping identical shelves together.
 */
export function buildPartsList(state: BuildState): PartRow[] {
  const rows: PartRow[] = []
  const { parts, toggles, shelves } = state

  // Fixed-count structural parts.
  const fixed: PartType[] = [
    'verticalRails',
    'heroEdge',
    'widthRails',
    'horizontalEdges',
    'sidePanels',
    'topPanel',
    'bottomPanel',
    'handles',
    'feet',
  ]

  for (const part of fixed) {
    if (isOptional(part) && !toggles[part]) continue

    const qty = BASE_QUANTITIES[part] ?? 0
    if (qty <= 0) continue

    const style = parts[part]
    const pt = patternText(style.pattern, style.solid)
    const partFiles = printFilesForPart(state, part)
    // Only files that actually ship: `download` rows exist for parts whose mesh
    // here is only a stand-in, so naming that file would point the maker at
    // something they must not print. Such a row links the source page instead.
    const shippable = partFiles.filter((f) => f.status === 'print' || f.status === 'review')
    const downloadRow = partFiles.find((f) => f.status === 'download')
    const sourceUrl = downloadRow ? sourceFor(downloadRow.file).url : undefined
    rows.push({
      part: PART_LABELS[part],
      color: style.color,
      pattern: pt.pattern,
      solid: pt.solid,
      quantity: qty,
      files: [...new Set(shippable.map((f) => f.file))],
      ...(sourceUrl ? { sourceUrl } : {}),
    })
  }

  // The joiner is a printed frame part, derived from the same segment
  // decomposition as the posts. Without it a parts export could list eight
  // rails for a 12U rack and stay silent about the eight joiners that hold
  // them together — the list has to be complete or it is a shopping list with
  // a hole in it.
  const joiners = joinerCount(state.rackU)
  if (joiners > 0) {
    rows.push({
      part: PART_LABELS.joiners,
      // The joiner has its own swatch in the UI, so the export has to follow
      // that style rather than borrow the post colour.
      color: parts.joiners.color,
      pattern: '—',
      solid: '—',
      quantity: joiners,
      files: [JOINER_FILE],
    })
  }

  // Shelves: group by (type, solid, color, pattern). Grouping on the type —
  // not just the U height — is what keeps a 1U fan plate, a 1U keystone plate
  // and a 1U open shelf from collapsing into one anonymous "1U shelf" row.
  const shelfGroups = new Map<
    string,
    { type: ShelfType; count: number; color: string; pattern: PatternId; solid: boolean }
  >()
  for (const s of shelves) {
    const key = `${s.shelfType}|${s.solid}|${s.color}|${s.pattern}`
    const g = shelfGroups.get(key)
    if (g) g.count += 1
    else shelfGroups.set(key, { type: s.shelfType, count: 1, color: s.color, pattern: s.pattern, solid: s.solid })
  }
  for (const g of shelfGroups.values()) {
    rows.push({
      part: shelfTypeLabel(g.type),
      color: g.color,
      pattern: g.pattern === 'none' ? '—' : patternLabel(g.pattern),
      // For shelves the "solid" column describes the shelf face itself.
      solid: g.solid ? 'Solid' : 'Holed',
      quantity: g.count,
      files: [SHELF_TYPE_FILES[g.type]],
    })
  }

  // Devices fitted into shelves' own slots (e.g. fans behind a fan plate),
  // grouped by type + colours — this is what the build actually has to buy
  // alongside the printed shelves. The row's colour cell shows the device's
  // first (most visible) part, with its per-shelf overrides resolved.
  const deviceGroups = new Map<string, { type: DeviceType; color: string; count: number }>()
  for (const s of shelves) {
    for (const device of s.devices ?? []) {
      if (!device) continue
      const color = devicePartColor(s.deviceColors, device, 0)
      // Group shelves only when *every* part colour matches — a fan whose
      // impeller was recoloured is a different row than a stock one.
      const allColors = DEVICE_TYPE_PARTS[device]
        .map((_, i) => devicePartColor(s.deviceColors, device, i))
        .join(',')
      const key = `${device}|${allColors}`
      const g = deviceGroups.get(key)
      if (g) g.count += 1
      else deviceGroups.set(key, { type: device, color, count: 1 })
    }
  }
  for (const g of deviceGroups.values()) {
    rows.push({
      // Devices are bought, not printed; the suffix keeps a device row from
      // reading like the printed shelf that carries it (e.g. the MX64 tray).
      part: `${deviceLabel(g.type)} (device)`,
      color: g.color,
      pattern: '—',
      solid: '—',
      quantity: g.count,
      files: [],
    })
  }

  return rows
}

export function totalPartCount(state: BuildState): number {
  return buildPartsList(state).reduce((n, r) => n + r.quantity, 0)
}
