import { create } from 'zustand'
import { setCustomShelves, type CustomShelf, type ShelfRotation } from '../domain/custom-shelves'
import { clampShelvesToRack } from '../domain/shelves'
import type { ShelfU } from '../domain/types'
import { useBuildStore } from './use-build-store'

const PASSWORD_KEY = 'lab-rax-admin'

/** Body of `POST /api/shelves`. */
export interface NewShelfPayload {
  label: string
  u: ShelfU
  depthMm: number
  sizeMm: [number, number, number]
  rotX: ShelfRotation
  rotY: ShelfRotation
  rotZ: ShelfRotation
  sourceUrl: string
  originalName: string
  dataBase64: string
}

/** Fields `PATCH /api/shelves/<id>` accepts. */
export type ShelfEdit = Partial<
  Pick<CustomShelf, 'label' | 'u' | 'depthMm' | 'rotX' | 'rotY' | 'rotZ' | 'sourceUrl'>
>

interface CustomShelvesState {
  /** The owner's catalog, as the server last sent it. */
  shelves: CustomShelf[]
  loaded: boolean
  loadError: string | null
  /** Owner password for this browser tab (sessionStorage). Empty = visitor. */
  adminPassword: string
  load: () => Promise<void>
  login: (password: string) => Promise<void>
  logout: () => void
  add: (payload: NewShelfPayload) => Promise<CustomShelf>
  update: (id: string, patch: ShelfEdit) => Promise<void>
  remove: (id: string) => Promise<void>
}

function storedPassword(): string {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) ?? ''
  } catch {
    return ''
  }
}

function storePassword(password: string): void {
  try {
    if (password) sessionStorage.setItem(PASSWORD_KEY, password)
    else sessionStorage.removeItem(PASSWORD_KEY)
  } catch {
    // Private mode can refuse storage; the password then lasts for this page only.
  }
}

/** Turns a failed response into a message the owner can act on. */
async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string; shelf?: CustomShelf } | null
  if (res.status === 503) return new Error('Owner uploads are turned off on this server.')
  if (res.status === 401) return new Error('Not logged in, or the password changed. Log in again.')
  if (res.status === 409 && body?.shelf) {
    return new Error(`That file is already in the catalog as "${body.shelf.label}".`)
  }
  if (res.status === 413) return new Error('The file is too large (6 MB limit).')
  return new Error(body?.error ?? `Request failed (HTTP ${res.status}).`)
}

/**
 * Hands the catalog to the pure domain registry, then re-fits the placed
 * shelves. A shelf placed before the catalog arrived kept its saved U; now it
 * takes the catalog's U, and any shelf that no longer fits is dropped.
 */
function applyCatalog(list: CustomShelf[]): void {
  setCustomShelves(list)
  useBuildStore.setState((s) => ({ shelves: clampShelvesToRack(s.shelves, s.rackU) }))
}

export const useCustomShelves = create<CustomShelvesState>()((set, get) => {
  // Every write carries the owner password and, on success or failure, the
  // caller decides what to do next. A 401 means the password is no longer good,
  // so it is forgotten here.
  const send = async (method: string, url: string, body?: unknown): Promise<Response> => {
    const password = get().adminPassword
    const res = await fetch(url, {
      method,
      headers: {
        'x-admin-password': password,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 401) {
      storePassword('')
      set({ adminPassword: '' })
    }
    if (!res.ok) throw await failure(res)
    return res
  }

  return {
    shelves: [],
    loaded: false,
    loadError: null,
    adminPassword: storedPassword(),

    load: async () => {
      try {
        const res = await fetch('/api/shelves')
        if (!res.ok) throw new Error(`Could not load owner shelves (HTTP ${res.status}).`)
        const body = (await res.json()) as { shelves: CustomShelf[] }
        applyCatalog(body.shelves)
        set({ shelves: body.shelves, loaded: true, loadError: null })
      } catch (err) {
        set({ loadError: err instanceof Error ? err.message : String(err) })
      }
    },

    login: async (password) => {
      const res = await fetch('/api/admin/check', {
        method: 'POST',
        headers: { 'x-admin-password': password },
      })
      if (res.status === 401) throw new Error('Wrong password.')
      if (!res.ok) throw await failure(res)
      storePassword(password)
      set({ adminPassword: password })
    },

    logout: () => {
      storePassword('')
      set({ adminPassword: '' })
    },

    add: async (payload) => {
      const res = await send('POST', '/api/shelves', payload)
      const entry = (await res.json()) as CustomShelf
      await get().load()
      return entry
    },

    update: async (id, patch) => {
      await send('PATCH', `/api/shelves/${encodeURIComponent(id)}`, patch)
      await get().load()
    },

    remove: async (id) => {
      await send('DELETE', `/api/shelves/${encodeURIComponent(id)}`)
      await get().load()
    },
  }
})
