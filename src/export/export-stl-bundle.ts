import type { BuildState } from '../domain/types'
import { printFiles, type PrintFile } from '../domain/print-files'
import { download } from './download'
import { manifestCsv, manifestRows, manifestXlsx, printListHtml } from './print-manifest'
import { REFERENCE_HASHES } from '../domain/sources'
import { sha256Hex } from './sha256'

export interface BundleProgress {
  /** Files already added to the archive. */
  done: number
  total: number
  file: string
}

/** Where the meshes live, as an absolute URL the fetch can use as-is. */
function modelUrl(file: string, baseUrl: string): string {
  return new URL(`models-3d/${file}`, baseUrl).href
}

export interface StlBundleOptions {
  onProgress?: (progress: BundleProgress) => void
  /** Absolute URL the mesh files are served from. Defaults to the current page. */
  baseUrl?: string
  /** Read bytes from somewhere other than the network, e.g. disk in Node. */
  fetchFile?: (file: string) => Promise<ArrayBuffer>
}

/** Everything a maker needs to know before pressing "slice". */
/** Result of checking shipped bytes against a recorded reference hash. */
interface Provenance {
  verified: string[]
  mismatches: string[]
}

function readme(state: BuildState, files: PrintFile[], provenance: Provenance): string {
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
    '  SHA256SUMS.txt   one checksum per shipped file. Download the model from',
    '                   the source page, hash it, compare — that is how you',
    '                   check a file here really is the designer\u2019s part.',
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

  // Provenance comes last but reads first when something is wrong: a mismatched
  // mesh means the archive is not what the source says it is.
  if (provenance.mismatches.length > 0) {
    lines.push(
      '',
      'WARNING — FILES DO NOT MATCH THEIR RECORDED SOURCE HASH',
      '  Do not print these until the difference is explained:',
      ...provenance.mismatches.map((m) => `  - ${m}`),
    )
  }
  if (provenance.verified.length > 0) {
    lines.push('', 'CHECKED AGAINST THE SOURCE')
    for (const v of provenance.verified) lines.push(`  - ${v}`)
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
  options: StlBundleOptions = {},
): Promise<{ blob: Blob; filename: string }> {
  const { onProgress } = options
  const baseUrl = options.baseUrl ?? (typeof document === 'undefined' ? '/' : document.baseURI)
  const fetchFile =
    options.fetchFile ??
    (async (file: string) => {
      const res = await fetch(modelUrl(file, baseUrl))
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
      return res.arrayBuffer()
    })

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

  const sums: string[] = []
  const mismatches: string[] = []
  const verified: string[] = []
  for (let i = 0; i < printable.length; i++) {
    const entry = printable[i]
    onProgress?.({ done: i, total: printable.length, file: entry.file })

    const folder = root.folder(entry.group)
    if (!folder) throw new Error(`Could not create the ${entry.group} folder.`)
    const bytes = await fetchFile(entry.file)
    folder.file(entry.file, bytes)
    const digest = sha256Hex(bytes)
    sums.push(`${digest}  ${entry.group}/${entry.file}`)

    // A row that claims a source is only as good as the bytes behind it. When a
    // reference hash exists, check it here rather than trusting the filename.
    const ref = REFERENCE_HASHES[entry.file]
    if (ref) {
      if (ref.sha256 === digest) verified.push(`${entry.file} — ${ref.origin}`)
      else mismatches.push(`${entry.file} — expected ${ref.sha256.slice(0, 12)}… from ${ref.origin}, got ${digest.slice(0, 12)}…`)
    }
  }

  root.file('PRINT-ME.txt', readme(state, files, { verified, mismatches }))
  // Release-style checksums: the same line format `sha256sum -c` reads.
  root.file('SHA256SUMS.txt', `${sums.join('\n')}\n`)
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

/**
 * Build the archive in a worker and trigger the browser download.
 *
 * Why a worker: fetching ~11 MB of STL, hashing it and deflating it keeps the
 * main thread busy for tens of seconds. Run that on the page thread and the
 * scene's own heap is competing with the zip buffers — the archive either
 * stalls for minutes or never finishes at all, with the button stuck at
 * "Zipping 10/10". A dedicated worker gets its own thread and its own heap, so
 * the renderer keeps painting and the archive completes.
 */
export async function exportStlBundle(
  state: BuildState,
  onProgress?: (progress: BundleProgress) => void,
): Promise<void> {
  try {
    const { blob, filename } = await buildInWorker(state, onProgress)
    download(blob, filename)
  } catch (err) {
    // Only the "worker could not start" case falls back: a worker that ran and
    // reported a problem has a real error worth showing, and rebuilding the
    // same archive on the main thread would just hang the way it used to.
    if ((err as { workerStarted?: boolean }).workerStarted) throw err
    console.warn('Archive worker unavailable, building on the main thread.', err)
    const { blob, filename } = await buildStlBundle(state, { onProgress })
    download(blob, filename)
  }
}

interface WorkerReply {
  type: 'progress' | 'done' | 'error'
  done?: number
  total?: number
  file?: string
  blob?: Blob
  filename?: string
  message?: string
}

/**
 * The worker is a plain module next to this one; Vite bundles it (and JSZip,
 * SheetJS with it) into its own chunk on demand.
 */
function buildInWorker(
  state: BuildState,
  onProgress?: (progress: BundleProgress) => void,
): Promise<{ blob: Blob; filename: string }> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./zip-worker.ts', import.meta.url), { type: 'module' })
    } catch (err) {
      // Very old browser or a CSP that blocks `worker-src`. Caller falls back
      // to building on the main thread.
      reject(err)
      return
    }

    let started = false
    const finish = (fn: () => void) => {
      worker.terminate()
      fn()
    }

    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data
      if (reply.type === 'progress') {
        started = true
        onProgress?.({ done: reply.done ?? 0, total: reply.total ?? 0, file: reply.file ?? '' })
        return
      }
      if (reply.type === 'done' && reply.blob && reply.filename) {
        const blob = reply.blob
        const filename = reply.filename
        finish(() => resolve({ blob, filename }))
        return
      }
      finish(() =>
        reject(Object.assign(new Error(reply.message ?? 'The archive worker failed.'), { workerStarted: started })),
      )
    }

    worker.onerror = (event) => {
      // A worker that never reported anything most likely failed to load (old
      // browser, blocked chunk); one that did report is a real build failure.
      finish(() =>
        reject(Object.assign(new Error(event.message || 'The archive worker crashed.'), { workerStarted: started })),
      )
    }

    worker.postMessage({ state, baseUrl: document.baseURI })
  })
}
