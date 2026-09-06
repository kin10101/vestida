import { parseDbUtc } from '../shared/utils/dates'

/**
 * Trend period model for the sales trend chart + the page KPIs scoped by it.
 *
 * A "period" = a window of one calendar unit (day/week/month/year) at an
 * offset backwards from "now": offset 0 = current unit, offset 1 = the
 * previous unit, etc. The window is always the FULL calendar unit (so viewing
 * "last month" sums that whole month, not just the part before today).
 *
 * All money in this app is stored in CENTS; labels are rendered in PESOS.
 */

export type TrendUnit = 'day' | 'week' | 'month' | 'year'

/** How the x axis is subdivided inside a window. */
export type TrendGranularity = 'hour' | 'day' | 'week' | 'month'

export interface TrendPeriod {
  unit: TrendUnit
  /** 0 = current unit, 1 = previous unit, … (never negative). */
  offset: number
}

export interface DateWindow {
  /** Inclusive start. */
  start: Date
  /** Exclusive end. */
  end: Date
}

export interface Bucket {
  /** Short axis label (e.g. "12 AM", "Mon", "15", "Sep 1", "Jan"). */
  label: string
  start: Date
  end: Date
}

export const TREND_UNITS: TrendUnit[] = ['day', 'week', 'month', 'year']

export const UNIT_LABEL: Record<TrendUnit, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
}

export const GRAN_LABEL: Record<TrendGranularity, string> = {
  hour: 'Hour',
  day: 'Day',
  week: 'Week',
  month: 'Month',
}

// ---- date helpers (all local-time based; never toISOString) ----------------

const WEEKDAY = new Intl.DateTimeFormat('en-PH', { weekday: 'short' })
const HOUR_FMT = new Intl.DateTimeFormat('en-PH', { hour: 'numeric' })
const MONTH_SHORT = new Intl.DateTimeFormat('en-PH', { month: 'short' })
const MONTH_YEAR = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' })
const SHORT_DATE = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })
const MED_DATE = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

const DAY_MS = 86_400_000

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date)
  const daysSinceMonday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - daysSinceMonday)
  return start
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

// ---- window boundaries -----------------------------------------------------

/** The full calendar window for a period. `end` is exclusive. */
export function windowBounds(period: TrendPeriod): DateWindow {
  const now = new Date()
  const offset = Math.max(0, Math.floor(period.offset))
  switch (period.unit) {
    case 'day': {
      const start = addDays(startOfDay(now), -offset)
      return { start, end: addDays(start, 1) }
    }
    case 'week': {
      const start = addDays(startOfWeek(now), -offset * 7)
      return { start, end: addDays(start, 7) }
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth() - offset, 1)
      return { start, end: new Date(now.getFullYear(), now.getMonth() - offset + 1, 1) }
    }
    case 'year': {
      const start = new Date(now.getFullYear() - offset, 0, 1)
      return { start, end: new Date(now.getFullYear() - offset + 1, 0, 1) }
    }
  }
}

/** True when a DB timestamp falls inside the period's window. */
export function inWindow(value: string, period: TrendPeriod): boolean {
  const { start, end } = windowBounds(period)
  const date = parseDbUtc(value)
  return date >= start && date < end
}

/** "Today", "This week", "Last week", "2 weeks ago", … */
export function periodLabel(period: TrendPeriod): string {
  const unit = UNIT_LABEL[period.unit].toLowerCase()
  if (period.offset <= 0) return period.unit === 'day' ? 'Today' : `This ${unit}`
  if (period.offset === 1) return period.unit === 'day' ? 'Yesterday' : `Last ${unit}`
  const plural = period.unit === 'day' ? 'days' : `${unit}s`
  return `${period.offset} ${plural} ago`
}

/** Human date range actually covered, e.g. "Sep 1 – Sep 30, 2026". */
export function windowLabel(period: TrendPeriod): string {
  const { start, end } = windowBounds(period)
  if (period.unit === 'day') return MED_DATE.format(start)
  const endInclusive = addDays(end, -1)
  const startText =
    start.getFullYear() === endInclusive.getFullYear()
      ? SHORT_DATE.format(start)
      : MED_DATE.format(start)
  return `${startText} – ${MED_DATE.format(endInclusive)}`
}

// ---- granularity -----------------------------------------------------------

/** Default x-axis subdivision for a unit. */
export function defaultGranularity(unit: TrendUnit): TrendGranularity {
  switch (unit) {
    case 'day': return 'hour'
    case 'week': return 'day'
    case 'month': return 'day'
    case 'year': return 'month'
  }
}

/** Granularities the user may toggle for a unit. */
export function granularityOptions(unit: TrendUnit): TrendGranularity[] {
  if (unit === 'month') return ['day', 'week']
  if (unit === 'year') return ['month', 'week']
  return [defaultGranularity(unit)]
}

// ---- bucket construction ---------------------------------------------------

function hourLabel(date: Date): string {
  return HOUR_FMT.format(date)
}

/** Full human description of one bucket, used for the hover tooltip. */
export function bucketTitle(bucket: Bucket, granularity: TrendGranularity): string {
  const endInclusive = addDays(bucket.end, -1)
  if (granularity === 'hour') {
    const endHour = addDays(bucket.end, 0)
    endHour.setTime(endHour.getTime() - 1)
    return `${SHORT_DATE.format(bucket.start)} · ${HOUR_FMT.format(bucket.start)} – ${HOUR_FMT.format(endHour)}`
  }
  if (granularity === 'day') return MED_DATE.format(bucket.start)
  if (granularity === 'week') return `${SHORT_DATE.format(bucket.start)} – ${SHORT_DATE.format(endInclusive)}`
  return MONTH_YEAR.format(bucket.start)
}

/** Build x-axis buckets covering the period's window for a granularity. */
export function buildBuckets(period: TrendPeriod, granularity: TrendGranularity): Bucket[] {
  const win = windowBounds(period)
  const windowDays = Math.round((win.end.getTime() - win.start.getTime()) / DAY_MS)
  const buckets: Bucket[] = []
  const push = (start: Date, end: Date, label: string) => {
    const bucketEnd = end.getTime() < win.end.getTime() ? end : new Date(win.end)
    buckets.push({ label, start: new Date(start), end: bucketEnd })
  }

  if (granularity === 'hour') {
    const cursor = new Date(win.start)
    while (cursor.getTime() < win.end.getTime()) {
      const next = new Date(cursor)
      next.setHours(next.getHours() + 3)
      push(cursor, next, hourLabel(cursor))
      cursor.setTime(next.getTime())
    }
  } else if (granularity === 'day') {
    const cursor = new Date(win.start)
    while (cursor.getTime() < win.end.getTime()) {
      const next = addDays(cursor, 1)
      const label =
        windowDays <= 8 ? WEEKDAY.format(cursor) : String(cursor.getDate())
      push(cursor, next, label)
      cursor.setTime(next.getTime())
    }
  } else if (granularity === 'week') {
    // Calendar weeks (Mon–Sun), clipped to the window edges so bucket sums
    // never include days outside the selected period.
    let cursor = new Date(Math.max(win.start.getTime(), startOfWeek(win.start).getTime()))
    while (cursor.getTime() < win.end.getTime()) {
      const weekStart = startOfWeek(cursor)
      const next = addDays(weekStart, 7)
      push(cursor, next, SHORT_DATE.format(cursor))
      cursor.setTime(next.getTime())
    }
  } else {
    // month granularity
    const cursor = new Date(win.start)
    while (cursor.getTime() < win.end.getTime()) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      push(cursor, next, MONTH_SHORT.format(cursor))
      cursor.setTime(next.getTime())
    }
  }
  return buckets
}
