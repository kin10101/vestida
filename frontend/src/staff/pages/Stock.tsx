import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion'
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

interface StoreCounts {
  available: number
  reserved: number
  inTransit: number
}

interface StockVariant {
  color: string
  size: string | null
  // Per-store counts keyed by store code. A missing store = no stock there.
  stores: Partial<Record<string, StoreCounts>>
}

interface StockProduct {
  id: string
  categoryId: string
  name: string
  variants: StockVariant[]
}

// The 5 stores. Stock can be viewed per store, or across all of them.
const STORES: { code: string; name: string }[] = [
  { code: 'LGA', name: 'LGA Bridal Boutique' },
  { code: 'B1', name: 'Branch 1' },
  { code: 'LGF', name: 'Laguna F.' },
  { code: 'GF', name: 'G. Flores' },
  { code: 'LCA', name: 'L. Caceres' },
]

// Placeholder stock report, split by store.
//
// TODO: replace with a real DB query, e.g.
//   apiGet<StockProduct[]>(`/stock?store_id=...`)
// returning COUNT(inventory_unit) per variant per store, split by status
// (in_stock / reserved / in_transit).
const STOCK: StockProduct[] = [
  {
    id: 'plain-barong',
    categoryId: 'barong',
    name: 'Plain Barong',
    variants: [
      {
        color: 'Black',
        size: 'M',
        stores: { LGA: { available: 1, reserved: 0, inTransit: 0 }, B1: { available: 1, reserved: 0, inTransit: 0 } },
      },
      {
        color: 'Black',
        size: 'L',
        stores: { LGA: { available: 2, reserved: 1, inTransit: 0 }, LGF: { available: 1, reserved: 0, inTransit: 0 } },
      },
      {
        color: 'White',
        size: 'S',
        stores: { LGA: { available: 3, reserved: 0, inTransit: 0 }, B1: { available: 1, reserved: 0, inTransit: 1 }, GF: { available: 1, reserved: 0, inTransit: 0 } },
      },
      {
        color: 'White',
        size: 'M',
        stores: { LGA: { available: 1, reserved: 0, inTransit: 0 }, LCA: { available: 1, reserved: 0, inTransit: 0 } },
      },
    ],
  },
  {
    id: 'barong-sports',
    categoryId: 'barong',
    name: 'Barong Sports Collar',
    variants: [
      {
        color: 'Black',
        size: 'M',
        stores: { LGA: { available: 2, reserved: 0, inTransit: 0 }, GF: { available: 1, reserved: 0, inTransit: 0 } },
      },
      {
        color: 'Black',
        size: 'L',
        stores: { LGA: { available: 1, reserved: 0, inTransit: 1 }, LGF: { available: 1, reserved: 0, inTransit: 0 } },
      },
    ],
  },
  {
    id: 'formal-suit',
    categoryId: 'suit',
    name: 'Formal Suit',
    variants: [
      {
        color: 'Black',
        size: 'L',
        stores: { LGA: { available: 1, reserved: 0, inTransit: 0 }, B1: { available: 1, reserved: 0, inTransit: 0 } },
      },
      {
        color: 'Navy',
        size: 'M',
        stores: { LGA: { available: 2, reserved: 1, inTransit: 0 }, LGF: { available: 1, reserved: 0, inTransit: 0 }, GF: { available: 1, reserved: 0, inTransit: 0 } },
      },
    ],
  },
  {
    id: 'waistcoat',
    categoryId: 'suit',
    name: 'Waistcoat',
    variants: [
      {
        color: 'Black',
        size: 'M',
        stores: { LGA: { available: 0, reserved: 0, inTransit: 2 }, LCA: { available: 1, reserved: 0, inTransit: 0 } },
      },
      {
        color: 'White',
        size: 'L',
        stores: { LGA: { available: 2, reserved: 0, inTransit: 0 }, B1: { available: 1, reserved: 0, inTransit: 0 } },
      },
    ],
  },
  {
    id: 'trousers',
    categoryId: 'pants',
    name: 'Trousers',
    variants: [
      {
        color: 'Black',
        size: '32',
        stores: { LGA: { available: 4, reserved: 0, inTransit: 0 }, GF: { available: 2, reserved: 0, inTransit: 0 } },
      },
      {
        color: 'Black',
        size: '34',
        stores: { LGA: { available: 2, reserved: 0, inTransit: 0 }, LGF: { available: 1, reserved: 0, inTransit: 0 }, B1: { available: 1, reserved: 0, inTransit: 0 } },
      },
      {
        color: 'Blue',
        size: '30',
        stores: { LGA: { available: 1, reserved: 0, inTransit: 1 }, LCA: { available: 1, reserved: 0, inTransit: 0 } },
      },
    ],
  },
  {
    id: 'arras-set',
    categoryId: 'acc',
    name: 'Arras Set',
    variants: [
      {
        color: 'Silver',
        size: null,
        stores: { LGA: { available: 2, reserved: 0, inTransit: 0 }, B1: { available: 1, reserved: 0, inTransit: 0 }, GF: { available: 1, reserved: 0, inTransit: 0 } },
      },
      {
        color: 'Gold',
        size: null,
        stores: { LGA: { available: 1, reserved: 1, inTransit: 0 }, LGF: { available: 1, reserved: 0, inTransit: 0 } },
      },
    ],
  },
  {
    id: 'veil',
    categoryId: 'acc',
    name: 'Veil',
    variants: [
      {
        color: 'White',
        size: '60',
        stores: { LGA: { available: 3, reserved: 0, inTransit: 0 }, LCA: { available: 1, reserved: 0, inTransit: 0 } },
      },
      {
        color: 'Ivory',
        size: '72',
        stores: { LGA: { available: 1, reserved: 0, inTransit: 0 }, GF: { available: 1, reserved: 0, inTransit: 0 }, LGF: { available: 1, reserved: 0, inTransit: 0 } },
      },
    ],
  },
]

/** Counts for a variant under the selected filter ('all' sums every store). */
function variantCounts(v: StockVariant, store: string): StoreCounts {
  if (store === ALL) {
    const total: StoreCounts = { available: 0, reserved: 0, inTransit: 0 }
    for (const s of Object.values(v.stores)) {
      if (!s) continue
      total.available += s.available
      total.reserved += s.reserved
      total.inTransit += s.inTransit
    }
    return total
  }
  return v.stores[store] ?? { available: 0, reserved: 0, inTransit: 0 }
}

type LoadState = 'loading' | 'ready'

export default function Stock() {
  useHeaderTitleValue('Check Stock', 'Find a piece, in this store or another.')

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState(ALL)
  const [storeId, setStoreId] = useState(ALL)
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

  const contextTotal = useMemo(
    () => STOCK.reduce((sum, p) => sum + productAvailable(p, storeId), 0),
    [storeId],
  )

  function categoryName(id: string): string {
    return CATEGORIES.find((c) => c.id === id)?.name ?? ''
  }

  function productAvailable(p: StockProduct, store: string): number {
    return p.variants.reduce((sum, v) => sum + variantCounts(v, store).available, 0)
  }

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className="staff-page stock-page"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
      {loadState === 'loading' ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className="store-filter-block">
            <h2 className="store-filter-label">Filter by Store</h2>
            <div className="store-filter" role="group" aria-label="Filter by store">
              {STORES.map((s) => {
                const active = storeId === s.code
                return (
                  <motion.button
                    type="button"
                    key={s.code}
                    className={`store-chip${active ? ' active' : ''}`}
                    aria-pressed={active}
                    onClick={() => setStoreId((cur) => (cur === s.code ? ALL : s.code))}
                    whileTap={{ scale: 0.94 }}
                    animate={{ scale: active ? 1.04 : 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                  >
                    {s.code}
                  </motion.button>
                )
              })}
            </div>

            <p className="stock-context">
              {storeId === ALL ? 'All stores' : storeId} · {contextTotal} available
            </p>
          </div>

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
            <motion.button
              type="button"
              className={`chip${categoryId === ALL ? ' active' : ''}`}
              onClick={() => setCategoryId(ALL)}
              whileTap={{ scale: 0.94 }}
              animate={{ scale: categoryId === ALL ? 1.04 : 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            >
              All
            </motion.button>
            {CATEGORIES.map((c) => (
              <motion.button
                type="button"
                key={c.id}
                className={`chip${categoryId === c.id ? ' active' : ''}`}
                onClick={() => setCategoryId(c.id)}
                whileTap={{ scale: 0.94 }}
                animate={{ scale: categoryId === c.id ? 1.04 : 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              >
                {c.name}
              </motion.button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="empty-note">No stock matches your search.</div>
          ) : (
            <div className="stock-list">
              {filtered.map((p) => {
                const isExpanded = expandedProductId === p.id
                const available = productAvailable(p, storeId)
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
                          const c = variantCounts(v, storeId)
                          const extras = [
                            c.reserved > 0 ? `${c.reserved} reserved` : '',
                            c.inTransit > 0 ? `${c.inTransit} in transit` : '',
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
                                {c.available > 0 ? (
                                  <span className="stock-variant-avail">
                                    {c.available} available
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
      </motion.div>
    </MotionConfig>
  )
}
