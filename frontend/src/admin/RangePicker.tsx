import { useCallback, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { TrendPeriod } from './trendRange'
import { TREND_UNITS, UNIT_LABEL, windowShortLabel } from './trendRange'
import PeriodCalendar from './PeriodCalendar'
import useDismissOnScroll from './useDismissOnScroll'

interface Props {
  value: TrendPeriod
  onChange: (period: TrendPeriod) => void
  variant?: 'page' | 'toolbar'
}

interface MenuPos {
  top: number
  left: number
}

const MENU_WIDTH = 300

/**
 * Page-level period selector: Day/Week/Month/Year unit tabs plus prev/next
 * stepping arrows. The center control shows the real date window and opens a
 * calendar menu (PeriodCalendar) that adapts to the active unit — day/week
 * pick a day or its Mon–Sun week on a month grid, month/year pick directly.
 */
export default function RangePicker({ value, onChange, variant = 'page' }: Props) {
  const [menu, setMenu] = useState<MenuPos | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  useDismissOnScroll(Boolean(menu), closeMenu)

  const chooseUnit = (unit: TrendPeriod['unit']) => onChange({ unit, offset: 0 })
  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 12))
    setMenu({ top: rect.bottom + 6, left })
  }
  return (
    <div className={`range-picker range-picker-${variant}`} aria-label="Trend period">
      <div className="range-unit-tabs" role="tablist" aria-label="Trend period unit">
        {TREND_UNITS.map((unit) => (
          <button
            key={unit}
            type="button"
            role="tab"
            aria-selected={value.unit === unit}
            className={value.unit === unit ? 'active' : ''}
            onClick={() => chooseUnit(unit)}
          >
            {UNIT_LABEL[unit]}
          </button>
        ))}
      </div>
      <div className="range-nav">
        <button
          type="button"
          className="range-nav-arrow"
          aria-label="View earlier period"
          title="Earlier"
          onClick={() => onChange({ ...value, offset: value.offset + 1 })}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <div className="range-period">
          <button
            type="button"
            className="range-period-current"
            aria-haspopup="dialog"
            aria-expanded={Boolean(menu)}
            aria-label="Choose period on a calendar"
            onClick={openMenu}
          >
            <span>{windowShortLabel(value)}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {menu ? (
            <>
              <div className="range-backdrop" onClick={closeMenu} />
              <div className="range-calendar-wrap" role="dialog" aria-label="Pick a period" style={{ top: menu.top, left: menu.left }}>
                <PeriodCalendar value={value} onChange={onChange} onClose={closeMenu} />
              </div>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className="range-nav-arrow"
          aria-label="View later period"
          title="Later"
          disabled={value.offset <= 0}
          onClick={() => onChange({ ...value, offset: Math.max(0, value.offset - 1) })}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
