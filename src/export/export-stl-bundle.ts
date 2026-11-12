import type { BuildState } from '../domain/types'
import { printFiles, type PrintFile } from '../domain/print-files'
import { download } from './download'
import { manifestCsv, manifestRows, manifestXlsx, printListHtml } from './print-manifest'

export interface BundleProgress {
  /** Files already added to the archive. */
  done: number
  total: number
  file: string
}

function modelUrl(file: string): string {
  return new URL(`models-3d/${file}`, document.baseURI).href
}

/** Everything a maker needs to know before pressing "slice". */
function readme(state: BuildState, files: PrintFile[]): string {
  const printable = files.filter((f) => f.status === 'print' || f.status === 'review')
  const missing = files.filter((f) => f.status === 'download')
  const skipped = files.filter((f) => f.status === 'source-only')
  const today = new Date().toISOString().slice(0, 10)

  const lines: string[] = [
    'Lab Rax Planner — printable STL bundle',
    `Rack: ${state.rackU}U · ${printable.reduce((n, f) => n + f.quantity, 0)} printed parts · ${today}`,
    '',
    "WHAT'S IN HERE",
    '  frame/       structural parts: height rails, width/depth rails, side and',
    '               top/bottom panels, feet, handles',
    '  shelves/     one file per shelf type in this build',
    '  accessories/ printed add-ons (HDD caddy handles, power buttons)',
    '',
    'THE PRINT LIST',
    '  print-list.html  open this first — the checklist, grouped frame / shelves /',
    '                   accessories and ordered 1U upward, with a tick box per',
    '                   part and the piece count per file. Prints cleanly.',
    '  manifest.xlsx    the same table for a spreadsheet, plus a Summary sheet',
    '                   with counts per group and per status.',
    '  manifest.csv     the same table as plain text, for scripts or grep.',
    '',
    'PRINT NOTES',
    '  - Binary STL/3MF, units are millimetres. Do not scale when importing.',
    '  - Measured sizes: width rails 282 x 55 mm, shelves and side panels about',
    '    254 mm wide. A 256 x 256 mm bed fits the shelves but not the width',
    '    rails — check your bed before slicing, and split the rail if needed.',
    '  - "Review first" rows have open shells in the mesh; run a manifold repair',
    '    (slicer "fix model" / Make Manifold) before slicing.',
    '  - Sold/bought hardware is not in this archive. Only printed parts are.',
    '',
    `TOTALS: ${printable.reduce((n, f) => n + f.quantity, 0)} pieces to print across ` +
      `${printable.length} files, ${skipped.length} listed but not printable` +
      (missing.length > 0
        ? `, plus ${missing.reduce((n, f) => n + f.quantity, 0)} joiners to download.`
        : '.'),
  ]

  if (missing.length > 0) {
    lines.push('', 'PRINTED BUT NOT INCLUDED (get these from the source page)')
    for (const f of missing) {
      lines.push(`  - ${f.part} ×${f.quantity}: ${f.source?.url ?? 'source not recorded'}`)
      if (f.note) lines.push(`      ${f.note}`)
    }
  }

  if (skipped.length > 0) {
    lines.push('', 'LISTED BUT NOT INCLUDED (source is not printable)')
    for (const f of skipped) lines.push(`  - ${f.part} (${f.file}): ${f.note ?? 'no printable source in this repo'}`)
  }

  lines.push(
    '',
    'SOURCES',
    '  https://github.com/iiiYar/lab-rax-visualizer',
    '  https://the-diy-life.com/introducing-lab-rax-a-3d-printable-modular-10-rack-system/',
    '',
  )
  return lines.join('\n')
}

/**
 * Fetch every printable file the build needs, zip it with a manifest, and hand
 * the archive to the browser. Files are the same raw meshes the viewer loads,
 * so nothing is re-scaled or re-orientated on the way out.
 *
 * Files marked `source-only` are deliberately left out of the archive: shipping
 * a squashed visualisation mesh (or a bought device's model) as if it were a
 * print file is worse than saying so in the manifest.
 */
export async function buildStlBundle(
  state: BuildState,
  fetchFile: (file: string) => Promise<ArrayBuffer> = async (file) => {
    const res = await fetch(modelUrl(file))
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
    return res.arrayBuffer()
  },
  onProgress?: (progress: BundleProgress) => void,
): Promise<{ blob: Blob; filename: string }> {
  const files = printFiles(state)
  // `download` rows have no file in this repo by definition; only rows whose
  // mesh we actually serve go into the zip.
  const printable = files.filter((f) => (f.status === 'print' || f.status === 'review') && f.file)

  if (printable.length === 0) {
    throw new Error('This build has no printable parts.')
  }

  // Loaded on demand: the zip writer is ~100 kB and only needed when the
  // maker actually asks for the archive, so it stays out of the first paint.
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const root = zip.folder(`lab-rax-${state.rackU}U`)
  if (!root) throw new Error('Could not create the archive root.')

  for (let i = 0; i < printable.length; i++) {
    const entry = printable[i]
    onProgress?.({ done: i, total: printable.length, file: entry.file })

    const folder = root.folder(entry.group)
    if (!folder) throw new Error(`Could not create the ${entry.group} folder.`)
    folder.file(entry.file, await fetchFile(entry.file))
  }

  root.file('PRINT-ME.txt', readme(state, files))
  // One ordered row set, three renderings — see print-manifest.ts.
  const rows = manifestRows(state)
  root.file('print-list.html', printListHtml(rows, state))
  root.file('manifest.xlsx', manifestXlsx(rows, state))
  root.file('manifest.csv', manifestCsv(rows, state))

  onProgress?.({ done: printable.length, total: printable.length, file: 'Compressing…' })
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  return { blob, filename: `lab-rax-${state.rackU}U-stl.zip` }
}

/** Build the archive and trigger the browser download. */
export async function exportStlBundle(
  state: BuildState,
  onProgress?: (progress: BundleProgress) => void,
): Promise<void> {
  const { blob, filename } = await buildStlBundle(state, undefined, onProgress)
  download(blob, filename)
}
