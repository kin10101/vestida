import { Download, FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import { parseDbUtc } from '../shared/utils/dates'

export type ExportRange = 'week' | 'month' | 'all'

export interface ExportRow {
  /** DB timestamp (naive UTC or ISO) used to bucket the row by range. */
  date: string
  /** Cell values, in the same order as `columns`. */
  values: Array<string | number>
}

interface ExportMenuProps {
  /** File name stem + menu label, e.g. "transactions". */
  label: string
  columns: string[]
  rows: ExportRow[]
  /** Optional tone-neutral button text; defaults to icon-only. */
  showLabel?: boolean
}

const RANGE_META: Array<{ key: ExportRange; title: string; hint: string }> = [
  { key: 'week', title: 'This week', hint: 'From Monday to today' },
  { key: 'month', title: 'This month', hint: 'From the 1st to today' },
  { key: 'all', title: 'All records', hint: 'The full history' },
]

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Inclusive [start, end) bounds for a range, relative to the local clock. */
function boundsFor(range: ExportRange, now = new Date()): [Date, Date] | null {
  if (range === 'all') return null
  if (range === 'week') {
    // Monday-based week.
    const sinceMonday = (now.getDay() + 6) % 7
    const start = startOfDay(now)
    start.setDate(start.getDate() - sinceMonday)
    return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)]
  }
  return [
    new Date(now.getFullYear(), now.getMonth(), 1),
    new Date(now.getFullYear(), now.getMonth() + 1, 1),
  ]
}

function matchesRange(dateText: string, range: ExportRange) {
  const bounds = boundsFor(range)
  if (!bounds) return true
  const date = parseDbUtc(dateText)
  return date >= bounds[0] && date < bounds[1]
}

/** Escape a single cell for CSV (quote only when needed). */
function csvCell(value: string | number) {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(columns: string[], rows: ExportRow[]) {
  const lines = [columns.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(row.values.map(csvCell).join(','))
  }
  // UTF-8 BOM so Excel decodes accents/₱ correctly, plus CRLF row endings.
  return '\uFEFF' + lines.join('\r\n')
}

function downloadFile(fileName: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function ExportMenu({ label, columns, rows, showLabel = false }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null)

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setCoords({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  const close = () => setOpen(false)

  const pick = (range: ExportRange) => {
    const picked = rows.filter((row) => matchesRange(row.date, range))
    const rangeTag = range === 'all' ? 'all' : range === 'week' ? 'this-week' : 'this-month'
    downloadFile(`${label}-${rangeTag}.csv`, toCsv(columns, picked))
    setOpen(false)
  }

  return (
    <>
      <button type="button" className="export-trigger" onClick={openMenu} aria-haspopup="menu" aria-expanded={open} title={`Export ${label}`}>
        <Download size={15} aria-hidden="true" />
        {showLabel ? <span>Export</span> : null}
      </button>

      {open && coords ? (
        <>
          <div className="export-backdrop" onClick={close} />
          <div className="export-menu" role="menu" style={{ top: coords.top, right: coords.right }}>
            <div className="export-menu-head">
              <FileSpreadsheet size={15} aria-hidden="true" />
              <span>Export {label}</span>
            </div>
            {RANGE_META.map(({ key, title, hint }) => {
              const count = key === 'all' ? rows.length : rows.filter((row) => matchesRange(row.date, key)).length
              return (
                <button type="button" key={key} role="menuitem" onClick={() => pick(key)}>
                  <span className="export-option-main">
                    <strong>{title}</strong>
                    <small>{hint}</small>
                  </span>
                  <span className="export-option-count">{count}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </>
  )
}
