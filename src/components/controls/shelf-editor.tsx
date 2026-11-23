import { SHELF_TYPES, shelfTypeDepth } from '../../domain/constants'
import {
  findFirstGap,
  maxDownGrowth,
  shelfSide,
  shelvesConflict,
  sumUBySide,
  withShelfSide,
} from '../../domain/shelves'
import { isCustomShelfType } from '../../domain/types'
import type { Shelf, ShelfSide, ShelfType } from '../../domain/types'
import { useBuildStore } from '../../store/use-build-store'
import { useCustomShelves } from '../../store/use-custom-shelves'
import { PalettePicker } from '../../ui/palette-picker'

export function ShelfEditor() {
  const rackU = useBuildStore((s) => s.rackU)
  const palette = useBuildStore((s) => s.palette)
  const shelves = useBuildStore((s) => s.shelves)
  const customs = useCustomShelves((s) => s.shelves)
  const setShelfType = useBuildStore((s) => s.setShelfType)
  const setShelfStyle = useBuildStore((s) => s.setShelfStyle)
  const setShelfSide = useBuildStore((s) => s.setShelfSide)
  const addShelf = useBuildStore((s) => s.addShelf)
  const removeShelf = useBuildStore((s) => s.removeShelf)

  const used = sumUBySide(shelves)
  // "Full" means no gap on a side fits even a 1U plate — shelves don't have
  // to be contiguous, so this isn't just `used >= rackU`.
  const plateDepth = shelfTypeDepth('plate-1u')
  const frontFull = findFirstGap(shelves, rackU, 1, 'front', plateDepth) === null
  const backFull = findFirstGap(shelves, rackU, 1, 'back', plateDepth) === null

  // Display top-to-bottom, matching the rack itself, regardless of the
  // order shelves were added in.
  const sorted = [...shelves].sort((a, b) => b.startU - a.startU)

  // A side switch is offered only when the shelf would not conflict there.
  const canMoveTo = (shelf: Shelf, side: ShelfSide) =>
    shelfSide(shelf) === side ||
    !shelves.some((other) => other.id !== shelf.id && shelvesConflict(withShelfSide(shelf, side), other))

  const renderRow = (shelf: Shelf) => {
    const side = shelfSide(shelf)
    const topRow = shelf.startU + shelf.u - 1
    // The type list is depth-aware: a type is offered only if it fits
    // its rows on this side. The shelf's own type always stays listed.
    const options = SHELF_TYPES.filter(
      (t) =>
        t.id === shelf.shelfType ||
        t.u <= maxDownGrowth(shelves, shelf.id, topRow, side, t.depthMm),
    )
    const customOptions = customs.filter(
      (c) =>
        c.id === shelf.shelfType ||
        c.u <= maxDownGrowth(shelves, shelf.id, topRow, side, c.depthMm),
    )
    // A shelf whose owner upload was deleted keeps its id; show it so the
    // select still has a value to display.
    const orphanCustom =
      isCustomShelfType(shelf.shelfType) && !customs.some((c) => c.id === shelf.shelfType)
    // Row numbers count down from the top of the rack (1 = topmost),
    // independent of `startU`'s bottom-up indexing.
    const topRowNum = rackU - topRow
    const bottomRowNum = rackU - shelf.startU
    const rowLabel = shelf.u === 1 ? `Row ${topRowNum}` : `Rows ${topRowNum}-${bottomRowNum}`
    // Devices for this shelf (fans etc.) are edited in the Devices
    // section below — see DeviceEditor and SHELF_DEVICE_SLOTS.
    return (
      <div key={shelf.id} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded bg-black/30 p-2">
        <span className="w-12 shrink-0 text-[10px] text-white/40">{rowLabel}</span>
        <select
          value={shelf.shelfType}
          onChange={(e) => setShelfType(shelf.id, e.target.value as ShelfType)}
          className="h-7 min-w-0 flex-1 basis-32 rounded bg-black/40 px-1 text-xs text-white outline-none ring-1 ring-white/10 pointer-coarse:h-11"
        >
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
          {customOptions.length > 0 && (
            <optgroup label="Custom">
              {customOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.u}U)
                </option>
              ))}
            </optgroup>
          )}
          {orphanCustom && <option value={shelf.shelfType}>{shelf.shelfType}</option>}
        </select>

        {(() => {
          const target: ShelfSide = side === 'front' ? 'back' : 'front'
          const ok = canMoveTo(shelf, target)
          return (
            <button
              type="button"
              disabled={!ok}
              onClick={() => setShelfSide(shelf.id, target)}
              title={ok ? `Move this shelf to the ${target} rails` : `No room on the ${target} rails at these rows`}
              className="h-7 rounded bg-black/40 px-1.5 text-[10px] text-white/60 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-30 pointer-coarse:h-11"
            >
              {target === 'back' ? 'Move to back' : 'Move to front'}
            </button>
          )
        })()}

        <div className="ml-auto flex items-center gap-1">
          <PalettePicker
            color={shelf.color}
            palette={palette}
            onSelect={(color) => setShelfStyle(shelf.id, { color })}
          />
          <button
            type="button"
            onClick={() => removeShelf(shelf.id)}
            className="grid rounded px-1.5 text-white/40 hover:bg-red-500/20 hover:text-red-300 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:place-items-center"
            title="Remove shelf"
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  const sections: { side: ShelfSide; title: string; full: boolean }[] = [
    { side: 'front', title: 'Front shelves', full: frontFull },
    { side: 'back', title: 'Back shelves', full: backFull },
  ]

  return (
    <div className="space-y-3">
      {sections.map(({ side, title, full }) => {
        const list = sorted.filter((sh) => shelfSide(sh) === side)
        return (
          <div key={side} className="rounded-lg border border-white/5 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{title}</span>
              <span className="text-xs text-white/50">
                {used[side]}U / {rackU}U
              </span>
            </div>
            <div className="scroll-thin max-h-72 space-y-2 overflow-y-auto pr-1 pointer-coarse:max-h-none">
              {list.length === 0 && (
                <p className="rounded bg-black/20 p-2 text-center text-[11px] text-white/40">
                  No {side} shelves — add one below.
                </p>
              )}
              {list.map(renderRow)}
            </div>
            <button
              type="button"
              onClick={() => addShelf(side)}
              disabled={full}
              className="mt-2 w-full rounded bg-accent/20 px-2 py-1.5 text-xs font-medium text-accent hover:bg-accent/30 disabled:opacity-40 pointer-coarse:py-3"
            >
              {side === 'front' ? 'Add front shelf' : 'Add back shelf'}
            </button>
            {full && (
              <p className="mt-1 text-[10px] text-white/40">
                No room on the {side} rails — remove or shrink a shelf to add another.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
