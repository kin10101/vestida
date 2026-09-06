import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { TrendPeriod } from './trendRange'
import { periodLabel, TREND_UNITS, UNIT_LABEL } from './trendRange'

const MAX_BACK = 6

interface Props {
  value: TrendPeriod
  onChange: (period: TrendPeriod) => void
  variant?: 'page' | 'toolbar'
}

interface MenuPos {
  top: number
  left: number
}

/**
 * Page-level period selector: Day/Week/Month/Year unit tabs plus prev/next
 * stepping arrows and a quick-jump lookback menu for earlier periods.
 */
export default function RangePicker({ value, onChange, variant = 'page' }: Props) {
  const [menu, setMenu] = useState<MenuPos | null>(null)

  const chooseUnit = (unit: TrendPeriod['unit']) => onChange({ unit, offset: 0 })
  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 172))
    setMenu({ top: rect.bottom + 6, left })
  }
  const pickOffset = (offset: number) => {
    onChange({ ...value, offset })
    setMenu(null)
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
            aria-haspopup="menu"
            aria-expanded={Boolean(menu)}
            aria-label="Choose period"
            onClick={openMenu}
          >
            <span>{periodLabel(value)}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {menu ? (
            <>
              <div className="range-backdrop" onClick={() => setMenu(null)} />
              <div className="range-period-options" role="menu" style={{ top: menu.top, left: menu.left }}>
                {Array.from({ length: MAX_BACK + 1 }, (_, offset) => (
                  <button
                    key={offset}
                    type="button"
                    role="menuitemradio"
                    aria-checked={value.offset === offset}
                    className={value.offset === offset ? 'active' : ''}
                    onClick={() => pickOffset(offset)}
                  >
                    {periodLabel({ ...value, offset })}
                  </button>
                ))}
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
