import * as XLSX from 'xlsx'
import type { BuildState } from '../domain/types'
import { buildPartsList } from '../domain/parts-list'
import { printFiles, type PrintStatus } from '../domain/print-files'

/**
 * Absolute URL for a part file. Models are served from `models-3d/` beside the
 * app, so `document.baseURI` keeps the link correct whether the planner runs at
 * the domain root or under a sub-path.
 */
function modelUrl(file: string): string {
  return new URL(`models-3d/${file}`, document.baseURI).href
}

const STATUS_LABEL: Record<PrintStatus, string> = {
  print: 'Print',
  review: 'Review first',
  'source-only': 'Not a print source',
}

/**
 * Export the parts list as an .xlsx workbook.
 *
 * Sheet 1 is the shopping list (unchanged shape, plus a File column). Sheet 2
 * is the print manifest: one row per file with a clickable download link, so a
 * shelf can be sliced without hunting through `public/models-3d/`.
 *
 * Note: the SheetJS community build cannot embed true interactive form-control
 * checkboxes, so the "Done" column uses a ☐ glyph you can tick manually (or
 * replace in your spreadsheet app). Switch to `exceljs` later if real
 * checkbox controls are required.
 */
export function exportXlsx(state: BuildState): void {
  const rows = buildPartsList(state)

  const aoa: (string | number)[][] = [
    ['Done', 'Part', 'File', 'Color', 'Pattern', 'Solid/Backplate', 'Qty'],
    // A row with no file is bought hardware, not something to print.
    ...rows.map((r) => ['☐', r.part, r.files.join(' · ') || '—', r.color, r.pattern, r.solid, r.quantity]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 6 },
    { wch: 30 },
    { wch: 32 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
    { wch: 6 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `Lab Rax ${state.rackU}U`)

  // --- Sheet 2: print manifest with live links ------------------------------
  const files = printFiles(state)
  const fileAoa: (string | number)[][] = [
    ['Part', 'File', 'Size (mm)', 'Qty', 'Status', 'Note', 'Download'],
    ...files.map((f) => [
      f.part,
      f.file,
      f.sizeMm ? f.sizeMm.map((n) => Math.round(n * 100) / 100).join(' × ') : '',
      f.quantity,
      STATUS_LABEL[f.status],
      f.note ?? '',
      modelUrl(f.file),
    ]),
  ]

  const wsFiles = XLSX.utils.aoa_to_sheet(fileAoa)
  wsFiles['!cols'] = [
    { wch: 30 },
    { wch: 32 },
    { wch: 20 },
    { wch: 6 },
    { wch: 16 },
    { wch: 62 },
    { wch: 58 },
  ]

  // Turn the Download column into real hyperlinks (SheetJS stores them beside
  // the cell value; Excel renders the cell as clickable).
  for (let i = 0; i < files.length; i++) {
    const ref = XLSX.utils.encode_cell({ r: i + 1, c: 6 })
    const cell = wsFiles[ref]
    if (cell) cell.l = { Target: modelUrl(files[i].file), Tooltip: `Download ${files[i].file}` }
  }

  XLSX.utils.book_append_sheet(wb, wsFiles, 'Print files')

  XLSX.writeFile(wb, `lab-rax-${state.rackU}U-parts.xlsx`)
}
