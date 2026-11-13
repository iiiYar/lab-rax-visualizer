import ExcelJS from 'exceljs'
import type { BuildState } from '../domain/types'
import { buildPartsList } from '../domain/parts-list'
import { manifestRows, manifestTotals, STATUS_LABEL, sourceCellText } from './print-manifest'
import { download } from './download'
import { CHECK_OFF, linkCell, styleHeader, tickColumn, workbookBytes } from './xlsx-common'

/**
 * Absolute URL for a part file. Models are served from `models-3d/` beside the
 * app, so `document.baseURI` keeps the link correct whether the planner runs at
 * the domain root or under a sub-path.
 */
function modelUrl(file: string): string {
  return new URL(`models-3d/${file}`, document.baseURI).href
}

/**
 * Export the parts list as an .xlsx workbook.
 *
 * Sheet 1 is the shopping list (unchanged shape, plus a File column). Sheet 2
 * is the print manifest: one row per file with a clickable download link, so a
 * shelf can be sliced without hunting through `public/models-3d/`.
 *
 * The "Done" column is a real dropdown (☐ / ☑) built from an ExcelJS data
 * validation, not a text glyph the maker has to retype: one click, pick a
 * value, and the row dims itself. A drawn form-control checkbox is not
 * something either spreadsheet library can write, and a dropdown is what
 * Excel, LibreOffice and Sheets all agree on.
 */
export async function exportXlsx(state: BuildState): Promise<void> {
  const rows = buildPartsList(state)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Lab Rax Planner'
  wb.created = new Date()

  // --- Sheet 1: the shopping list ------------------------------------------
  const ws = wb.addWorksheet(`Lab Rax ${state.rackU}U`, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = [{ width: 6 }, { width: 30 }, { width: 32 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 6 }]
  ws.addRow(['Done', 'Part', 'File', 'Color', 'Pattern', 'Solid/Backplate', 'Qty'])
  styleHeader(ws, 7)
  for (const r of rows) {
    // A row with no file is bought hardware or a part this app only draws as a
    // stand-in; when a source page is known, the File cell links to it instead.
    const fileCell = r.files.join(' · ') || (r.sourceUrl ? 'Download from source' : '—')
    const row = ws.addRow([CHECK_OFF, r.part, fileCell, r.color, r.pattern, r.solid, r.quantity])
    row.alignment = { vertical: 'top' }
    if (r.files.length > 0) linkCell(ws, `C${row.number}`, modelUrl(r.files[0]), r.files[0])
    else if (r.sourceUrl) linkCell(ws, `C${row.number}`, r.sourceUrl, 'Download from source')
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: 7 } }
  if (rows.length > 0) tickColumn(ws, 'A', rows.length + 1)

  // --- Sheet 2: print manifest with live links ------------------------------
  // Same rows the zip's manifest.csv/xlsx and print-list.html are built from,
  // so the on-screen export and the downloaded archive cannot drift apart.
  const files = manifestRows(state)
  const wsFiles = wb.addWorksheet('Print files', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  wsFiles.columns = [
    { width: 5 },
    { width: 6 },
    { width: 6 },
    { width: 30 },
    { width: 32 },
    { width: 20 },
    { width: 5 },
    { width: 18 },
    { width: 50 },
    { width: 70 },
    { width: 58 },
  ]
  wsFiles.addRow(['No.', 'Done', 'Unit', 'Part', 'File', 'Size (mm)', 'Qty', 'Status', 'Source', 'Note', 'Download'])
  styleHeader(wsFiles, 11)
  for (const f of files) {
    // Only files that actually ship get a Download link: `download` and
    // `source-only` rows have no file in the archive.
    const shipped = f.status === 'print' || f.status === 'review'
    const row = wsFiles.addRow([
      f.no ?? '',
      f.no === null ? '' : CHECK_OFF,
      f.unit,
      f.part,
      f.file || '—',
      f.size,
      f.qty,
      STATUS_LABEL[f.status],
      f.source.url ?? sourceCellText(f.source),
      f.note,
      // A row with no shipped file; linking it to models-3d/ would 404.
      shipped && f.file ? 'Download' : '',
    ])
    row.alignment = { vertical: 'top' }
    if (f.source.url) linkCell(wsFiles, `I${row.number}`, f.source.url, f.source.label)
    if (shipped && f.file) linkCell(wsFiles, `K${row.number}`, modelUrl(f.file), f.file)
  }

  const totals = manifestTotals(files)
  wsFiles.addRow([])
  const totalRow = wsFiles.addRow(['', '', '', 'TOTAL — pieces to print', '', '', totals.pieces, '', '', '', ''])
  totalRow.font = { bold: true }

  wsFiles.autoFilter = { from: { row: 1, column: 1 }, to: { row: files.length + 1, column: 11 } }
  tickColumn(wsFiles, 'B', files.length + 1)

  const bytes = await workbookBytes(wb)
  download(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `lab-rax-${state.rackU}U-parts.xlsx`,
  )
}
