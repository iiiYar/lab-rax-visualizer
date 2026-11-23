import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type * as THREE from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'
import type { CustomShelf, ShelfRotation } from '../../domain/custom-shelves'
import { findFirstGap } from '../../domain/shelves'
import type { ShelfU } from '../../domain/types'
import { useBuildStore } from '../../store/use-build-store'
import { useCustomShelves } from '../../store/use-custom-shelves'
import type { ShelfEdit } from '../../store/use-custom-shelves'
import {
  firstMeshGeometry,
  prepareGeometry,
} from '../viewer/materials/use-model-geometry'

const DEG = Math.PI / 180
const ROTATIONS: ShelfRotation[] = [0, 90, 180, 270]
const MAX_FILE_BYTES = 6 * 1024 * 1024
/** One rack unit, the same figure the server-side U suggestion uses. */
const RACK_U_MM = 44.45

type Axis = 'rotX' | 'rotY' | 'rotZ'
interface Rotation {
  rotX: ShelfRotation
  rotY: ShelfRotation
  rotZ: ShelfRotation
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function nextRotation(r: ShelfRotation): ShelfRotation {
  return ROTATIONS[(ROTATIONS.indexOf(r) + 1) % ROTATIONS.length]
}

function rotatedPatch(shelf: CustomShelf, axis: Axis): ShelfEdit {
  const next = nextRotation(shelf[axis])
  if (axis === 'rotX') return { rotX: next }
  if (axis === 'rotY') return { rotY: next }
  return { rotZ: next }
}

/** Bakes a model the way the viewer does (Z-up to Y-up, then the chosen turns). */
function bake(geometry: THREE.BufferGeometry, rot: Rotation) {
  return prepareGeometry(geometry.clone(), rot.rotY * DEG, rot.rotX * DEG, rot.rotZ * DEG).size
}

function suggestU(heightMm: number): ShelfU {
  return Math.min(4, Math.max(1, Math.round(heightMm / RACK_U_MM))) as ShelfU
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const BUTTON =
  'rounded bg-accent/20 px-2 py-1 text-xs text-accent hover:bg-accent/30 disabled:opacity-40'
const INPUT = 'h-7 min-w-0 rounded bg-black/40 px-1 text-xs text-white outline-none ring-1 ring-white/10'

/**
 * Owner shelves: visitors see only the login link; the owner gets the catalog
 * (rotate, edit, delete, add to rack) and the upload form.
 */
export function CustomShelvesPanel() {
  const loggedIn = useCustomShelves((s) => s.adminPassword !== '')
  return loggedIn ? <OwnerTools /> : <OwnerLogin />
}

function OwnerLogin() {
  const login = useCustomShelves((s) => s.login)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) {
    return (
      <div className="mt-2 text-right">
        <button type="button" onClick={() => setOpen(true)} className="text-[11px] text-white/40 underline">
          Owner login
        </button>
      </div>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(password)
      setPassword('')
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 flex items-center justify-end gap-2">
      <input
        type="password"
        aria-label="Owner password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={INPUT}
        autoComplete="current-password"
      />
      <button type="submit" disabled={busy || password === ''} className={BUTTON}>
        Log in
      </button>
      {error && <span className="text-[11px] text-red-300">{error}</span>}
    </form>
  )
}

function OwnerTools() {
  const logout = useCustomShelves((s) => s.logout)
  const shelves = useCustomShelves((s) => s.shelves)
  const loadError = useCustomShelves((s) => s.loadError)

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-white/5 bg-black/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Owner shelves</span>
        <button type="button" onClick={logout} className="text-[11px] text-white/50 underline">
          Log out
        </button>
      </div>
      {loadError && <p className="text-[11px] text-red-300">{loadError}</p>}
      {shelves.length === 0 && (
        <p className="rounded bg-black/20 p-2 text-center text-[11px] text-white/40">
          No owner shelves yet.
        </p>
      )}
      {shelves.map((shelf) => (
        <ShelfRow key={shelf.id} shelf={shelf} />
      ))}
      <AddShelfForm />
    </div>
  )
}

function ShelfRow({ shelf }: { shelf: CustomShelf }) {
  const update = useCustomShelves((s) => s.update)
  const remove = useCustomShelves((s) => s.remove)
  const buildShelves = useBuildStore((s) => s.shelves)
  const rackU = useBuildStore((s) => s.rackU)
  const addShelf = useBuildStore((s) => s.addShelf)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canAdd = findFirstGap(buildShelves, rackU, shelf.u, 'front', shelf.depthMm) !== null

  const run = async (action: () => Promise<void>) => {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <div className="space-y-1.5 rounded bg-black/30 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm">{shelf.label}</span>
        <span className="shrink-0 text-[10px] text-white/50">
          {shelf.u}U · {shelf.sizeMm.map((n) => round2(n)).join(' × ')} mm
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {(['rotX', 'rotY', 'rotZ'] as const).map((axis) => (
          <button
            key={axis}
            type="button"
            className={BUTTON}
            title={`Turn ${axis.slice(3)} by 90°`}
            onClick={() => run(() => update(shelf.id, rotatedPatch(shelf, axis)))}
          >
            {axis.slice(3)}+90
          </button>
        ))}
        <button
          type="button"
          className={BUTTON}
          disabled={!canAdd}
          title={canAdd ? 'Add to the front rails' : 'No room on the front rails'}
          onClick={() => addShelf('front', shelf.id)}
        >
          Add to rack
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-xs text-white/60 hover:bg-white/10"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Close' : 'Edit'}
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-xs text-red-300 hover:bg-red-500/20"
          onClick={() => {
            if (window.confirm(`Delete "${shelf.label}" from the catalog? Racks that use it keep the slot, shown empty.`)) {
              void run(() => remove(shelf.id))
            }
          }}
        >
          Delete
        </button>
      </div>
      {editing && (
        <EditShelf
          shelf={shelf}
          onSave={async (patch) => {
            setError(null)
            try {
              await update(shelf.id, patch)
              setEditing(false)
            } catch (err) {
              setError(message(err))
            }
          }}
        />
      )}
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  )
}

function EditShelf({ shelf, onSave }: { shelf: CustomShelf; onSave: (patch: ShelfEdit) => Promise<void> }) {
  const [label, setLabel] = useState(shelf.label)
  const [u, setU] = useState<ShelfU>(shelf.u)
  const [sourceUrl, setSourceUrl] = useState(shelf.sourceUrl)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void onSave({ label: label.trim(), u, sourceUrl: sourceUrl.trim() })
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-[1fr_auto] gap-1.5">
      <input
        aria-label="Label"
        value={label}
        maxLength={60}
        onChange={(e) => setLabel(e.target.value)}
        className={INPUT}
      />
      <select
        aria-label="U"
        value={u}
        onChange={(e) => setU(Number(e.target.value) as ShelfU)}
        className={INPUT}
      >
        {[1, 2, 3, 4].map((n) => (
          <option key={n} value={n}>
            {n}U
          </option>
        ))}
      </select>
      <input
        aria-label="Source URL"
        placeholder="https://…"
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
        className={`${INPUT} col-span-2`}
      />
      <div className="col-span-2 flex justify-end gap-1.5">
        <button type="submit" disabled={label.trim() === ''} className={BUTTON}>
          Save
        </button>
      </div>
    </form>
  )
}

function AddShelfForm() {
  const add = useCustomShelves((s) => s.add)
  const [fileKey, setFileKey] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null)
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [label, setLabel] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [rot, setRot] = useState<Rotation>({ rotX: 0, rotY: 0, rotZ: 0 })
  const [u, setU] = useState<ShelfU>(1)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Baked size of the picked model at the chosen turns; null until a file is read.
  const baked = useMemo(() => (geometry ? bake(geometry, rot) : null), [geometry, rot])

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null
    setStatus(null)
    setFile(picked)
    setBytes(null)
    setGeometry(null)
    if (!picked) return
    if (picked.size > MAX_FILE_BYTES) {
      setStatus({ ok: false, text: 'The file is too large (6 MB limit).' })
      return
    }
    try {
      const data = await picked.arrayBuffer()
      const isThreeMf = picked.name.toLowerCase().endsWith('.3mf')
      const geo = isThreeMf
        ? firstMeshGeometry(new ThreeMFLoader().parse(data))
        : new STLLoader().parse(data)
      setBytes(data)
      setGeometry(geo)
      setU(suggestU(bake(geo, rot).y))
      if (!label) setLabel(picked.name.replace(/\.(stl|3mf)$/i, '').slice(0, 60))
    } catch (err) {
      setStatus({ ok: false, text: `Could not read that file: ${message(err)}` })
    }
  }

  const changeRotation = (axis: Axis, value: ShelfRotation) => {
    const next: Rotation = { ...rot }
    next[axis] = value
    setRot(next)
    if (geometry) setU(suggestU(bake(geometry, next).y))
  }

  const reset = () => {
    setFileKey((k) => k + 1)
    setFile(null)
    setBytes(null)
    setGeometry(null)
    setLabel('')
    setSourceUrl('')
    setRot({ rotX: 0, rotY: 0, rotZ: 0 })
    setU(1)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!file || !bytes || !baked) return
    const name = label.trim()
    if (name === '') {
      setStatus({ ok: false, text: 'Give the shelf a label.' })
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      const entry = await add({
        label: name,
        u,
        depthMm: round2(baked.z),
        sizeMm: [round2(baked.x), round2(baked.y), round2(baked.z)],
        rotX: rot.rotX,
        rotY: rot.rotY,
        rotZ: rot.rotZ,
        sourceUrl: sourceUrl.trim(),
        originalName: file.name,
        dataBase64: toBase64(bytes),
      })
      setStatus({ ok: true, text: `Added "${entry.label}".` })
      reset()
    } catch (err) {
      setStatus({ ok: false, text: message(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-white/5 pt-2">
      <span className="text-xs font-medium text-white/70">Add shelf</span>
      <input
        key={fileKey}
        type="file"
        accept=".stl,.3mf"
        aria-label="Shelf model file"
        onChange={onPick}
        className="block w-full text-[11px] text-white/60"
      />
      {baked && (
        <p className="text-[10px] text-white/50">
          Size {round2(baked.x)} × {round2(baked.y)} × {round2(baked.z)} mm · depth {round2(baked.z)} mm
        </p>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <input
          aria-label="New shelf label"
          placeholder="Label"
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          className={`${INPUT} col-span-2`}
        />
        {(['rotX', 'rotY', 'rotZ'] as const).map((axis) => (
          <label key={axis} className="flex items-center gap-1 text-[10px] text-white/50">
            {axis.slice(3)}
            <select
              aria-label={`Turn ${axis.slice(3)}`}
              value={rot[axis]}
              onChange={(e) => changeRotation(axis, Number(e.target.value) as ShelfRotation)}
              className={`${INPUT} flex-1`}
            >
              {ROTATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}°
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="flex items-center gap-1 text-[10px] text-white/50">
          U
          <select
            aria-label="New shelf U"
            value={u}
            onChange={(e) => setU(Number(e.target.value) as ShelfU)}
            className={`${INPUT} flex-1`}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}U
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="New shelf source URL"
          placeholder="Source URL (optional)"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className={`${INPUT} col-span-2`}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px]" role="status">
          {status && <span className={status.ok ? 'text-emerald-300' : 'text-red-300'}>{status.text}</span>}
        </span>
        <button type="submit" disabled={busy || !file || !baked} className={BUTTON}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </form>
  )
}
