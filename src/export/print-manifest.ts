import ExcelJS from 'exceljs'
import { CHECK_OFF, linkCell, styleHeader, tickColumn, workbookBytes } from './xlsx-common'
import type { BuildState } from '../domain/types'
import {
  joinerCount,
  joinerFile,
  joinerPrintSummary,
  printFiles,
  type PrintGroup,
  type PrintFile,
  type PrintStatus,
} from '../domain/print-files'
import { frameHardware, sourceFor, type PartSource } from '../domain/sources'
import { segmentLabel, segmentTally } from '../domain/segments'
import { printReportHtml } from './print-report'

/**
 * The manifest that ships inside the STL archive.
 *
 * A maker works from this list, not from the folder: seven files with eleven
 * rails in them is exactly the kind of thing that gets printed twice. So the
 * same rows are rendered three ways — a plain CSV for scripts, a formatted
 * workbook for spreadsheets, and a printable HTML checklist — all from one
 * ordered array, so they can never disagree with each other.
 */

export type { PrintStatus }

export const STATUS_LABEL: Record<PrintStatus, string> = {
  print: 'Print',
  review: 'Review first',
  'source-only': 'Not a print source',
  download: 'Download from source',
}

export const GROUP_LABEL: Record<PrintGroup, string> = {
  frame: 'Frame',
  shelves: 'Shelves',
  accessories: 'Accessories',
}

export const GROUP_ORDER: PrintGroup[] = ['frame', 'shelves', 'accessories']

export interface ManifestRow {
  /**
   * 1-based position among the parts that actually get printed. `null` for
   * rows that are not in the archive (`source-only`, `download`): they are
   * listed so the build is complete on paper, but numbering them would imply
   * you can tick them off against a file in the zip.
   */
  no: number | null
  /** Rack units this part occupies, e.g. "3U"; "—" for parts off the U grid. */
  unit: string
  part: string
  file: string
  /** "252 × 180.1 × 44" in mm, or "" when the file was not measured. */
  size: string
  qty: number
  status: PrintStatus
  statusLabel: string
  note: string
  group: PrintGroup
  /** Where the file came from; never optional, so no row ships unsourced. */
  source: PartSource
}

function sizeLabel(f: PrintFile): string {
  if (!f.sizeMm) return ''
  return f.sizeMm.map((n) => Math.round(n * 10) / 10).join(' × ')
}

/** Ordered exactly like `printFiles`: group, then 1U → 12U, then status. */
export function manifestRows(state: BuildState): ManifestRow[] {
  let printed = 0
  return printFiles(state).map((f) => ({
    no: f.status === 'print' || f.status === 'review' ? ++printed : null,
    unit: f.u === undefined ? '—' : `${f.u}U`,
    part: f.part,
    // A `download` row's mesh in this app is a stand-in, not the part; listing
    // the filename would send a maker to a file that is not what they print.
    file: f.status === 'download' ? '' : f.file,
    // Same reason as `file`: the measured size belongs to the stand-in mesh,
    // not to the designer's part (acrylic rows keep theirs: it is this app's
    // outline size, not the designer's cut size).
    size: f.status === 'download' ? '' : sizeLabel(f),
    qty: f.quantity,
    status: f.status,
    statusLabel: STATUS_LABEL[f.status],
    note: f.note ?? '',
    group: f.group,
    source: f.source ?? sourceFor(f.file),
  }))
}

export interface ManifestTotals {
  /** Copies to print (print + review), not file count. */
  pieces: number
  files: number
  review: number
  skipped: number
  /** Printed parts this app has no mesh for; get them from the model page. */
  missing: number
  byGroup: Record<PrintGroup, number>
}

export function manifestTotals(rows: ManifestRow[]): ManifestTotals {
  const byGroup: Record<PrintGroup, number> = { frame: 0, shelves: 0, accessories: 0 }
  let pieces = 0
  let files = 0
  let review = 0
  let skipped = 0
  let missing = 0
  for (const r of rows) {
    if (r.status === 'source-only') {
      skipped++
      continue
    }
    if (r.status === 'download') {
      missing += r.qty
      continue
    }
    pieces += r.qty
    files++
    byGroup[r.group] += r.qty
    if (r.status === 'review') review++
  }
  return { pieces, files, review, skipped, missing, byGroup }
}

/** Parts that are wider than a 256 mm bed — the one thing to know before slicing. */
export function oversizeRows(rows: ManifestRow[], bedMm = 256): ManifestRow[] {
  return rows.filter((r) => {
    if (r.status === 'source-only' || !r.size) return false
    const widest = Math.max(...r.size.split(' × ').map(Number))
    return widest > bedMm
  })
}

/**
 * What this exact split needs — the answer to "so what do I have to buy and
 * print for 12U stacked 4+4+4, as opposed to 5+5+2?". Shared by the printed
 * sheet, the workbook and the CSV tail so the three cannot disagree.
 */
export function buildRequirements(state: BuildState): { item: string; value: string }[] {
  const joints = Math.max(0, state.segments.length - 1)
  const joiners = joinerCount(state.segments, state.joinerModel)
  return [
    { item: 'Rack height', value: `${state.rackU}U` },
    {
      item: 'Post segments',
      value: `${segmentLabel(state.segments)} — ${segmentTally(state.segments)} per post`,
    },
    { item: 'Joints per post', value: String(joints) },
    {
      item: 'Post joiners to print',
      value:
        joiners > 0
          ? joinerPrintSummary(state.joinerModel, joiners)
          : 'none — the posts are a single segment',
    },
    ...frameHardware(state.segments, state.joinerModel).map((h) => ({ item: h.item, value: h.qty })),
  ]
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Machine-readable export of the same table. "Done" carries the ☐ glyph so the
 * column still means something when the file is opened in a spreadsheet.
 */
export function manifestCsv(rows: ManifestRow[], state: BuildState): string {
  const totals = manifestTotals(rows)
  const lines = ['No.,Done,Unit,Part,File,Size (mm),Qty,Status,Source,Notes']
  for (const r of rows) {
    lines.push(
      [
        r.no ?? '',
        r.no === null ? '' : '☐',
        r.unit,
        r.part,
        r.file || '—',
        r.size.replace(/ × /g, ' x '),
        r.qty,
        r.statusLabel,
        r.source.url ?? r.source.label,
        r.note,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  lines.push('')
  lines.push(`,,,TOTAL PRINTED,,,${totals.pieces},,,`)
  lines.push(`,,,Files in this build,,,${totals.files},,,`)
  if (totals.missing > 0) lines.push(`,,,Download separately (not in archive),,,${totals.missing},,,`)
  if (totals.skipped > 0) lines.push(`,,,Listed but not printable,,,${totals.skipped},,,`)
  // Requirements as comment lines: the table above stays a clean, importable
  // CSV, and `grep '^#'` still answers "what does this split cost?".
  lines.push('')
  lines.push(`# Lab Rax ${state.rackU}U · posts ${segmentLabel(state.segments)} — requirements`)
  for (const r of buildRequirements(state)) {
    lines.push(`# ${[r.item, r.value].map(csvCell).join(',')}`)
  }
  lines.push(`# generated by Lab Rax Planner`)
  return lines.join('\n')
}

/**
 * Three sheets: the ordered checklist, counts per group/status, and where each
 * file came from. ExcelJS is used for the tick column — a real one-click
 * dropdown per printable row — which the SheetJS community build cannot write.
 */
export async function manifestXlsx(rows: ManifestRow[], state: BuildState): Promise<Uint8Array> {
  const totals = manifestTotals(rows)
  const header = ['No.', 'Done', 'Unit', 'Group', 'Part', 'File', 'Size (mm)', 'Qty', 'Status', 'Source', 'Notes']
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Lab Rax Planner'
  wb.created = new Date()

  const ws = wb.addWorksheet('Print list', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = [
    { width: 5 },
    { width: 6 },
    { width: 6 },
    { width: 12 },
    { width: 30 },
    { width: 32 },
    { width: 20 },
    { width: 5 },
    { width: 18 },
    { width: 24 },
    { width: 70 },
  ]
  ws.addRow(header)
  styleHeader(ws, header.length)

  for (const r of rows) {
    const row = ws.addRow([
      r.no ?? '',
      r.no === null ? '' : CHECK_OFF,
      r.unit,
      GROUP_LABEL[r.group],
      r.part,
      r.file || '—',
      r.size,
      r.qty,
      r.statusLabel,
      sourceCellText(r.source),
      r.note,
    ])
    row.alignment = { vertical: 'top', wrapText: false }
    if (r.source.url) linkCell(ws, `J${row.number}`, r.source.url, r.source.label)
  }

  // Filter the data rows only, so the totals block never lands inside it.
  const lastDataRow = rows.length + 1
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastDataRow, column: header.length } }
    tickColumn(ws, 'B', lastDataRow)
  }

  const totalsStart = ws.rowCount + 2
  for (const [label, value] of [
    ['TOTAL — pieces to print', totals.pieces],
    ['Files in this build', totals.files],
    ['Needs review before slicing', totals.review],
    ['Download separately (not in archive)', totals.missing],
    ['Listed but not printable', totals.skipped],
  ] as [string, number][]) {
    const row = ws.addRow(['', '', '', '', label, '', '', value, '', '', ''])
    row.getCell(5).font = { bold: true }
  }
  ws.getRow(totalsStart - 1).height = 8

  const summary = wb.addWorksheet('Summary')
  summary.columns = [{ width: 26 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }]
  summary.addRow(['Group', 'Pieces', 'Files', 'Status', 'Pieces'])
  styleHeader(summary, 5)
  for (const g of GROUP_ORDER) {
    const groupRows = rows.filter((r) => r.group === g)
    const printed = groupRows.filter((r) => r.status === 'print' || r.status === 'review')
    summary.addRow([GROUP_LABEL[g], totals.byGroup[g], printed.length, '', ''])
  }
  summary.addRow([])
  summary.addRow(['Status', 'Files', 'Pieces', '', '']).font = { bold: true }
  for (const s of ['print', 'review', 'download', 'source-only'] as PrintStatus[]) {
    const sel = rows.filter((r) => r.status === s)
    summary.addRow([STATUS_LABEL[s], sel.length, sel.reduce((n, r) => n + r.qty, 0), '', ''])
  }
  summary.addRow([])
  // Which stacking this workbook describes — the other splits of the same
  // height print different rails, so the split belongs on the summary, not
  // only in the file list.
  summary.addRow(['Build', `${state.rackU}U`, '', '', '']).font = { bold: true }
  summary.addRow(['Post segments', segmentLabel(state.segments), segmentTally(state.segments), '', ''])
  summary.addRow(['Joints per post', Math.max(0, state.segments.length - 1), '', '', ''])
  summary.addRow([
    'Post joiners to print',
    joinerCount(state.segments, state.joinerModel),
    joinerCount(state.segments, state.joinerModel) > 0 ? joinerFile(state.joinerModel) : '—',
    '',
    '',
  ])
  summary.addRow([])
  summary.addRow(['Total pieces to print', totals.pieces, '', '', '']).font = { bold: true }

  // Hardware is bought, not printed, so it never appears in the print list —
  // which is exactly how a build ends up short of screws. Its own sheet.
  const reqs = wb.addWorksheet('Requirements')
  reqs.columns = [{ width: 58 }, { width: 62 }]
  reqs.addRow(['What this build needs', 'Quantity / detail'])
  styleHeader(reqs, 2)
  for (const r of buildRequirements(state)) reqs.addRow([r.item, r.value])
  reqs.addRow([])
  reqs.addRow(['Everything above is per build, not per post, unless the row says otherwise.'])
  reqs.lastRow!.font = { italic: true, color: { argb: 'FF6B7280' } }

  // One row per distinct source, with the files it explains — so a maker can
  // re-download the model instead of trusting a mesh that was passed around.
  const grouped = new Map<string, { source: PartSource; files: string[] }>()
  for (const r of rows) {
    // A joinery row has no file in this build; it still belongs in the sheet,
    // with an empty file list, so its model page stays one click away.
    const key = r.source.url ?? r.source.label
    const hit = grouped.get(key)
    // `download` rows carry no file in this build; an empty string would
    // leave a stray ", ," in the joined list.
    if (hit) {
      if (r.file) hit.files.push(r.file)
    }
    else grouped.set(key, { source: r.source, files: r.file ? [r.file] : [] })
  }

  const sources = wb.addWorksheet('Sources')
  sources.columns = [{ width: 36 }, { width: 12 }, { width: 56 }, { width: 60 }, { width: 52 }]
  sources.addRow(['Source', 'Model ID', 'URL', 'Files in this build', 'Verification'])
  styleHeader(sources, 5)
  for (const g of grouped.values()) {
    const row = sources.addRow([
      g.source.label,
      g.source.modelId ?? '',
      g.source.url ?? '',
      g.files.length > 0 ? g.files.join(', ') : '— (no file in this build)',
      g.source.kind === 'makerworld'
        ? 'Page opened and matched by title, 2026-11-13'
        : g.source.kind === 'supplied'
          ? 'Supplied copy pinned by SHA-256 — model page not recorded'
          : g.source.kind === 'repo'
            ? 'Generated here — visualization only, do not print'
            : g.source.kind === 'owner'
              ? 'Owner’s STL, re-axed here — printable; no model page'
              : g.source.kind === 'bought'
              ? 'Bought part — mesh is a visualization, nothing to print'
              : 'Origin not recorded — verify before printing',
    ])
    row.alignment = { vertical: 'top', wrapText: true }
    if (g.source.url) linkCell(sources, `C${row.number}`, g.source.url, g.source.label)
  }

  return workbookBytes(wb)
}

/**
 * Short source tag for a table cell: the model id when there is a page, else a
 * word that says why there is no link. Shared with the on-screen XLSX export so
 * both workbooks label a row the same way.
 */
export function sourceCellText(src: PartSource): string {
  if (src.kind === 'makerworld') return src.modelId ?? src.label
  if (src.kind === 'supplied') return 'supplied file'
  if (src.kind === 'repo') return 'this repo (viz)'
  if (src.kind === 'owner') return 'owner STL'
  if (src.kind === 'bought') return 'bought'
  return 'not recorded'
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The English checklist. The Arabic copy is `printReportHtml(rows, state, 'ar')`;
 * both are rendered from the same rows in print-report.ts.
 */
export function printListHtml(rows: ManifestRow[], state: BuildState, generatedAt = new Date()): string {
  return printReportHtml(rows, state, 'en', generatedAt)
}
