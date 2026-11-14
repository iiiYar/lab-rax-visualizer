import type { BuildState } from './types'
import { clampShelvesToRack } from './shelves'
import { MAX_U, MIN_U } from './constants'
import { makeDefaultBuild } from './defaults'
import { normalizeSegments } from './segments'

const STORAGE_KEY = 'lab-rax-saved-builds'
const DIRTY_KEY = 'lab-rax-saved-builds-dirty'
const SYNCED_KEY = 'lab-rax-saved-builds-synced'

/**
 * Relative to the page, so it works both at the site root and under a
 * sub-path. The Docker image serves this endpoint from a JSON file in the
 * /data volume; static hosting simply 404s and we stay local-only.
 */
const API_URL = 'api/builds'

export interface SavedBuild {
  id: string
  name: string
  state: BuildState
  savedAt: number
}

export type SyncMode = 'server' | 'local'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const clampU = (u: number) => Math.max(MIN_U, Math.min(MAX_U, Math.round(u)))

/** Validate and normalise whatever came from localStorage or the API. */
function parseBuildList(parsed: unknown): SavedBuild[] {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { builds?: unknown })?.builds)
      ? ((parsed as { builds: unknown[] }).builds)
      : null
  if (!list) return []
  const out: SavedBuild[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const b = item as Partial<SavedBuild>
    if (typeof b.id !== 'string' || typeof b.name !== 'string') continue
    if (!b.state || typeof b.state !== 'object') continue
    const s = b.state as Partial<BuildState>
    const rackU = clampU(typeof s.rackU === 'number' ? s.rackU : 6)
    const base = makeDefaultBuild()
    const segments = normalizeSegments(rackU, s.segments)
    const joinerModel = s.joinerModel === 'long' ? 'long' : 'short'
    const parts = { ...base.parts, ...(s.parts && typeof s.parts === 'object' ? s.parts : {}) }
    const toggles = { ...base.toggles, ...(s.toggles && typeof s.toggles === 'object' ? s.toggles : {}) }
    const shelves = Array.isArray(s.shelves) ? clampShelvesToRack(s.shelves as BuildState['shelves'], rackU) : base.shelves
    const palette = Array.isArray(s.palette) && s.palette.length === 6 ? (s.palette as string[]) : base.palette
    out.push({
      id: b.id,
      name: b.name,
      state: { rackU, segments, joinerModel, parts, toggles, shelves, palette },
      savedAt: typeof b.savedAt === 'number' ? b.savedAt : Date.now(),
    })
  }
  return out
}

function readAll(): SavedBuild[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return parseBuildList(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

function writeAll(list: SavedBuild[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* quota / private mode — ignore */
  }
}

/* ------------------------------------------------------- server sync ---- */

function markDirty(): void {
  try {
    localStorage.setItem(DIRTY_KEY, '1')
  } catch {
    /* ignore */
  }
}

function clearDirty(): void {
  try {
    localStorage.removeItem(DIRTY_KEY)
  } catch {
    /* ignore */
  }
}

function isDirty(): boolean {
  try {
    return localStorage.getItem(DIRTY_KEY) === '1'
  } catch {
    return false
  }
}

function markSynced(): void {
  try {
    localStorage.setItem(SYNCED_KEY, '1')
  } catch {
    /* ignore */
  }
}

function hasSynced(): boolean {
  try {
    return localStorage.getItem(SYNCED_KEY) === '1'
  } catch {
    return false
  }
}

/** POST the whole local list to the JSON store. False when offline/static. */
async function pushAll(): Promise<boolean> {
  try {
    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readAll()),
    })
    if (!res.ok) return false
    clearDirty()
    markSynced()
    return true
  } catch {
    return false
  }
}

let pushTimer: ReturnType<typeof setTimeout> | undefined

/** Persist locally right away, then sync to the server (debounced). */
function commit(list: SavedBuild[]): void {
  writeAll(list)
  markDirty()
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = undefined
    void pushAll()
  }, 400)
}

/**
 * Reconcile local storage with the server:
 * - unsynced local edits are pushed first;
 * - otherwise the server list wins, so deletes made on another device stick;
 * - on the very first run the local list is uploaded.
 * Returns 'local' when no API is reachable (static hosting or offline), in
 * which case the browser's localStorage remains the source of truth.
 */
export async function syncSavedBuilds(): Promise<SyncMode> {
  try {
    if (isDirty()) return (await pushAll()) ? 'server' : 'local'

    const res = await fetch(API_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return 'local'
    const remote = parseBuildList(await res.json())
    const local = readAll()

    // First run against this server: seed it with what this browser has.
    if (remote.length === 0 && !hasSynced() && local.length > 0) {
      return (await pushAll()) ? 'server' : 'local'
    }

    writeAll(remote)
    markSynced()
    return 'server'
  } catch {
    return 'local'
  }
}

export function listSavedBuilds(): SavedBuild[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt)
}

export function saveCurrentBuild(name: string, state: BuildState): SavedBuild {
  const list = readAll()
  const entry: SavedBuild = { id: newId(), name: name.trim() || 'Untitled rack', state, savedAt: Date.now() }
  list.unshift(entry)
  commit(list)
  return entry
}

export function overwriteSavedBuild(id: string, state: BuildState): void {
  const list = readAll()
  const idx = list.findIndex((b) => b.id === id)
  if (idx < 0) return
  list[idx] = { ...list[idx], state, savedAt: Date.now() }
  commit(list)
}

export function renameSavedBuild(id: string, name: string): void {
  const list = readAll()
  const idx = list.findIndex((b) => b.id === id)
  if (idx < 0) return
  list[idx] = { ...list[idx], name: name.trim() || list[idx].name }
  commit(list)
}

export function deleteSavedBuild(id: string): void {
  commit(readAll().filter((b) => b.id !== id))
}

export function exportAllSaved(): string {
  return JSON.stringify(readAll(), null, 2)
}

export function importSavedBuilds(jsonText: string): number {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return 0
  }
  if (!Array.isArray(parsed)) return 0
  const existing = readAll()
  const ids = new Set(existing.map((b) => b.id))
  let added = 0
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const b = item as Partial<SavedBuild>
    if (typeof b.name !== 'string' || !b.state) continue
    const id = typeof b.id === 'string' && !ids.has(b.id) ? b.id : newId()
    ids.add(id)
    existing.unshift({
      id,
      name: b.name,
      state: (b.state as BuildState),
      savedAt: typeof b.savedAt === 'number' ? b.savedAt : Date.now(),
    })
    added++
  }
  // normalize states on import
  const normalized = parseBuildList(existing)
  commit(normalized)
  return added
}
