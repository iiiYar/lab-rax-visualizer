import type { BuildState } from '../domain/types'
import { printFiles, type PrintFile, type PrintStatus } from '../domain/print-files'
import { download } from './download'

export interface BundleProgress {
  /** Files already added to the archive. */
  done: number
  total: number
  file: string
}

const STATUS_LABEL: Record<PrintStatus, string> = {
  print: 'Print',
  review: 'Review first',
  'source-only': 'Not a print source',
}

function modelUrl(file: string): string {
  return new URL(`models-3d/${file}`, document.baseURI).href
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Everything a maker needs to know before pressing "slice". */
function readme(state: BuildState, files: PrintFile[]): string {
  const printable = files.filter((f) => f.status !== 'source-only')
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
    '  manifest.csv every file with quantity, status and note',
    '',
    'PRINT NOTES',
    '  - Binary STL/3MF, units are millimetres. Do not scale when importing.',
    '  - Measured sizes: width rails 282 x 55 mm, shelves and side panels about',
    '    254 mm wide. A 256 x 256 mm bed fits the shelves but not the width',
    '    rails — check your bed before slicing, and split the rail if needed.',
    '  - "Review first" rows have open shells in the mesh; run a manifold repair',
    '    (slicer "fix model" / Make Manifold) before slicing.',
    '  - Sold/bought hardware is not in this archive. Only printed parts are.',
  ]

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

function manifestCsv(files: PrintFile[]): string {
  const lines = ['Part,File,Size mm,Qty,Status,Note']
  for (const f of files) {
    const size = f.sizeMm ? f.sizeMm.map((n) => Math.round(n * 100) / 100).join(' x ') : ''
    lines.push(
      [f.part, f.file, size, f.quantity, STATUS_LABEL[f.status], f.note ?? ''].map(csvCell).join(','),
    )
  }
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
  const printable = files.filter((f) => f.status !== 'source-only')

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
  root.file('manifest.csv', manifestCsv(files))

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
