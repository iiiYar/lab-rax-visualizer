import type { BuildState, DeviceType, PartType, PatternId } from './types'
import {
  BASE_QUANTITIES,
  PART_LABELS,
  deviceLabel,
  isOptional,
  patternLabel,
} from './constants'
import { DEVICE_TYPE_PARTS, devicePartColor } from './models'

export interface PartRow {
  part: string
  color: string
  pattern: string
  solid: string
  quantity: number
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
    rows.push({
      part: PART_LABELS[part],
      color: style.color,
      pattern: pt.pattern,
      solid: pt.solid,
      quantity: qty,
    })
  }

  // Shelves: group by (u, solid, color, pattern).
  const shelfGroups = new Map<string, { u: number; count: number; color: string; pattern: PatternId; solid: boolean }>()
  for (const s of shelves) {
    const key = `${s.u}|${s.solid}|${s.color}|${s.pattern}`
    const g = shelfGroups.get(key)
    if (g) g.count += 1
    else shelfGroups.set(key, { u: s.u, count: 1, color: s.color, pattern: s.pattern, solid: s.solid })
  }
  for (const g of shelfGroups.values()) {
    rows.push({
      part: `${g.u}U shelf`,
      color: g.color,
      pattern: g.pattern === 'none' ? '—' : patternLabel(g.pattern),
      // For shelves the "solid" column describes the shelf face itself.
      solid: g.solid ? 'Solid' : 'Holed',
      quantity: g.count,
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
      part: deviceLabel(g.type),
      color: g.color,
      pattern: '—',
      solid: '—',
      quantity: g.count,
    })
  }

  return rows
}

export function totalPartCount(state: BuildState): number {
  return buildPartsList(state).reduce((n, r) => n + r.quantity, 0)
}
