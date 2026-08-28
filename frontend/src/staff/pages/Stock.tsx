import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import LoadingSpinner from '../../shared/components/LoadingSpinner'
import { useHeaderTitleValue } from '../headerTitle'

const ALL = 'all'

const CATEGORIES: { id: string; name: string }[] = [
  { id: 'barong', name: 'Barong' },
  { id: 'suit', name: 'Suit' },
  { id: 'pants', name: 'Pants' },
  { id: 'acc', name: 'Accessories' },
]

interface StockVariant {
  color: string
  size: string | null
  available: number
  reserved: number
  inTransit: number
}

interface StockProduct {
  id: string
  categoryId: string
  name: string
  variants: StockVariant[]
}

// Placeholder stock report for the signed-in store.
//
// TODO: replace with a real DB query, e.g.
//   apiGet<StockProduct[]>(`/stock?store_id=${currentUser?.storeCode}`)
// returning COUNT(inventory_unit) per variant, split by status
// (available / reserved / in_transfer).
const STOCK: StockProduct[] = [
  {
    id: 'plain-barong',
    categoryId: 'barong',
    name: 'Plain Barong',
    variants: [
      { color: 'Black', size: 'M', available: 1, reserved: 0, inTransit: 0 },
      { color: 'Black', size: 'L', available: 2, reserved: 1, inTransit: 0 },
      { color: 'White', size: 'S', available: 3, reserved: 0, inTransit: 1 },
      { color: 'White', size: 'M', available: 1, reserved: 0, inTransit: 0 },
    ],
  },
  {
    id: 'barong-sports',
    categoryId: 'barong',
    name: 'Barong Sports Collar',
    variants: [
      { color: 'Black', size: 'M', available: 2, reserved: 0, inTransit: 0 },
      { color: 'Black', size: 'L', available: 1, reserved: 0, inTransit: 1 },
    ],
  },
  {
    id: 'formal-suit',
    categoryId: 'suit',
    name: 'Formal Suit',
    variants: [
      { color: 'Black', size: 'L', available: 1, reserved: 0, inTransit: 0 },
      { color: 'Navy', size: 'M', available: 2, reserved: 1, inTransit: 0 },
    ],
  },
  {
    id: 'waistcoat',
    categoryId: 'suit',
    name: 'Waistcoat',
    variants: [
      { color: 'Black', size: 'M', available: 0, reserved: 0, inTransit: 2 },
      { color: 'White', size: 'L', available: 2, reserved: 0, inTransit: 0 },
    ],
  },
  {
    id: 'trousers',
    categoryId: 'pants',
    name: 'Trousers',
    variants: [
      { color: 'Black', size: '32', available: 4, reserved: 0, inTransit: 0 },
      { color: 'Black', size: '34', available: 2, reserved: 0, inTransit: 0 },
      { color: 'Blue', size: '30', available: 1, reserved: 0, inTransit: 1 },
    ],
  },
  {
    id: 'arras-set',
    categoryId: 'acc',
    name: 'Arras Set',
    variants: [
      { color: 'Silver', size: null, available: 2, reserved: 0, inTransit: 0 },
      { color: 'Gold', size: null, available: 1, reserved: 1, inTransit: 0 },
    ],
  },
  {
    id: 'veil',
    categoryId: 'acc',
    name: 'Veil',
    variants: [
      { color: 'White', size: '60', available: 3, reserved: 0, inTransit: 0 },
      { color: 'Ivory', size: '72', available: 1, reserved: 0, inTransit: 0 },
    ],
  },
]

type LoadState = 'loading' | 'ready'

export default function Stock() {
  useHeaderTitleValue('Check Stock', 'Find a piece, in this store or another.')

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState(ALL)
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    let alive = true
    // Simulated round-trip so the loading state is exercised; swap for the
    // real apiGet call above (with error handling) when the API is live.
    const timer = setTimeout(() => {
      if (alive) setLoadState('ready')
    }, 350)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return STOCK.filter(
      (p) =>
        (categoryId === ALL || p.categoryId === categoryId) &&
        (q === '' || p.name.toLowerCase().includes(q)),
    )
  }, [query, categoryId])

  const totals = useMemo(
    () =>
      STOCK.reduce(
        (acc, p) => {
          for (const v of p.variants) {
            acc.available += v.available
            acc.reserved += v.reserved
            acc.inTransit += v.inTransit
          }
          return acc
        },
        { available: 0, reserved: 0, inTransit: 0 },
      ),
    [],
  )

  function categoryName(id: string): string {
    return CATEGORIES.find((c) => c.id === id)?.name ?? ''
  }

  function productAvailable(p: StockProduct): number {
    return p.variants.reduce((sum, v) => sum + v.available, 0)
  }

  return (
    <div className="staff-page stock-page">
      {loadState === 'loading' ? (
        <LoadingSpinner />
      ) : (
        <>
          <section className="stock-summary">
            <div className="stock-summary-head">
              <span className="stock-summary-total">{totals.available}</span>
              <div className="stock-summary-copy">
                <span className="stock-summary-label">pieces available</span>
                <span className="stock-summary-sub">in this store · {STOCK.length} styles</span>
              </div>
            </div>
            <div className="stock-summary-stats">
              <span className="stock-stat available"><i />{totals.available} available</span>
              <span className="stock-stat reserved"><i />{totals.reserved} reserved</span>
              <span className="stock-stat transit"><i />{totals.inTransit} in transit</span>
            </div>
          </section>

          <label className="stock-search">
            <Search size={17} />
            <input
              className="text-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search product"
            />
          </label>

          <div className="chip-scroll stock-cat-row" aria-label="Category filter chips">
            <button
              type="button"
              className={`chip${categoryId === ALL ? ' active' : ''}`}
              onClick={() => setCategoryId(ALL)}
            >
              All
            </button>
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`chip${categoryId === c.id ? ' active' : ''}`}
                onClick={() => setCategoryId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="empty-note">No stock matches your search.</div>
          ) : (
            <div className="stock-list">
              {filtered.map((p) => {
                const isExpanded = expandedProductId === p.id
                const available = productAvailable(p)
                return (
                  <div className={`stock-card${isExpanded ? ' expanded' : ''}`} key={p.id}>
                    <button
                      type="button"
                      className="stock-card-toggle"
                      onClick={() => setExpandedProductId(isExpanded ? null : p.id)}
                      aria-expanded={isExpanded}
                    >
                      <span className="stock-card-main">
                        <span className="stock-card-name">{p.name}</span>
                        <span className="stock-card-meta">{categoryName(p.categoryId)}</span>
                      </span>
                      <span className="stock-card-count">{available}</span>
                      <span className="stock-card-chevron" aria-hidden="true">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                    </button>

                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          className="stock-card-body"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.65, 0, 0.35, 1] }}
                        >
                          <div className="stock-card-body-inner">
                        {p.variants.map((v) => {
                          const extras = [
                            v.reserved > 0 ? `${v.reserved} reserved` : '',
                            v.inTransit > 0 ? `${v.inTransit} in transit` : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')
                          return (
                            <div
                              className="stock-variant-row"
                              key={`${v.color}-${v.size ?? 'one-size'}`}
                            >
                              <span className="stock-variant-label">
                                {v.color}
                                {v.size ? ` / ${v.size}` : ''}
                              </span>
                              <span className="stock-variant-state">
                                {v.available > 0 ? (
                                  <span className="stock-variant-avail">
                                    {v.available} available
                                  </span>
                                ) : (
                                  <span className="stock-variant-out">Out</span>
                                )}
                                {extras && (
                                  <span className="stock-variant-extra">{extras}</span>
                                )}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
