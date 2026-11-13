/**
 * Shared bits of the two workbooks we write with ExcelJS.
 *
 * Both exports put a tick column first, because a parts list is a checklist
 * before it is a table. The tick is a one-click dropdown rather than a drawing
 * object: OOXML form controls are outside what either spreadsheet library can
 * write, and a dropdown cell is interactive in Excel, LibreOffice and Sheets
 * without any of them warning about unsupported content.
 */
import type { Workbook, Worksheet } from 'exceljs'

export const CHECK_OFF = '☐'
export const CHECK_ON = '☑'

/** Grey header band that stays readable when the sheet is printed. */
export function styleHeader(ws: Worksheet, columns: number, rowNumber = 1): void {
  const row = ws.getRow(rowNumber)
  row.height = 22
  for (let c = 1; c <= columns; c++) {
    const cell = row.getCell(c)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F4652' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF20242B' } } }
  }
  ws.views = [{ state: 'frozen', ySplit: rowNumber }]
}

/**
 * Make the tick column a two-value dropdown, and dim a row once it is ticked so
 * the maker can see at a glance how much of the print queue is behind them.
 */
export function tickColumn(ws: Worksheet, column: string, lastRow: number): void {
  const range = `${column}2:${column}${lastRow}`
  ws.dataValidations.add(range, {
    type: 'list',
    allowBlank: true,
    formulae: [`"${CHECK_OFF},${CHECK_ON}"`],
    showErrorMessage: true,
    errorTitle: 'Tick or clear',
    error: `Pick ${CHECK_OFF} or ${CHECK_ON}.`,
  })
  ws.addConditionalFormatting({
    ref: `A2:${column}${lastRow}`,
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: [`$${column}2="${CHECK_ON}"`],
        style: { font: { color: { argb: 'FF7A828D' } } },
      },
    ],
  })
  // Centre the glyph itself; the column is narrow so left alignment looks odd.
  for (let r = 2; r <= lastRow; r++) ws.getRow(r).getCell(column).alignment = { horizontal: 'center' }
}

/** Link a cell, keeping the visible text short. */
export function linkCell(ws: Worksheet, address: string, url: string, tooltip?: string): void {
  const cell = ws.getCell(address)
  cell.value = { text: String(cell.value ?? url), hyperlink: url, tooltip }
  cell.font = { color: { argb: 'FF1F6FEB' }, underline: true }
}

/** The bytes of a finished workbook, in the shape `zip.file()` and Blob want. */
export async function workbookBytes(wb: Workbook): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await wb.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}
