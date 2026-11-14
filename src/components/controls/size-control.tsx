import { MAX_U, MIN_U } from '../../domain/constants'
import { segmentLabel, segmentOptions } from '../../domain/segments'
import { useBuildStore } from '../../store/use-build-store'

export function SizeControl() {
  const rackU = useBuildStore((s) => s.rackU)
  const segments = useBuildStore((s) => s.segments)
  const setRackU = useBuildStore((s) => s.setRackU)
  const setSegments = useBuildStore((s) => s.setSegments)

  // Rails come in 1–5U lengths, so a rack can be stacked more than one way.
  // Only splits with the fewest segments are offered (see segmentOptions):
  // anything with an extra segment means extra rails and extra joiners.
  const options = segmentOptions(rackU)
  const current = segmentLabel(segments)
  const joints = segments.length - 1

  return (
    <div className="rounded-lg border border-white/5 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Rack size</span>
        <span className="rounded bg-accent/20 px-2 py-0.5 text-sm font-semibold text-accent">
          {rackU}U
        </span>
      </div>
      <input
        type="range"
        min={MIN_U}
        max={MAX_U}
        step={1}
        value={rackU}
        onChange={(e) => setRackU(Number(e.target.value))}
        className="w-full accent-accent pointer-coarse:py-2"
      />
      <div className="mt-1 flex justify-between text-[10px] text-white/40">
        <span>{MIN_U}U</span>
        <span>{MAX_U}U</span>
      </div>

      {options.length > 1 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-white/50">Post segments</span>
            <span className="text-[10px] text-white/30">
              {joints} {joints === 1 ? 'joint' : 'joints'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {options.map((option) => {
              const label = segmentLabel(option)
              const active = label === current
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSegments(option)}
                  aria-pressed={active}
                  title={`Stack the posts ${label} — ${option.length} segments`}
                  className={`rounded px-2 py-1 text-xs tabular-nums ring-1 transition-colors ${
                    active
                      ? 'bg-accent/25 text-accent ring-accent/40'
                      : 'bg-black/30 text-white/60 ring-white/10 hover:text-white/90'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[10px] leading-snug text-white/30">
            Each split prints different rail lengths — pick one, then export.
          </p>
        </div>
      )}
    </div>
  )
}
