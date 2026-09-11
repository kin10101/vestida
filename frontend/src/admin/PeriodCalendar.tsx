import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TrendPeriod } from './trendRange'
import { windowBounds } from './trendRange'

/**
 * Calendar menu used by the trend RangePicker. It adapts to the active unit:
 *  - day   → a month calendar; clicking a day shows that exact day.
 *  - week  → the same calendar; clicking a day selects its Mon–Sun week.
 *  - month → a month grid; clicking a month shows records for that month.
 *  - year  → a year grid; clicking a year shows records for that year.
 *
 * Only current-and-earlier periods are offered (a sales trend never looks
 * ahead), and a pick always calls `onChange` with the matching offset.
 */

const DAY_MS = 86_400_000
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_SHORT = new Intl.DateTimeFormat('en-PH', { month: 'short' })
const MONTH_TITLE = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' })
const FULL_DATE = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

interface Props {
  value: TrendPeriod
  onChange: (period: TrendPeriod) => void
  onClose: () => void
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date)
  return addDays(start, -((start.getDay() + 6) % 7))
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

/** Whole days from `a` to `b` (b - a), assuming both are local midnights. */
function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

export default function PeriodCalendar({ value, onChange, onClose }: Props) {
  const unit = value.unit
  const today = startOfDay(new Date())
  const thisWeekStart = startOfWeek(today)
  const win = windowBounds(value)
  const selStart = startOfDay(win.start)
  const selEnd = win.end

  const viewAnchor = unit === 'day' ? selStart : addDays(win.end, -1)
  const initialView = { y: viewAnchor.getFullYear(), m: viewAnchor.getMonth() }
  const [focus, setFocus] = useState(initialView)

  // ---- day / week: shared month calendar --------------------------------
  if (unit === 'day' || unit === 'week') {
    const monthStart = new Date(focus.y, focus.m, 1)
    const leadingBlanks = (monthStart.getDay() + 6) % 7
    const daysInMonth = new Date(focus.y, focus.m + 1, 0).getDate()
    const monthTitle = MONTH_TITLE.format(monthStart)
    const atCurrentMonth = focus.y === today.getFullYear() && focus.m === today.getMonth()

    const isInSel = (date: Date) => {
      const day = startOfDay(date)
      return day >= selStart && day < selEnd
    }

    const isDisabled = (date: Date) => {
      if (unit === 'day') return date > today
      return startOfWeek(date) > thisWeekStart
    }

    const pick = (date: Date) => {
      if (isDisabled(date)) return
      if (unit === 'day') {
        const offset = diffDays(date, today)
        onChange({ unit: 'day', offset })
      } else {
        const offset = diffDays(startOfWeek(date), thisWeekStart) / 7
        onChange({ unit: 'week', offset })
      }
      onClose()
    }

    const cells: Array<{ date: Date | null }> = [
      ...Array.from({ length: leadingBlanks }, () => ({ date: null })),
      ...Array.from({ length: daysInMonth }, (_, index) => ({
        date: new Date(focus.y, focus.m, index + 1),
      })),
    ]

    return (
      <div className="cal-panel cal-month-view">
        <div className="cal-head">
          <button type="button" className="cal-nav-btn" aria-label="Previous month" onClick={() => setFocus((f) => (f.m === 0 ? { y: f.y - 1, m: 11 } : { ...f, m: f.m - 1 }))}>
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <span className="cal-head-title">{monthTitle}</span>
          <button
            type="button"
            className="cal-nav-btn"
            aria-label="Next month"
            disabled={atCurrentMonth}
            onClick={() => setFocus((f) => (f.m === 11 ? { y: f.y + 1, m: 0 } : { ...f, m: f.m + 1 }))}
          >
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
            const key = dateKey(date)
            const inSel = isInSel(date)
            const disabled = isDisabled(date)
            const isToday = dateKey(today) === key
            const isStart = inSel && key === dateKey(selStart)
            const classes = [
              'cal-cell',
              'cal-day',
              inSel ? 'in-range' : '',
              isStart ? 'range-start' : '',
              disabled ? 'disabled' : '',
              isToday ? 'today' : '',
            ].filter(Boolean).join(' ')
            return (
              <button
                key={key}
                type="button"
                className={classes}
                disabled={disabled}
                aria-label={FULL_DATE.format(date)}
                aria-pressed={inSel}
                onClick={() => pick(date)}
              >
                {date.getDate()}
              </button>
            )
          })}
        </div>
        <p className="cal-foot-hint">
          {unit === 'day' ? 'Pick a day to show its sales.' : 'Monday–Sunday week is shown.'}
        </p>
      </div>
    )
  }

  // ---- month: grid of the 12 months in a year ----------------------------
  if (unit === 'month') {
    const currentIndex = today.getFullYear() * 12 + today.getMonth()
    const isSelected = (m: number) => focus.y === selStart.getFullYear() && m === selStart.getMonth()

    const pick = (m: number) => {
      const targetIndex = focus.y * 12 + m
      if (targetIndex > currentIndex) return
      onChange({ unit: 'month', offset: currentIndex - targetIndex })
      onClose()
    }

    return (
      <div className="cal-panel">
        <div className="cal-head">
          <button
            type="button"
            className="cal-nav-btn"
            aria-label="Previous year"
            onClick={() => setFocus((f) => ({ ...f, y: f.y - 1 }))}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <span className="cal-head-title">{focus.y}</span>
          <button
            type="button"
            className="cal-nav-btn"
            aria-label="Next year"
            disabled={focus.y >= today.getFullYear()}
            onClick={() => setFocus((f) => ({ ...f, y: f.y + 1 }))}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="cal-months">
          {Array.from({ length: 12 }, (_, m) => {
            const date = new Date(focus.y, m, 1)
            const disabled = focus.y * 12 + m > currentIndex
            const classes = [
              'cal-month',
              isSelected(m) ? 'selected' : '',
              disabled ? 'disabled' : '',
            ].filter(Boolean).join(' ')
            return (
              <button key={m} type="button" className={classes} disabled={disabled} aria-label={MONTH_SHORT.format(date)} aria-pressed={isSelected(m)} onClick={() => pick(m)}>
                {MONTH_SHORT.format(date)}
              </button>
            )
          })}
        </div>
        <p className="cal-foot-hint">Pick a month to show its sales.</p>
      </div>
    )
  }

  // ---- year: grid of ten years per page ----------------------------------
  const decadeStart = Math.floor(focus.y / 10) * 10
  const currentYear = today.getFullYear()
  const isSelected = (y: number) => y === selStart.getFullYear()

  const pickYear = (y: number) => {
    if (y > currentYear) return
    onChange({ unit: 'year', offset: currentYear - y })
    onClose()
  }

  return (
    <div className="cal-panel">
      <div className="cal-head">
        <button type="button" className="cal-nav-btn" aria-label="Previous decade" onClick={() => setFocus((f) => ({ ...f, y: f.y - 10 }))}>
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <span className="cal-head-title">
          {decadeStart} – {decadeStart + 9}
        </span>
        <button
          type="button"
          className="cal-nav-btn"
          aria-label="Next decade"
          disabled={decadeStart + 9 >= currentYear}
          onClick={() => setFocus((f) => ({ ...f, y: f.y + 10 }))}
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="cal-years">
        {Array.from({ length: 10 }, (_, index) => {
          const y = decadeStart + index
          const disabled = y > currentYear
          const classes = [
            'cal-year',
            isSelected(y) ? 'selected' : '',
            disabled ? 'disabled' : '',
          ].filter(Boolean).join(' ')
          return (
            <button key={y} type="button" className={classes} disabled={disabled} aria-label={String(y)} aria-pressed={isSelected(y)} onClick={() => pickYear(y)}>
              {y}
            </button>
          )
        })}
      </div>
      <p className="cal-foot-hint">Pick a year to show its sales.</p>
    </div>
  )
}
