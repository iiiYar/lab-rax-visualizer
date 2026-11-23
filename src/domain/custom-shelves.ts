import type { ShelfU } from './types'

/** Rotation the owner set for a shelf model, in degrees, about each axis. */
export type ShelfRotation = 0 | 90 | 180 | 270

/**
 * One owner-uploaded shelf, as the server's catalog stores it
 * (`GET /api/shelves`). The field names and types match server/index.mjs.
 */
export interface CustomShelf {
  /** `custom-` + 8 hex of the file's sha256. */
  id: `custom-${string}`
  label: string
  u: ShelfU
  depthMm: number
  /** Size after the bake, in mm (x, y, z). */
  sizeMm: [number, number, number]
  rotX: ShelfRotation
  rotY: ShelfRotation
  rotZ: ShelfRotation
  /** Stored file name on the server: `${id}.stl` or `${id}.3mf`. */
  file: string
  originalName: string
  sha256: string
  sourceUrl: string
  /**
   * Optional display model (`${id}.view.stl`): the assembled part, drawn in
   * the viewer when the print file is a multi-plate project. Never exported.
   */
  viewFile?: string
  addedAt: string
}

/**
 * Module-level registry, so pure domain code (labels, depths, print rows) can
 * look a custom shelf up without fetching. The app fills it from the catalog;
 * the archive worker fills its own copy from the message it is sent.
 */
let registry = new Map<string, CustomShelf>()

export function setCustomShelves(list: CustomShelf[]): void {
  registry = new Map(list.map((s) => [s.id, s]))
}

export function getCustomShelves(): CustomShelf[] {
  return [...registry.values()]
}

export function customShelf(id: string): CustomShelf | undefined {
  return registry.get(id)
}

/**
 * The file name a custom shelf row carries in the print list and the archive:
 * the owner's original name with anything outside `[A-Za-z0-9._-]` replaced.
 */
export function customShelfFileName(shelf: CustomShelf): string {
  return shelf.originalName.replace(/[^A-Za-z0-9._-]/g, '_')
}
