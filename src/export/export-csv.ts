import type { BuildState } from '../domain/types'
import { buildPartsList } from '../domain/parts-list'
import { download } from './download'
import { buildSlug } from '../domain/segments'

const HEADER = ['Done', 'Part', 'File', 'Color', 'Pattern', 'Solid/Backplate', 'Qty']

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportCsv(state: BuildState): void {
  const rows = buildPartsList(state)
  const lines = [HEADER.join(',')]
  for (const r of rows) {
    lines.push(
      [
        '☐', // checkbox glyph (CSV has no real form controls)
        r.part,
        r.files.join(' | ') || (r.sourceUrl ? `Download from source: ${r.sourceUrl}` : '—'),
        r.color,
        r.pattern,
        r.solid,
        r.quantity,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  const csv = lines.join('\n')
  download(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    `lab-rax-${buildSlug(state.rackU, state.segments)}-parts.csv`,
  )
}
