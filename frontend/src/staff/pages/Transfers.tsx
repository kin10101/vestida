import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useHeaderTitleValue } from '../headerTitle'
import { dateGroupLabel, dateKey } from '../../shared/utils/dates'

/* ------------------------------------------------------------------ */
/* Placeholder data + notes.                                           */
/*                                                                     */
/* A transfer is NOT a row in the DB. It is a batch of `in_transit`    */
/* units whose last `transferred_out` movement points at a store.      */
/* Receiving logs `transferred_in`; cancelling logs an `adjustment`.   */
/*                                                                     */
/* TODO (when the API is live):                                        */
/*   Outgoing list  → in_transit units whose latest transferred_out    */
/*     has from_store_id = currentUser.storeCode, grouped by to_store  */
/*     and sent batch; received / cancelled come from the ledger.      */
/*   Send           → apiRpc('transfer_stock', { to_store_id, items,   */
/*     note, client_ref }) — units are auto-assigned server-side from  */
/*     this store's in_stock units, so staff never pick unit codes.    */
/*   Cancel         → an 'adjustment' movement returning the units to  */
/*     in_stock here (reverse of the transferred_out batch).           */
/* ------------------------------------------------------------------ */

const MY_STORE = 'LGA'

const STORES: { id: string; code: string; name: string }[] = [
  { id: 'b1', code: 'B1', name: 'Branch 1' },
  { id: 'lgf', code: 'LGF', name: 'Laguna F.' },
  { id: 'gf', code: 'GF', name: 'G. Flores' },
  { id: 'lca', code: 'LCA', name: 'L. Caceres' },
]

const ALL = 'all'

const CATEGORIES: { id: string; name: string }[] = [
  { id: 'barong', name: 'Barong' },
  { id: 'suit', name: 'Suit' },
  { id: 'pants', name: 'Pants' },
  { id: 'acc', name: 'Accessories' },
]

interface CatalogVariant {
  color: string
  size: string | null
  available: number
}

interface CatalogProduct {
  id: string
  categoryId: string
  name: string
  variants: CatalogVariant[]
}

// This store's catalog with per-variant available (in_stock) counts.
// TODO: replace with a real stock query scoped to currentUser.storeCode.
const CATALOG: CatalogProduct[] = [
  {
    id: 'plain-barong',
    categoryId: 'barong',
    name: 'Plain Barong',
    variants: [
      { color: 'Black', size: 'M', available: 1 },
      { color: 'Black', size: 'L', available: 2 },
      { color: 'White', size: 'S', available: 3 },
      { color: 'White', size: 'M', available: 1 },
    ],
  },
  {
    id: 'barong-sports',
    categoryId: 'barong',
    name: 'Barong Sports Collar',
    variants: [
      { color: 'Black', size: 'M', available: 2 },
      { color: 'Black', size: 'L', available: 1 },
    ],
  },
  {
    id: 'formal-suit',
    categoryId: 'suit',
    name: 'Formal Suit',
    variants: [
      { color: 'Black', size: 'L', available: 1 },
      { color: 'Navy', size: 'M', available: 2 },
    ],
  },
  {
    id: 'trousers',
    categoryId: 'pants',
    name: 'Trousers',
    variants: [
      { color: 'Black', size: '32', available: 4 },
      { color: 'Black', size: '34', available: 2 },
      { color: 'Blue', size: '30', available: 1 },
    ],
  },
  {
    id: 'arras-set',
    categoryId: 'acc',
    name: 'Arras Set',
    variants: [
      { color: 'Silver', size: null, available: 2 },
      { color: 'Gold', size: null, available: 1 },
    ],
  },
]

type TransferStatus = 'in_transit' | 'received' | 'cancelled'

interface OutgoingTransfer {
  id: string
  toStoreId: string
  sentAt: string
  status: TransferStatus
  note?: string
  items: { name: string; detail: string; qty: number }[]
}

function daysAgoISO(days: number, hour = 10): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(hour, 30, 0, 0)
  return d.toISOString()
}

// TODO: derive from the stock_movement ledger (see header comment).
const INITIAL_OUTGOING: OutgoingTransfer[] = [
  {
    id: 'tr-2048',
    toStoreId: 'lgf',
    sentAt: daysAgoISO(1, 14),
    status: 'in_transit',
    note: 'For Elyssa fitting 8/30',
    items: [
      { name: 'Formal Suit', detail: 'Navy / M', qty: 1 },
      { name: 'Trousers', detail: 'Black / 32', qty: 1 },
    ],
  },
  {
    id: 'tr-2047',
    toStoreId: 'gf',
    sentAt: daysAgoISO(3, 9),
    status: 'in_transit',
    items: [{ name: 'Plain Barong', detail: 'White / S', qty: 2 }],
  },
  {
    id: 'tr-2040',
    toStoreId: 'b1',
    sentAt: daysAgoISO(6, 11),
    status: 'received',
    items: [{ name: 'Arras Set', detail: 'Silver / Standard', qty: 1 }],
  },
  {
    id: 'tr-2035',
    toStoreId: 'lca',
    sentAt: daysAgoISO(9, 16),
    status: 'cancelled',
    note: 'Customer changed mind',
    items: [{ name: 'Barong Sports Collar', detail: 'Black / L', qty: 1 }],
  },
]

interface TransferItem {
  key: number
  variantId: string
  name: string
  detail: string
  qty: number
}

type View = 'list' | 'destination' | 'pieces' | 'review' | 'sent'

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function storeCode(id: string): string {
  return STORES.find((s) => s.id === id)?.code ?? id.toUpperCase()
}

function storeName(id: string): string {
  return STORES.find((s) => s.id === id)?.name ?? storeCode(id)
}

function totalAvailable(p: CatalogProduct): number {
  return p.variants.reduce((sum, v) => sum + v.available, 0)
}

export default function Transfers() {
  const [view, setView] = useState<View>('list')
  const [toStoreId, setToStoreId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState(ALL)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [color, setColor] = useState<string | null>(null)
  const [size, setSize] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [items, setItems] = useState<TransferItem[]>([])
  const [note, setNote] = useState('')
  const [sentRef, setSentRef] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)

  // Mock ledger of outgoing transfers; kept in state so cancelling works.
  const [outgoing, setOutgoing] = useState<OutgoingTransfer[]>(INITIAL_OUTGOING)

  // Outgoing transfers grouped by the date they were sent, newest first.
  const groupedOutgoing = useMemo(() => {
    const groups = new Map<string, OutgoingTransfer[]>()
    for (const t of outgoing) {
      const key = dateKey(t.sentAt)
      const arr = groups.get(key) ?? []
      arr.push(t)
      groups.set(key, arr)
    }
    return [...groups.entries()]
  }, [outgoing])

  const headRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    const head = selectedId ? headRefs.current[selectedId] : null
    if (head) head.focus({ preventScroll: true })
  }, [selectedId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CATALOG.filter(
      (p) =>
        (categoryId === ALL || p.categoryId === categoryId) &&
        (q === '' || p.name.toLowerCase().includes(q)),
    )
  }, [query, categoryId])

  const current = CATALOG.find((p) => p.id === selectedId) ?? null
  const colors = current ? [...new Set(current.variants.map((v) => v.color))] : []
  const hasSizes = current ? current.variants.some((v) => v.size !== null) : false
  const sizes =
    current && color
      ? current.variants.filter((v) => v.color === color).map((v) => v.size)
      : []
  const selectedVariant =
    current?.variants.find((v) => v.color === color && v.size === size) ?? null
  const stock = selectedVariant?.available ?? 0

  const pieceCount = items.reduce((sum, i) => sum + i.qty, 0)

  const title = view === 'list' ? 'Transfer Stock' : 'New Transfer'
  const subtitle =
    view === 'list'
      ? 'Send pieces to another store.'
      : view === 'destination'
        ? 'Where are you sending pieces?'
        : view === 'pieces'
          ? 'Choose pieces from this store.'
          : view === 'review'
            ? 'Check the transfer before sending.'
            : ''
  useHeaderTitleValue(title, subtitle)

  function selectProduct(p: CatalogProduct) {
    if (selectedId === p.id) {
      setSelectedId(null)
      return
    }
    const first = p.variants[0]
    setSelectedId(p.id)
    setColor(first?.color ?? null)
    setSize(first?.size ?? null)
    setQty(1)
  }

  function pickColor(c: string) {
    setColor(c)
    setSize(current?.variants.find((v) => v.color === c)?.size ?? null)
    setQty(1)
  }

  function addItem() {
    if (!current || !selectedVariant || stock === 0) return
    setItems((prev) => [
      ...prev,
      {
        key: Date.now(),
        variantId: `${current.id}-${selectedVariant.color}-${selectedVariant.size ?? 'std'}`,
        name: current.name,
        detail: [selectedVariant.color, selectedVariant.size].filter(Boolean).join(' / '),
        qty,
      },
    ])
    setSelectedId(null)
    setQuery('')
  }

  function removeItem(key: number) {
    setItems((prev) => prev.filter((i) => i.key !== key))
  }

  function sendTransfer() {
    if (!toStoreId || items.length === 0) return
    // TODO: wire to the backend RPC — units are auto-assigned server-side.
    //   await apiRpc('transfer_stock', {
    //     to_store_id: toStoreId,
    //     items: items.map((i) => ({ variant_id: i.variantId, quantity: i.qty })),
    //     note: note.trim() || undefined,
    //     client_ref: <generated on-device>,
    //   })
    setSentRef(`TR-${Date.now().toString().slice(-6)}`)
    setView('sent')
  }

  function confirmCancel() {
    if (!cancelId) return
    // TODO: call the API to reverse the in-transit units (adjustment).
    setOutgoing((prev) =>
      prev.map((t) => (t.id === cancelId ? { ...t, status: 'cancelled' as const } : t)),
    )
    setCancelId(null)
  }

  function startOver() {
    setToStoreId(null)
    setQuery('')
    setCategoryId(ALL)
    setSelectedId(null)
    setColor(null)
    setSize(null)
    setQty(1)
    setItems([])
    setNote('')
    setSentRef('')
    setView('destination')
  }

  /* ------------------------- list view ------------------------- */

  const listBody = (
    <>
      {outgoing.length === 0 ? (
        <p className="empty-note">No outgoing transfers yet.</p>
      ) : (
        <div className="transfer-list">
          {groupedOutgoing.map(([key, transfers]) => (
            <section className="date-group" key={key}>
              <h2 className="date-group-label">{dateGroupLabel(transfers[0].sentAt)}</h2>
              {transfers.map((t) => {
                const isExpanded = expandedId === t.id
                return (
                  <div key={t.id} className={`transfer-card${isExpanded ? ' expanded' : ''}`}>
                <button
                  type="button"
                  className="transfer-row-toggle"
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                  aria-expanded={isExpanded}
                >
                  <span className="transfer-store">
                    <span className="transfer-store-name">To {storeCode(t.toStoreId)}</span>
                    <span className="transfer-store-sub">{storeName(t.toStoreId)}</span>
                  </span>
                  <span className="transfer-count">
                    {t.items.reduce((sum, i) => sum + i.qty, 0)} pcs
                  </span>
                  <span className={`transfer-status ${t.status}`}>{t.status.replace('_', ' ')}</span>
                  <span className="transfer-chevron" aria-hidden="true">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      className="transfer-card-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.65, 0, 0.35, 1] }}
                    >
                      <div className="transfer-card-body-inner">
                        {t.items.map((i) => (
                          <div className="transfer-item-row" key={`${i.name}-${i.detail}`}>
                            <span className="transfer-item-name">{i.name}</span>
                            <span className="transfer-item-detail">
                              {i.detail} · {i.qty} pcs
                            </span>
                          </div>
                        ))}
                        <div className="transfer-meta">
                          <span>Sent {formatDate(t.sentAt)}</span>
                          {t.note && <span className="transfer-meta-note">{t.note}</span>}
                        </div>
                        {t.status === 'in_transit' && (
                          <button
                            type="button"
                            className="text-btn transfer-cancel"
                            onClick={() => setCancelId(t.id)}
                          >
                            Cancel transfer
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
              )
            })}
              </section>
          ))}
        </div>
      )}
    </>
  )

  /* ---------------------- destination view ---------------------- */

  const destinationBody = (
    <div className="variant-panel">
      <div className="step-tag">Destination store</div>
      <p className="stock-note">
        Pieces move from <strong>{MY_STORE}</strong> to the store you pick below.
      </p>
      <div className="option-row transfer-store-options">
        {STORES.map((s) => (
          <motion.button
            type="button"
            key={s.id}
            className={`option-chip transfer-store-chip${toStoreId === s.id ? ' active' : ''}`}
            onClick={() => setToStoreId(s.id)}
            whileTap={{ scale: 0.94 }}
            animate={{ scale: toStoreId === s.id ? 1.04 : 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
          >
            {s.code}
          </motion.button>
        ))}
      </div>
    </div>
  )

  /* ------------------------ pieces view ------------------------- */

  const piecesBody = (
    <>
      <label className="sale-search">
        <Search size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product"
        />
      </label>

      <div className="chip-scroll">
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
        <p className="empty-note">No products match your search.</p>
      ) : (
        <div className="product-grid">
          {filtered.map((p) => {
            const expanded = selectedId === p.id
            return (
              <div key={p.id} className={`product-card${expanded ? ' expanded' : ''}`}>
                <button
                  type="button"
                  className="product-card-head"
                  onClick={() => selectProduct(p)}
                  aria-expanded={expanded}
                  ref={(el) => {
                    headRefs.current[p.id] = el
                  }}
                >
                  <span className="product-card-info">
                    <span className="product-name">{p.name}</span>
                    <span className="product-card-meta">
                      {totalAvailable(p) > 0 ? `${totalAvailable(p)} available` : 'Out of stock'}
                    </span>
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      className="product-card-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.65, 0, 0.35, 1] }}
                      onAnimationComplete={() => {
                        if (expanded) {
                          headRefs.current[p.id]
                            ?.closest('.product-card')
                            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
                        }
                      }}
                    >
                      <div className="product-body-inner">
                        <div className="step-tag">1 · Color</div>
                        <div className="option-row">
                          {colors.map((c) => (
                            <motion.button
                              type="button"
                              key={c}
                              className={`option-chip${color === c ? ' active' : ''}`}
                              onClick={() => pickColor(c)}
                              whileTap={{ scale: 0.94 }}
                              animate={{ scale: color === c ? 1.04 : 1 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                            >
                              {c}
                            </motion.button>
                          ))}
                        </div>

                        {hasSizes && (
                          <>
                            <div className="step-tag">2 · Size</div>
                            <div className="option-row">
                              {sizes.map((s) => (
                                <motion.button
                                  type="button"
                                  key={s ?? 'one-size'}
                                  className={`option-chip${size === s ? ' active' : ''}`}
                                  onClick={() => setSize(s)}
                                  whileTap={{ scale: 0.94 }}
                                  animate={{ scale: size === s ? 1.04 : 1 }}
                                  transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                                >
                                  {s}
                                </motion.button>
                              ))}
                            </div>
                          </>
                        )}

                        <div className="stock-note">
                          <strong>{stock}</strong> available to send
                        </div>

                        <div className="step-tag">3 · Quantity</div>
                        <div className="stepper">
                          <button
                            type="button"
                            className="stepper-btn"
                            disabled={qty <= 1}
                            onClick={() => setQty(qty - 1)}
                            aria-label="Decrease quantity"
                          >
                            <Minus size={16} />
                          </button>
                          <span className="stepper-value">{qty}</span>
                          <button
                            type="button"
                            className="stepper-btn"
                            disabled={qty >= stock}
                            onClick={() => setQty(qty + 1)}
                            aria-label="Increase quantity"
                          >
                            <Plus size={16} />
                          </button>
                        </div>

                        <button
                          type="button"
                          className="primary-btn panel-action"
                          disabled={stock === 0}
                          onClick={addItem}
                        >
                          {stock === 0 ? 'Out of stock' : 'Add to Transfer'}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      )}

      {items.length > 0 && (
        <>
          <h2 className="order-section-title">
            Transfer · {pieceCount} piece{pieceCount > 1 ? 's' : ''}
          </h2>
          <div className="order-card">
            {items.map((i) => (
              <div key={i.key} className="order-item">
                <div className="order-item-main">
                  <div className="order-item-name">{i.name}</div>
                  <div className="order-item-sub">{i.detail} · {i.qty} pcs</div>
                </div>
                <div className="order-item-side">
                  <button
                    type="button"
                    className="order-remove"
                    aria-label={`Remove ${i.name}`}
                    onClick={() => removeItem(i.key)}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="transfer-hint">
            Specific pieces are chosen automatically from this store's stock.
          </p>
        </>
      )}
    </>
  )

  /* ------------------------ review view ------------------------- */

  const reviewBody = (
    <>
      <button type="button" className="checkout-back" onClick={() => setView('pieces')}>
        <ArrowLeft size={15} />
        Back to pieces
      </button>

      <h2 className="order-section-title">Transfer Summary</h2>

      <div className="summary-total-row">
        <span>To {toStoreId ? storeCode(toStoreId) : ''}</span>
        <span className="summary-total-value">
          {pieceCount} pc{pieceCount > 1 ? 's' : ''}
        </span>
      </div>

      <div className="order-card transfer-review-items">
        {items.map((i) => (
          <div key={i.key} className="order-item">
            <div className="order-item-main">
              <div className="order-item-name">{i.name}</div>
              <div className="order-item-sub">{i.detail} · {i.qty} pcs</div>
            </div>
          </div>
        ))}
      </div>

      <label className="field-label" htmlFor="transfer-note">Note (optional)</label>
      <textarea
        id="transfer-note"
        className="text-input textarea"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder='e.g. "For Elyssa fitting 8/30"'
      />
    </>
  )

  /* ------------------------- sent view -------------------------- */

  const sentBody = (
    <div className="success-wrap">
      <motion.span
        className="success-icon"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <Check size={28} />
      </motion.span>
      <p className="success-ref">
        Transfer {sentRef} sent to {toStoreId ? storeCode(toStoreId) : ''}
      </p>

      <div className="order-card transfer-review-items">
        {items.map((i) => (
          <div key={i.key} className="order-item">
            <div className="order-item-main">
              <div className="order-item-name">{i.name}</div>
              <div className="order-item-sub">{i.detail} · {i.qty} pcs</div>
            </div>
          </div>
        ))}
      </div>

      <div className="success-summary">
        <div className="summary-row">
          <span>Destination</span>
          <span>{toStoreId ? storeName(toStoreId) : ''}</span>
        </div>
        <div className="summary-row">
          <span>Pieces</span>
          <span>{pieceCount}</span>
        </div>
        {note && (
          <div className="summary-row">
            <span>Note</span>
            <span>{note}</span>
          </div>
        )}
      </div>

      <button type="button" className="primary-btn" onClick={startOver}>
        New Transfer
      </button>
      <Link className="secondary-btn" to="/staff">
        Back to Home
      </Link>
    </div>
  )

  /* -------------------------- footer ---------------------------- */

  const footer =
    view === 'list' ? (
      <motion.div
        className="sale-footer"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <button type="button" className="primary-btn" onClick={startOver}>
          <ArrowUpRight size={18} />
          <span>New Transfer</span>
        </button>
      </motion.div>
    ) : view === 'destination' ? (
      <div className="sale-footer">
        <button
          type="button"
          className="primary-btn"
          disabled={!toStoreId}
          onClick={() => setView('pieces')}
        >
          Choose Pieces
        </button>
        <button type="button" className="secondary-btn" onClick={() => setView('list')}>
          Cancel
        </button>
      </div>
    ) : view === 'pieces' ? (
      <div className="sale-footer">
        <button
          type="button"
          className="primary-btn"
          disabled={items.length === 0}
          onClick={() => setView('review')}
        >
          Review Transfer
        </button>
        <button type="button" className="secondary-btn" onClick={() => setView('destination')}>
          Back to store
        </button>
      </div>
    ) : view === 'review' ? (
      <div className="sale-footer">
        <button
          type="button"
          className="primary-btn"
          disabled={items.length === 0}
          onClick={sendTransfer}
        >
          Send Transfer
        </button>
        <button type="button" className="secondary-btn" onClick={() => setView('pieces')}>
          Back to pieces
        </button>
      </div>
    ) : null

  /* --------------------------- render --------------------------- */

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className="sale-screen"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <AnimatePresence>
          {cancelId && (
            <motion.div
              className="gate-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Cancel transfer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              onClick={() => setCancelId(null)}
            >
              <motion.div
                className="gate-card"
                initial={{ opacity: 0, scale: 0.94, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 10 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ transformOrigin: '50% 100%' }}
                onClick={(e) => e.stopPropagation()}
              >
                <h1 className="gate-title">Cancel transfer?</h1>
                <p className="gate-sub">
                  The pieces go back into this store's stock. Only possible before the other
                  store receives them.
                </p>
                <div className="modal-actions">
                  <button type="button" className="secondary-btn" onClick={() => setCancelId(null)}>
                    Keep
                  </button>
                  <button
                    type="button"
                    className="primary-btn cancel-confirm"
                    onClick={confirmCancel}
                  >
                    Cancel transfer
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="sale-body">
          <AnimatePresence mode="wait" initial={false}>
            {view === 'list' && (
              <motion.div
                key="list"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
              >
                {listBody}
              </motion.div>
            )}
            {view === 'destination' && (
              <motion.div
                key="destination"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
              >
                {destinationBody}
              </motion.div>
            )}
            {view === 'pieces' && (
              <motion.div
                key="pieces"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
              >
                {piecesBody}
              </motion.div>
            )}
            {view === 'review' && (
              <motion.div
                key="review"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
              >
                {reviewBody}
              </motion.div>
            )}
            {view === 'sent' && (
              <motion.div
                key="sent"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
              >
                {sentBody}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {footer}
      </motion.div>
    </MotionConfig>
  )
}
