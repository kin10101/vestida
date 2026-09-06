import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Calendar range picker for the Sales date filter. Dates are kept as local
 * "YYYY-MM-DD" strings (the same format the rest of Sales uses). Picking works
 * in two taps: the first tap sets the start, the second sets the end (any date
 * on or after the start) and closes. Tapping again after a full range starts a
 * brand-new range.
 */

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_TITLE = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' })
const FULL_DATE = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

interface Props {
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onClose: () => void
}

function parseLocal(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export default function DateRangeCalendar({ from, to, onFromChange, onToChange, onClose }: Props) {
  const todayKey = toKey(startOfToday())
  const [focus, setFocus] = useState(() => {
    const initial = from ? parseLocal(from) : startOfToday()
    return { y: initial.getFullYear(), m: initial.getMonth() }
  })

  const fromDate = from ? parseLocal(from) : null
  const toDate = to ? parseLocal(to) : null
  const fromKey = fromDate ? toKey(fromDate) : ''
  const toKeyValue = toDate ? toKey(toDate) : ''
  const pickingEnd = Boolean(fromDate && !toDate)

  const monthStart = new Date(focus.y, focus.m, 1)
  const leadingBlanks = (monthStart.getDay() + 6) % 7
  const daysInMonth = new Date(focus.y, focus.m + 1, 0).getDate()
  const atCurrentMonth = focus.y === Number(todayKey.slice(0, 4)) && focus.m === Number(todayKey.slice(5, 7)) - 1

  const isInRange = (key: string) => {
    if (!fromKey) return false
    if (!toKeyValue) return key === fromKey
    return key >= fromKey && key <= toKeyValue
  }

  const pick = (key: string) => {
    if (!fromKey || toKeyValue) {
      // No start yet, or a full range is already set → begin a new range.
      onFromChange(key)
      onToChange('')
      return
    }
    // Start is set, awaiting the end.
    if (key >= fromKey) {
      onToChange(key)
      onClose()
    } else {
      onFromChange(key)
    }
  }

  const prevMonth = () => setFocus((f) => (f.m === 0 ? { y: f.y - 1, m: 11 } : { ...f, m: f.m - 1 }))
  const nextMonth = () => setFocus((f) => (f.m === 11 ? { y: f.y + 1, m: 0 } : { ...f, m: f.m + 1 }))

  const cells: Array<{ date: Date | null }> = [
    ...Array.from({ length: leadingBlanks }, () => ({ date: null })),
    ...Array.from({ length: daysInMonth }, (_, index) => ({ date: new Date(focus.y, focus.m, index + 1) })),
  ]

  return (
    <div className="cal-panel cal-month-view">
      <div className="cal-range-status">
        {pickingEnd && fromDate ? (
          <span>Start <strong>{FULL_DATE.format(fromDate)}</strong> — now pick the end date.</span>
        ) : fromDate ? (
          <span>Showing {FULL_DATE.format(fromDate)}{toDate ? ` – ${FULL_DATE.format(toDate)}` : ' onward'}</span>
        ) : (
          <span>Pick a start date.</span>
        )}
      </div>
      <div className="cal-head">
        <button type="button" className="cal-nav-btn" aria-label="Previous month" onClick={prevMonth}>
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <span className="cal-head-title">{MONTH_TITLE.format(monthStart)}</span>
        <button type="button" className="cal-nav-btn" aria-label="Next month" disabled={atCurrentMonth} onClick={nextMonth}>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="cal-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="cal-grid">
        {cells.map((cell, index) => {
          const date = cell.date
          if (!date) return <span key={`blank-${index}`} className="cal-cell" />
          const key = toKey(date)
          const inRange = isInRange(key)
          const isStart = key === fromKey
          const isEnd = key === toKeyValue
          const isToday = key === todayKey
          const classes = [
            'cal-cell',
            'cal-day',
            inRange ? 'in-range' : '',
            isStart ? 'range-start' : '',
            isEnd ? 'range-end' : '',
            isToday ? 'today' : '',
          ].filter(Boolean).join(' ')
          return (
            <button
              key={key}
              type="button"
              className={classes}
              aria-label={FULL_DATE.format(date)}
              aria-pressed={isStart || isEnd}
              onClick={() => pick(key)}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
      <div className="cal-actions">
        <button type="button" className="sales-date-clear" onClick={() => { onFromChange(''); onToChange(''); onClose() }}>
          Clear dates
        </button>
      </div>
    </div>
  )
}
