/**
 * ExcelJS 4.4 ships data-validation support at runtime but not in its typings,
 * and the tick column depends on it. Declare only what this repo uses rather
 * than casting worksheets to `any` at the call site.
 */
import 'exceljs'

declare module 'exceljs' {
  interface DataValidationList {
    type: 'list'
    allowBlank?: boolean
    formulae: string[]
    showErrorMessage?: boolean
    errorTitle?: string
    error?: string
  }

  interface DataValidations {
    add(range: string, validation: DataValidationList): void
  }

  interface Worksheet {
    dataValidations: DataValidations
  }
}
