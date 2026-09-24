import { PART_LABELS, PART_MATERIALS, hasMaterialChoice, isOptional } from '../../domain/constants'
import type { OptionalPart, PartMaterial, PartType } from '../../domain/types'
import { useBuildStore } from '../../store/use-build-store'
import { PalettePicker } from '../../ui/palette-picker'
import { VisibilityToggle } from '../../ui/visibility-toggle'

// Pattern/solid controls are disabled for now: RackReal renders real STL
// parts with a flat color only, so there's no pattern preview to drive.
export function PartControl({ part }: { part: PartType }) {
  const style = useBuildStore((s) => s.parts[part])
  const setPartStyle = useBuildStore((s) => s.setPartStyle)
  const palette = useBuildStore((s) => s.palette)
  const optional = isOptional(part)
  const enabled = useBuildStore((s) => (optional ? s.toggles[part as OptionalPart] : true))
  const toggle = useBuildStore((s) => s.toggle)
  const visible = useBuildStore((s) => s.visibility[part])
  const toggleVisibility = useBuildStore((s) => s.toggleVisibility)

  return (
    <div
      className={`rounded-lg border border-white/5 bg-black/20 p-3 transition-opacity ${
        enabled ? '' : 'opacity-40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {optional && (
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => toggle(part as OptionalPart)}
              className="h-5 w-5 accent-accent pointer-coarse:h-6 pointer-coarse:w-6"
              title={enabled ? 'Included' : 'Excluded'}
            />
          )}
          <span className="truncate text-sm font-medium">{PART_LABELS[part]}</span>
        </div>
        <div className="flex items-center gap-1">
          <VisibilityToggle visible={visible} onToggle={() => toggleVisibility(part)} />
          <PalettePicker
            color={style.color}
            palette={palette}
            onSelect={(color) => setPartStyle(part, { color })}
          />
        </div>
      </div>

      {hasMaterialChoice(part) && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-white/40">Material</span>
          <select
            value={style.material}
            onChange={(e) => setPartStyle(part, { material: e.target.value as PartMaterial })}
            className="h-7 rounded bg-black/40 px-1 text-xs text-white outline-none ring-1 ring-white/10 pointer-coarse:h-11"
          >
            {PART_MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {style.material === 'acrylic' && (
            <span className="text-[10px] text-white/30">clear, tinted by color</span>
          )}
        </div>
      )}
    </div>
  )
}
