import { useState } from 'react'
import { useBuildStore } from '../../store/use-build-store'
import { totalPartCount } from '../../domain/parts-list'
import { DESIGN_LIMIT_NOTE, DESIGN_LIMIT_U } from '../../domain/sources'
import { exportCsv } from '../../export/export-csv'
import { buildShareUrl } from '../../share/url-state'
import type { BuildState } from '../../domain/types'
import { Menu } from '../../ui/menu'

function currentBuild(): BuildState {
  const s = useBuildStore.getState()
  return { rackU: s.rackU, parts: s.parts, toggles: s.toggles, shelves: s.shelves, palette: s.palette }
}

export function Header() {
  const rackU = useBuildStore((s) => s.rackU)
  // subscribe to the pieces that affect the count so it stays live
  const parts = useBuildStore((s) => s.parts)
  const toggles = useBuildStore((s) => s.toggles)
  const shelves = useBuildStore((s) => s.shelves)
  const palette = useBuildStore((s) => s.palette)
  const [shared, setShared] = useState(false)
  // Non-null while the STL archive is being fetched and zipped.
  const [bundle, setBundle] = useState<{ done: number; total: number } | null>(null)

  const count = totalPartCount({ rackU, parts, toggles, shelves, palette })

  const onShare = async () => {
    const url = buildShareUrl(currentBuild())
    try {
      await navigator.clipboard.writeText(url)
      setShared(true)
      setTimeout(() => setShared(false), 1800)
    } catch {
      // clipboard blocked — fall back to a prompt
      window.prompt('Copy your shareable build link:', url)
    }
  }

  const onBundle = async () => {
    if (bundle) return
    setBundle({ done: 0, total: 0 })
    try {
      // Loaded on demand: the exporter drags the spreadsheet and zip writers
      // with it, and neither is needed until someone asks for a file.
      const { exportStlBundle } = await import('../../export/export-stl-bundle')
      await exportStlBundle(currentBuild(), (p) => setBundle({ done: p.done, total: p.total }))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not build the STL archive.')
    } finally {
      setBundle(null)
    }
  }

  const onXlsx = async () => {
    const { exportXlsx } = await import('../../export/export-xlsx')
    await exportXlsx(currentBuild())
  }

  const bundleLabel = bundle
    ? bundle.total > 0
      ? `Zipping ${bundle.done}/${bundle.total}`
      : 'Zipping…'
    : 'STL ZIP'

  return (
    <header className="relative z-20 flex items-center justify-between gap-4 border-b border-white/10 bg-panel px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-accent/20 text-accent">
          {/* simple logo mark */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <line x1="4" y1="9" x2="20" y2="9" />
            <line x1="4" y1="15" x2="20" y2="15" />
          </svg>
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-tight">Lab Rax Planner</h1>
          <p className="truncate text-[11px] leading-tight text-white/45">
            Visualize your 3D-printed 10" rack
          </p>
        </div>
      </div>

      <div className="hidden items-center gap-4 text-xs text-white/50 md:flex">
        <span>
          Size <span className="font-semibold text-white/80">{rackU}U</span>
        </span>
        <span>
          Parts <span className="font-semibold text-white/80">{count}</span>
        </span>
        {/* Lab Rax tops out at 10U by design; past that the second joint, not
            the planner, becomes the weak point. Say it where the size is shown,
            not only in the exported sheet. */}
        {rackU > DESIGN_LIMIT_U && (
          <span
            title={DESIGN_LIMIT_NOTE}
            className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-300"
          >
            Past the {DESIGN_LIMIT_U}U design limit
          </span>
        )}
      </div>

      <div className="hidden items-center gap-2 sm:flex">
        <button
          onClick={onShare}
          className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 pointer-coarse:py-2.5"
        >
          {shared ? '✓ Link copied' : 'Share'}
        </button>
        <button
          onClick={() => exportCsv(currentBuild())}
          className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 pointer-coarse:py-2.5"
        >
          CSV
        </button>
        <button
          onClick={onBundle}
          disabled={bundle !== null}
          title="Download every printable STL/3MF in this build as a zip"
          className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:cursor-progress disabled:opacity-60 pointer-coarse:py-2.5"
        >
          {bundleLabel}
        </button>
        <button
          onClick={onXlsx}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110 pointer-coarse:py-2.5"
        >
          Export XLSX
        </button>
      </div>

      <div className="sm:hidden">
        <Menu
          label="More actions"
          items={[
            { id: 'share', label: shared ? '✓ Link copied' : 'Share', onSelect: onShare },
            { id: 'csv', label: 'CSV', onSelect: () => exportCsv(currentBuild()) },
            { id: 'stl', label: bundleLabel, onSelect: onBundle },
            {
              id: 'xlsx',
              label: 'Export XLSX',
              onSelect: onXlsx,
              emphasis: true,
            },
          ]}
        />
      </div>
    </header>
  )
}
