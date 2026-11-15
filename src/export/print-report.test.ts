import { describe, expect, it } from 'vitest'
import { makeDefaultBuild } from '../domain/defaults'
import { frameHardware } from '../domain/sources'
import type { BuildState } from '../domain/types'
import { manifestRows, manifestTotals, printListHtml } from './print-manifest'
import { printReportHtml } from './print-report'

const state: BuildState = { ...makeDefaultBuild(), rackU: 12, segments: [5, 4, 3], joinerModel: 'long' }
const rows = manifestRows(state)
const totals = manifestTotals(rows)
const printable = rows.filter((r) => r.status === 'print' || r.status === 'review')
const generatedAt = new Date('2026-11-15T10:00:00Z')

describe('printReportHtml', () => {
  for (const lang of ['en', 'ar'] as const) {
    const html = printReportHtml(rows, state, lang, generatedAt)

    it(`${lang}: every printable file name appears`, () => {
      for (const r of printable) expect(html).toContain(r.file)
    })

    it(`${lang}: the piece total appears`, () => {
      expect(html).toContain(String(totals.pieces))
    })

    it(`${lang}: each frame hardware quantity appears`, () => {
      for (const h of frameHardware(state.segments, state.joinerModel)) {
        const n = h.qty.match(/\d+/)?.[0]
        expect(n).toBeDefined()
        expect(html).toContain(n!)
      }
    })

    it(`${lang}: one checkbox per print/review row`, () => {
      expect((html.match(/type="checkbox"/g) ?? []).length).toBe(printable.length)
    })
  }

  it('en: has the print queue heading and English lang/dir', () => {
    const html = printReportHtml(rows, state, 'en', generatedAt)
    expect(html).toContain('Print queue')
    expect(html).toContain('<html lang="en" dir="ltr">')
  })

  it('ar: is right-to-left with the Arabic group and status words', () => {
    const html = printReportHtml(rows, state, 'ar', generatedAt)
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('الهيكل')
    expect(html).toContain('اطبع')
  })

  it('printListHtml stays the English report', () => {
    expect(printListHtml(rows, state, generatedAt)).toBe(printReportHtml(rows, state, 'en', generatedAt))
  })
})
