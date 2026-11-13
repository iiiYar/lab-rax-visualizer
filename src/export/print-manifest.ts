import ExcelJS from 'exceljs'
import { CHECK_OFF, linkCell, styleHeader, tickColumn, workbookBytes } from './xlsx-common'
import type { BuildState } from '../domain/types'
import { printFiles, type PrintGroup, type PrintFile, type PrintStatus } from '../domain/print-files'
import { DESIGN_LIMIT_NOTE, DESIGN_LIMIT_U, frameHardware, sourceFor, type PartSource } from '../domain/sources'

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
  lines.push(`# Lab Rax ${state.rackU}U — generated by Lab Rax Planner`)
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
  summary.addRow(['Rack', `${state.rackU}U`, '', '', ''])
  summary.addRow(['Total pieces to print', totals.pieces, '', '', '']).font = { bold: true }

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

/** Compact cell: the model id links out, so a printed sheet stays readable. */
function sourceHtml(src: PartSource): string {
  if (src.kind === 'makerworld' && src.url) {
    return `<a href="${escapeHtml(src.url)}" title="${escapeHtml(src.label)}">${escapeHtml(src.modelId ?? 'link')}</a>`
  }
  if (src.kind === 'supplied') return '<span class="muted">supplied</span>'
  if (src.kind === 'repo') return '<span class="muted">repo viz</span>'
  if (src.kind === 'owner') return '<span class="muted">owner STL</span>'
  if (src.kind === 'bought') return '<span class="muted">bought</span>'
  return '<span class="muted">?</span>'
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const STATUS_CLASS: Record<PrintStatus, string> = {
  print: 'ok',
  review: 'warn',
  'source-only': 'skip',
  download: 'warn',
}

/**
 * A self-contained sheet: open it in any browser, tick parts off as they come
 * off the bed, print it if you prefer paper. Checklist boxes are real inputs,
 * so the page is usable before it is ever printed.
 *
 * It deliberately splits the manifest in two: the print queue (what goes on
 * the bed, numbered and ordered 1U upward) and a short "bought / cut" table.
 * Mixing them put rows nobody prints in the middle of the checklist.
 */
export function printListHtml(rows: ManifestRow[], state: BuildState, generatedAt = new Date()): string {
  const totals = manifestTotals(rows)
  // Only rows whose file is in the archive go on the checklist; a row you
  // cannot tick off against a file is noise in the middle of the print queue.
  const queue = rows.filter((r) => r.status === 'print' || r.status === 'review')
  const missing = rows.filter((r) => r.status === 'download')
  const excluded = rows.filter((r) => r.status === 'source-only')
  const over = oversizeRows(rows)
  const date = generatedAt.toISOString().slice(0, 10)

  const rowsHtml = (list: ManifestRow[]) =>
    list
      .map(
        (r) => `        <tr class="${STATUS_CLASS[r.status]}">
          <td class="no">${r.no ?? '—'}</td>
          <td class="check"><input type="checkbox" aria-label="Printed ${escapeHtml(r.part)}"></td>
          <td class="unit">${escapeHtml(r.unit)}</td>
          <td class="part">${escapeHtml(r.part)}</td>
          <td class="file"><code>${escapeHtml(r.file) || '—'}</code></td>
          <td class="size">${escapeHtml(r.size) || '—'}</td>
          <td class="qty">${r.qty}</td>
          <td class="status"><span class="pill ${STATUS_CLASS[r.status]}">${escapeHtml(r.statusLabel)}</span></td>
          <td class="src">${sourceHtml(r.source)}</td>
          <td class="notes">${escapeHtml(r.note) || '—'}</td>
        </tr>`,
      )
      .join('\n')

  const sections = GROUP_ORDER.filter((g) => queue.some((r) => r.group === g))
    .map((g) => {
      const groupRows = queue.filter((r) => r.group === g)
      const pieces = groupRows.reduce((n, r) => n + r.qty, 0)
      const files = groupRows.length
      return `      <tbody class="group">
        <tr class="group-head">
          <th colspan="10">${GROUP_LABEL[g]} <span class="muted">· ${pieces} pcs · ${files} ${files === 1 ? 'file' : 'files'}</span></th>
        </tr>
${rowsHtml(groupRows)}
      </tbody>`
    })
    .join('\n')

  // Distinct sources, in the order they first appear on the sheet.
  const bySource = new Map<string, { s: ManifestRow['source']; parts: Set<string> }>()
  for (const r of rows) {
    const key = r.source.url ?? r.source.label
    const hit = bySource.get(key)
    if (hit) hit.parts.add(r.part)
    else bySource.set(key, { s: r.source, parts: new Set([r.part]) })
  }
  const makerworldCount = Array.from(bySource.values()).filter((v) => v.s.kind === 'makerworld').length
  const suppliedCount = Array.from(bySource.values()).filter((v) => v.s.kind === 'supplied').length
  const unrecorded = Array.from(bySource.values()).filter((v) => v.s.kind === 'unrecorded')
  const sourceCounts = [
    `${makerworldCount} MakerWorld model${makerworldCount === 1 ? '' : 's'}`,
    ...(suppliedCount > 0 ? [`${suppliedCount} supplied file${suppliedCount === 1 ? '' : 's'}`] : []),
    ...(unrecorded.length > 0 ? [`${unrecorded.length} with no recorded origin`] : []),
  ].join(' · ')

  const sourcesSection = `<section class="sources">
  <h2>Where these files come from <span class="muted">· ${sourceCounts}</span></h2>
  <table>
    <thead>
      <tr>
        <th class="part">Source</th>
        <th class="src">Link</th>
        <th class="note">Covers</th>
      </tr>
    </thead>
    <tbody>
${Array.from(bySource.values())
  .map(({ s: src, parts }) => {
    const partsList = Array.from(parts).join(', ')
    if (src.kind === 'makerworld') {
      return `      <tr>
        <td class="part">${escapeHtml(src.label)}</td>
        <td class="src"><a href="${escapeHtml(src.url ?? '')}">${escapeHtml(src.url ?? '')}</a></td>
        <td class="note">${escapeHtml(partsList)}</td>
      </tr>`
    }
    if (src.kind === 'repo' || src.kind === 'owner' || src.kind === 'bought' || src.kind === 'supplied') {
      return `      <tr>
        <td class="part">${escapeHtml(src.label)}</td>
        <td class="src">—</td>
        <td class="note">${escapeHtml(partsList)}</td>
      </tr>`
    }
    return `      <tr>
        <td class="part">Origin not recorded</td>
        <td class="src">—</td>
        <td class="note">${escapeHtml(partsList)} — check these against the designer's pages before printing.</td>
      </tr>`
  })
  .join('\n')}
    </tbody>
  </table>
</section>`

  const hardwareSection = `<section class="hardware">
  <h2>Frame hardware <span class="muted">· not printed</span></h2>
  <table>
    <thead>
      <tr><th class="part">Item</th><th class="qty" style="text-align:left">Quantity</th></tr>
    </thead>
    <tbody>
${frameHardware(state.rackU).map((h) => `      <tr><td class="part">${escapeHtml(h.item)}</td><td class="note">${escapeHtml(h.qty)}</td></tr>`).join('\n')}
    </tbody>
  </table>
</section>`

  // Rows the build needs but this app has no printable mesh for — stand-in
  // panels, and any part that only exists on a model page. Naming the quantity
  // matters: nothing else on this sheet would tell you how many to get, which
  // is how a build ends up short one part.
  const missingTable =
    missing.length > 0
      ? `<section class="missing">
  <h2>Printed, but not in this archive <span class="muted">· ${missing.reduce((n, r) => n + r.qty, 0)} pcs</span></h2>
  <table>
    <thead>
      <tr>
        <th class="unit">Unit</th>
        <th class="part">Part</th>
        <th class="qty">Qty</th>
        <th class="src">Source</th>
        <th class="note">Why it is not in here</th>
      </tr>
    </thead>
    <tbody>
${missing
  .map(
    (r) => `      <tr class="warn">
        <td class="unit">${escapeHtml(r.unit)}</td>
        <td class="part">${escapeHtml(r.part)}</td>
        <td class="qty">${r.qty}</td>
        <td class="src">${sourceHtml(r.source)}</td>
        <td class="note">${escapeHtml(r.note) || '—'}</td>
      </tr>`,
  )
  .join('\n')}
    </tbody>
  </table>
</section>`
      : ''

  const excludedTable =
    excluded.length > 0
      ? `<section class="excluded">
  <h2>Bought or cut, not printed <span class="muted">· ${excluded.length} rows</span></h2>
  <table>
    <thead>
      <tr>
        <th class="unit">Unit</th>
        <th class="part">Part</th>
        <th class="file">File</th>
        <th class="qty">Qty</th>
        <th class="note">Why it is not in the archive</th>
      </tr>
    </thead>
    <tbody>
${excluded
  .map(
    (r) => `      <tr class="skip">
        <td class="unit">${escapeHtml(r.unit)}</td>
        <td class="part">${escapeHtml(r.part)}</td>
        <td class="file"><code>${escapeHtml(r.file)}</code></td>
        <td class="qty">${r.qty}</td>
        <td class="note">${escapeHtml(r.note) || '—'}</td>
      </tr>`,
  )
  .join('\n')}
    </tbody>
  </table>
</section>`
      : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lab Rax ${state.rackU}U — print list</title>
<style>
  :root { --ink:#12161c; --muted:#6b7280; --line:#e3e6ea; --ok:#0f7b3f; --warn:#a45b00; --skip:#6b7280; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 28px 40px; font:14px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:var(--ink); background:#fff; }
  header { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; border-bottom:2px solid var(--ink); padding-bottom:12px; }
  h1 { margin:0; font-size:22px; letter-spacing:-.2px; }
  h2 { margin:0 0 8px; font-size:14px; letter-spacing:.2px; }
  .sub { margin:4px 0 0; color:var(--muted); font-size:12.5px; }
  .summary { display:flex; gap:10px; margin:16px 0 20px; flex-wrap:wrap; }
  .card { border:1px solid var(--line); border-radius:8px; padding:8px 14px; min-width:104px; }
  .card b { display:block; font-size:19px; line-height:1.1; font-variant-numeric:tabular-nums; }
  .card span { color:var(--muted); font-size:11.5px; text-transform:uppercase; letter-spacing:.4px; }
  table { width:100%; border-collapse:collapse; }
  thead th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); border-bottom:1px solid var(--line); padding:6px 8px; }
  .group-head th { padding-top:18px; font-size:12px; letter-spacing:.6px; color:var(--ink); text-transform:uppercase; border-bottom:1px solid var(--ink); }
  tbody tr td { border-bottom:1px solid var(--line); padding:7px 8px; vertical-align:top; }
  tbody tr:last-child td { border-bottom:1px solid var(--ink); }
  td.no { width:34px; color:var(--muted); font-variant-numeric:tabular-nums; }
  td.check { width:34px; text-align:center; }
  td.check input { width:15px; height:15px; margin:1px 0 0; accent-color:#0f7b3f; }
  td.unit { width:52px; color:var(--muted); font-variant-numeric:tabular-nums; }
  td.part { width:230px; font-weight:600; }
  td.file code { font:12.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; color:#1f2937; }
  td.size { width:130px; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.qty { width:44px; text-align:right; font-weight:700; font-variant-numeric:tabular-nums; }
  td.status { width:118px; }
  td.note, td.notes { color:var(--muted); font-size:12.5px; }
  td.src { width:64px; font-size:12px; font-variant-numeric:tabular-nums; }
  td.src a, .sources a { color:#1a4d8f; text-decoration:none; border-bottom:1px dotted currentColor; }
  .sources, .hardware, .missing { margin-top:26px; }
  .sources table tbody tr td, .hardware table tbody tr td { padding:5px 8px; }
  .hardware .part { width:auto; font-weight:500; }
  .hardware .note, .sources .note { width:auto; }
  .pill { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:600; border:1px solid currentColor; }
  .pill.ok { color:var(--ok); }
  .pill.warn { color:var(--warn); }
  .pill.skip { color:var(--skip); }
  tr.skip td { color:var(--muted); }
  tr.skip td.part { font-weight:500; }
  .muted { color:var(--muted); font-weight:400; text-transform:none; letter-spacing:0; }
  .excluded, .missing { margin-top:26px; break-inside: auto; }
  .excluded table tbody tr td, .missing table tbody tr td { padding:5px 8px; }
  .missing .src a { color:#1a4d8f; text-decoration:none; border-bottom:1px dotted currentColor; }
  .missing .part { width:auto; }
  footer { margin-top:22px; color:var(--muted); font-size:12px; border-top:1px solid var(--line); padding-top:12px; }
  footer p { margin:4px 0; }
  .warnbox { margin:18px 0 0; border:1px solid var(--warn); color:var(--warn); border-radius:8px; padding:10px 14px; font-size:12.5px; }
  .warnbox b { display:block; margin-bottom:2px; }
  @media print {
    body { padding:0; font-size:10.5px; }
    td.notes, th.notes { display:none; }
    /* Column widths are re-balanced for the page: the file name and size
       matter most on paper, the on-screen proportions do not. */
    td.no { width:26px; }
    td.check { width:26px; }
    td.unit { width:32px; }
    td.part { width:25%; }
    td.file { width:25%; }
    td.size { width:16%; }
    td.qty { width:34px; }
    td.status { width:13%; }
    td.src { width:8%; font-size:9.5px; }
    td.file code { font-size:9.5px; }
    .card { border-color:#bbb; }
    tbody tr, .excluded tr, .missing tr { break-inside: avoid; }
    .group-head { break-after: avoid; }
    a { color:inherit; text-decoration:none; }
  }
</style>
</head>
<body>
<header>
  <div>
    <h1>Lab Rax — ${state.rackU}U print list</h1>
    <p class="sub">Tick each part as it comes off the bed · ${date}</p>
  </div>
  <p class="sub">${totals.files} files · ${totals.pieces} pieces</p>
</header>

<section class="summary">
  <div class="card"><b>${totals.pieces}</b><span>pieces to print</span></div>
  <div class="card"><b>${totals.files}</b><span>distinct files</span></div>
  <div class="card"><b>${totals.byGroup.frame}</b><span>frame</span></div>
  <div class="card"><b>${totals.byGroup.shelves}</b><span>shelves</span></div>
  <div class="card"><b>${totals.byGroup.accessories}</b><span>accessories</span></div>
${totals.review > 0 ? `  <div class="card"><b>${totals.review}</b><span>need review</span></div>\n` : ''}${totals.missing > 0 ? `  <div class="card"><b>${totals.missing}</b><span>download separately</span></div>\n` : ''}</section>

<table>
  <thead>
    <tr>
      <th class="no">No.</th>
      <th class="check">Done</th>
      <th class="unit">Unit</th>
      <th class="part">Part</th>
      <th class="file">File</th>
      <th class="size">Size (mm)</th>
      <th class="qty">Qty</th>
      <th class="status">Status</th>
      <th class="src">Source</th>
      <th class="notes">Notes</th>
    </tr>
  </thead>
${sections}
</table>
${state.rackU > DESIGN_LIMIT_U ? `<div class="warnbox"><b>Design limit</b>${escapeHtml(DESIGN_LIMIT_NOTE)}</div>` : ''}
${over.length > 0 ? `<div class="warnbox"><b>Bed check</b>${over.map((r) => `${escapeHtml(r.part)} is ${escapeHtml(r.size)} mm`).join(' · ')} — wider than a 256 mm bed. Split the part or print it on a larger machine.</div>` : ''}
${missingTable}
${excludedTable}
${sourcesSection}
${hardwareSection}
<footer>
  <p><b>Print notes.</b> Binary STL/3MF in millimetres — do not scale on import. “Review first” meshes contain open shells; run a manifold repair before slicing. “Not a print source” rows are acrylic parts or bought hardware and are not in this archive.</p>
  <p>Generated by Lab Rax Planner · https://github.com/iiiYar/lab-rax-visualizer</p>
</footer>
</body>
</html>
`
}
