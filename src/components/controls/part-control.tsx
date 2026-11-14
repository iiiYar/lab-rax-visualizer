import { PART_LABELS, PART_MATERIALS, hasMaterialChoice, isOptional } from '../../domain/constants'
import type { JoinerModel, OptionalPart, PartMaterial, PartType } from '../../domain/types'
import { JOINER_FILE, LONG_JOINER_FILE, joinerCount } from '../../domain/print-files'
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
  const segments = useBuildStore((s) => s.segments)
  const joinerModel = useBuildStore((s) => s.joinerModel)
  const setJoinerModel = useBuildStore((s) => s.setJoinerModel)
  const joiners = part === 'joiners' ? joinerCount(segments) : 0

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

      {/* Post joiners ship as two different plates. The short one is the
          designer's extension-pack part this app also draws; the long one is
          the 217.7 mm brass-insert 3MF the owner supplied. Picking here changes
          the exported file and the print row — not the 3D view. */}
      {part === 'joiners' && joiners > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-white/40">Model</span>
          <select
            value={joinerModel}
            onChange={(e) => setJoinerModel(e.target.value as JoinerModel)}
            className="h-7 min-w-0 max-w-full rounded bg-black/40 px-1 text-xs text-white outline-none ring-1 ring-white/10 pointer-coarse:h-11"
          >
            <option value="short">Short plate — {JOINER_FILE} (39.7 mm)</option>
            <option value="long">Long plate — {LONG_JOINER_FILE} (217.7 mm)</option>
          </select>
          <span className="text-[10px] text-white/30">{joiners} needed</span>
        </div>
      )}
    </div>
  )
}
