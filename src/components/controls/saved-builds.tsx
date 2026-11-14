import { useEffect, useState } from 'react'
import { useBuildStore } from '../../store/use-build-store'
import type { BuildState } from '../../domain/types'
import {
  deleteSavedBuild,
  exportAllSaved,
  importSavedBuilds,
  listSavedBuilds,
  overwriteSavedBuild,
  renameSavedBuild,
  saveCurrentBuild,
  syncSavedBuilds,
  type SavedBuild,
  type SyncMode,
} from '../../domain/saved-builds'
import { buildShareUrl } from '../../share/url-state'


function currentBuild(): BuildState {
  const s = useBuildStore.getState()
  return {
    rackU: s.rackU,
    segments: s.segments,
    joinerModel: s.joinerModel,
    parts: s.parts,
    toggles: s.toggles,
    shelves: s.shelves,
    palette: s.palette,
  }
}

export function SavedBuilds() {
  const loadBuild = useBuildStore((s) => s.loadBuild)

  const [items, setItems] = useState<SavedBuild[]>(() => listSavedBuilds())
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [syncMode, setSyncMode] = useState<SyncMode | 'checking'>('checking')

  const refresh = () => setItems(listSavedBuilds())

  useEffect(() => {
    let cancelled = false
    const reconcile = () => {
      void syncSavedBuilds().then((mode) => {
        if (cancelled) return
        setSyncMode(mode)
        refresh()
      })
    }
    reconcile()
    // Pull changes made from other devices when this tab is focused again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile()
    }
    window.addEventListener('focus', reconcile)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.removeEventListener('focus', reconcile)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'lab-rax-saved-builds') refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const showFlash = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 1600)
  }

  const onSave = () => {
    const n = name.trim() || `Rack ${items.length + 1}`
    saveCurrentBuild(n, currentBuild())
    setName('')
    refresh()
    showFlash(`Saved "${n}"`)
  }

  const onLoad = (b: SavedBuild) => {
    loadBuild(b.state)
    showFlash(`Loaded "${b.name}"`)
  }

  // Saved racks live in this browser's localStorage. Copying a link is the
  // no-cloud way to move one to another device: open it there, then Save.
  const onCopyLink = async (b: SavedBuild) => {
    const url = buildShareUrl(b.state)
    try {
      await navigator.clipboard.writeText(url)
      showFlash(`Link copied for "${b.name}"`)
    } catch {
      window.prompt('Copy this rack link:', url)
    }
  }

  const onOverwrite = (b: SavedBuild) => {
    overwriteSavedBuild(b.id, currentBuild())
    refresh()
    showFlash(`Overwrote "${b.name}"`)
  }

  const onStartRename = (b: SavedBuild) => {
    setEditingId(b.id)
    setEditingName(b.name)
  }

  const onCommitRename = () => {
    if (editingId) renameSavedBuild(editingId, editingName)
    setEditingId(null)
    refresh()
  }

  const onDelete = (id: string) => {
    deleteSavedBuild(id)
    setConfirmDelete(null)
    refresh()
    showFlash('Deleted')
  }

  const onExportAll = () => {
    const blob = new Blob([exportAllSaved()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lab-rax-saved-builds.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const n = importSavedBuilds(String(reader.result ?? ''))
      refresh()
      showFlash(n ? `Imported ${n}` : 'Nothing imported')
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave()
          }}
          placeholder="Name this rack…"
          className="h-7 min-w-0 flex-1 rounded bg-black/40 px-2 text-xs text-white outline-none ring-1 ring-white/10 placeholder:text-white/30 pointer-coarse:h-11"
        />
        <button
          type="button"
          onClick={onSave}
          className="shrink-0 rounded bg-accent/20 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/30 pointer-coarse:py-2.5"
        >
          Save
        </button>
      </div>

      {flash && <p className="text-[10px] text-accent">{flash}</p>}

      <p className="text-[10px] leading-tight text-white/35">
        {syncMode === 'server' ? (
          <>Synced to the server — saved racks open on any device using this app.</>
        ) : syncMode === 'checking' ? (
          <>Checking server sync…</>
        ) : (
          <>
            Saved in this browser. Use <span className="text-white/55">Copy link</span> or{' '}
            <span className="text-white/55">Export all</span> to open a rack on another device.
          </>
        )}
      </p>

      {items.length === 0 ? (
        <p className="rounded bg-black/20 p-2 text-center text-[11px] text-white/40">
          No saved racks yet — save the current one above.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((b) => (
            <li key={b.id} className="rounded bg-black/30 p-2">
              {editingId === b.id ? (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onCommitRename()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="h-7 min-w-0 flex-1 rounded bg-black/40 px-2 text-xs text-white outline-none ring-1 ring-white/10 pointer-coarse:h-11"
                  />
                  <button
                    type="button"
                    onClick={onCommitRename}
                    className="shrink-0 rounded bg-accent/20 px-2 py-1 text-xs text-accent hover:bg-accent/30"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-white/85">{b.name}</div>
                      <div className="text-[10px] text-white/40">
                        {b.state.rackU}U · {b.state.shelves.length} shelves ·{' '}
                        {new Date(b.savedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => onLoad(b)}
                      className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70 hover:bg-white/10"
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => void onCopyLink(b)}
                      className="rounded bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/25"
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      onClick={() => onOverwrite(b)}
                      className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70 hover:bg-white/10"
                    >
                      Overwrite
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartRename(b)}
                      className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70 hover:bg-white/10"
                    >
                      Rename
                    </button>
                    {confirmDelete === b.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onDelete(b.id)}
                          className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-300 hover:bg-red-500/30"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70 hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(b.id)}
                        className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-red-300/70 hover:bg-red-500/20 hover:text-red-300"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          onClick={onExportAll}
          disabled={items.length === 0}
          className="flex-1 rounded bg-white/5 px-2 py-1 text-[10px] font-medium text-white/60 hover:bg-white/10 disabled:opacity-40"
        >
          Export all
        </button>
        <label className="flex-1 cursor-pointer rounded bg-white/5 px-2 py-1 text-center text-[10px] font-medium text-white/60 hover:bg-white/10">
          Import
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>
    </div>
  )
}
