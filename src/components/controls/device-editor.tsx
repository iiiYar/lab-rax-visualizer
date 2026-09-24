import {
  deviceLabel,
  shelfAcceptsDevices,
  shelfDeviceSlots,
  shelfTypeLabel,
} from '../../domain/constants'
import { DEVICE_TYPE_PARTS } from '../../domain/models'
import type { DeviceType } from '../../domain/types'
import { useBuildStore } from '../../store/use-build-store'
import { PalettePicker } from '../../ui/palette-picker'

/**
 * Devices fitted into shelves' own mounting slots — e.g. the five 40mm fans a
 * "40mm fan plate (1U)" takes (see SHELF_DEVICE_SLOTS in domain/constants.ts).
 *
 * One row per shelf covers the shelf's whole bank of slots: picking a device
 * fills every slot with it (the `×5` in the option labels), "Empty" clears
 * them all. Anything in between (a hand-edited or future partial fill) is
 * shown as "Mixed" — picking from the list re-covers the bank uniformly.
 * Devices with more than one rendered part (a fan's beige frame + brown
 * impeller) get one colour swatch each.
 *
 * Everything here is driven by the constants tables, so a new shelf type with
 * slots, or a new device type, shows up with no changes to this file. The
 * host section only renders when a build actually has such a shelf.
 */
export function DeviceEditor() {
  const rackU = useBuildStore((s) => s.rackU)
  const shelves = useBuildStore((s) => s.shelves)
  const palette = useBuildStore((s) => s.palette)
  const fillShelfDevices = useBuildStore((s) => s.fillShelfDevices)
  const setShelfStyle = useBuildStore((s) => s.setShelfStyle)

  // Display top-to-bottom, matching the rack itself (same as ShelfEditor).
  const deviceShelves = [...shelves]
    .filter((s) => shelfDeviceSlots(s.shelfType).length > 0)
    .sort((a, b) => b.startU - a.startU)

  return (
    <div className="space-y-2">
      {deviceShelves.map((shelf) => {
        const slots = shelfDeviceSlots(shelf.shelfType)
        const accepts = shelfAcceptsDevices(shelf.shelfType)
        const fitted = (shelf.devices ?? [])
          .slice(0, slots.length)
          .filter((d): d is DeviceType => d !== null && d !== undefined)
        const uniform = fitted.length === slots.length && fitted.every((d) => d === fitted[0])
        const mixed = fitted.length > 0 && !uniform
        const value = mixed ? '__mixed' : (uniform ? fitted[0] : '')
        // Colour swatches follow whichever device the bank shows: the fitted
        // one, else the first option the shelf accepts.
        const choice = fitted[0] ?? accepts[0]
        const parts = choice ? DEVICE_TYPE_PARTS[choice] : []
        // Row numbers count down from the top of the rack, like ShelfEditor.
        const topRow = shelf.startU + shelf.u - 1
        const rowLabel =
          shelf.u === 1
            ? `Row ${rackU - topRow}`
            : `Rows ${rackU - topRow}-${rackU - shelf.startU}`

        const setDeviceColor = (partIndex: number, color: string) => {
          const deviceColors = [...(shelf.deviceColors ?? [])]
          deviceColors[partIndex] = color
          setShelfStyle(shelf.id, { deviceColors })
        }

        return (
          <div key={shelf.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{shelfTypeLabel(shelf.shelfType)}</div>
                <div className="text-[10px] text-white/40">{rowLabel}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {parts.map((part, i) => (
                  <PalettePicker
                    key={part.label}
                    color={shelf.deviceColors?.[i] ?? part.color}
                    palette={palette}
                    onSelect={(color) => setDeviceColor(i, color)}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded bg-black/30 p-1.5">
              <span className="w-12 text-[10px] text-white/40">Slot</span>
              <select
                value={value}
                onChange={(e) =>
                  fillShelfDevices(shelf.id, (e.target.value || null) as DeviceType | null)
                }
                className="h-7 flex-1 rounded bg-black/40 px-1 text-xs text-white outline-none ring-1 ring-white/10 pointer-coarse:h-11"
              >
                <option value="">Empty</option>
                {accepts.map((device) => (
                  <option key={device} value={device}>
                    {deviceLabel(device)} ×{slots.length}
                  </option>
                ))}
                {mixed && (
                  <option value="__mixed" disabled>
                    Mixed ({fitted.length}/{slots.length})
                  </option>
                )}
              </select>
            </div>
          </div>
        )
      })}
    </div>
  )
}
