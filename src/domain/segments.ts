// How a rack's posts (and side panels) are stacked from the rail lengths the
// designer actually sells. This used to be a single greedy answer — 12U was
// always 5+5+2 — but the same 12U can be stacked 5+4+3 or 4+4+4 as well, and
// the choice changes how many rails of each length you print, where the joints
// sit, and how many joiners you need. The maker picks; nothing here guesses.

import { decomposeIntoSegments } from './models'

/** Rails exist in 1U–5U segments only (`VERTICAL_RAIL_FILES`). */
export const MAX_SEGMENT_U = 5

/** The standard stacking: largest segments first, so the fewest joints. */
export function defaultSegments(rackU: number): number[] {
  return decomposeIntoSegments(rackU)
}

/** `5+5+2` — the label the UI and the exports use for a split. */
export function segmentLabel(segments: number[]): string {
  return segments.join('+')
}

/** `5U ×2 · 2U ×1` — how many rails of each length the split needs per post. */
export function segmentTally(segments: number[]): string {
  const counts = new Map<number, number>()
  for (const s of segments) counts.set(s, (counts.get(s) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([u, n]) => `${u}U ×${n}`)
    .join(' · ')
}

/**
 * Filename-safe build tag: `12u-5-5-2` for a stacked build, `5u` for a single
 * segment. Every split gets its own archive name so two 12U builds never
 * download as the same file.
 */
export function buildSlug(rackU: number, segments: number[]): string {
  return segments.length > 1 ? `${rackU}u-${segments.join('-')}` : `${rackU}u`
}

/**
 * Every way to stack `rackU` from 1–5U segments *without adding a joint*: only
 * splits with the minimum segment count are offered, because any split with
 * more segments needs more rails and more joiners and is worse in every way.
 *
 * Each option is non-increasing (5+4+3, never 4+5+3 — the same stack turned
 * upside down), sorted largest-first, and the default (largest-first greedy)
 * always comes back as the first entry.
 */
export function segmentOptions(rackU: number): number[][] {
  if (rackU <= 0) return []
  const parts = Math.ceil(rackU / MAX_SEGMENT_U)
  const out: number[][] = []
  const walk = (remaining: number, max: number, acc: number[]) => {
    if (acc.length === parts - 1) {
      if (remaining >= 1 && remaining <= max && remaining <= MAX_SEGMENT_U) {
        out.push([...acc, remaining])
      }
      return
    }
    for (let len = Math.min(max, MAX_SEGMENT_U); len >= 1; len--) {
      const rest = remaining - len
      // Every remaining slot needs at least 1U, and at most MAX_SEGMENT_U.
      const slots = parts - acc.length - 1
      if (rest < slots || rest > slots * MAX_SEGMENT_U) continue
      walk(rest, len, [...acc, len])
    }
  }
  walk(rackU, MAX_SEGMENT_U, [])
  return out
}

/** True when `segments` really stacks `rackU` — right count, right sum. */
export function isValidSegments(rackU: number, segments: unknown): segments is number[] {
  if (!Array.isArray(segments) || segments.length === 0) return false
  if (segments.length !== Math.ceil(rackU / MAX_SEGMENT_U)) return false
  let sum = 0
  for (const s of segments) {
    if (!Number.isInteger(s) || s < 1 || s > MAX_SEGMENT_U) return false
    sum += s
  }
  return sum === rackU
}

/**
 * Any split that comes from storage or a share link goes through here: a split
 * that no longer fits the rack height (the size slider moved) falls back to the
 * standard stacking rather than rendering a rack taller or shorter than its
 * label.
 */
export function normalizeSegments(rackU: number, segments: unknown): number[] {
  // Sorted largest-first: `segmentOptions` only offers non-increasing splits,
  // so a hand-edited link carrying [2,5,5] must still light up the 5+5+2
  // button and name its archive 12u-5-5-2, not a fourth, unlisted split.
  return isValidSegments(rackU, segments)
    ? [...segments].sort((a, b) => b - a)
    : defaultSegments(rackU)
}
