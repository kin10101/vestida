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
import { apiRpc } from '../../shared/api/client'
import { useAuth } from '../../auth/AuthContext'

const ALL = 'all'

interface CatalogVariant {
  id: string
  color: string
  size: string | null
  inStock: number
}

interface CatalogProduct {
  id: string
  categoryId: string
  name: string
  variants: CatalogVariant[]
}

type TransferStatus = 'in_transit' | 'received' | 'cancelled'

interface OutgoingTransfer {
  id: string
  toStoreId: string
  sentAt: string
  status: TransferStatus
  note?: string
  items: { name: string; detail: string; qty: number }[]
}

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

function totalAvailable(p: CatalogProduct): number {
  return p.variants.reduce((sum, v) => sum + v.inStock, 0)
}

export default function Transfers() {
  const { user } = useAuth()
  const myStore = user?.storeCode ?? ''

  const [stores, setStores] = useState<{ id: string; code: string; name: string }[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingTransfer[]>([])

  useEffect(() => {
    let alive = true
    Promise.all([
      apiRpc<{ id: string; code: string; name: string }[]>('get_stores', {}),
      apiRpc<{ id: string; name: string }[]>('get_categories', {}),
      apiRpc<CatalogProduct[]>('get_catalog', {}),
      apiRpc<OutgoingTransfer[]>('get_outgoing_transfers', {}),
    ])
      .then(([sts, cats, cat, out]) => {
        if (!alive) return
        setStores(sts)
        setCategories(cats)
        setCatalog(cat)
        setOutgoing(out)
      })
      .catch(() => {
        /* empty states */
      })
    return () => {
      alive = false
    }
  }, [])

  function storeCode(id: string): string {
    return stores.find((s) => s.id === id)?.code ?? id.toUpperCase()
  }

  function storeName(id: string): string {
    return stores.find((s) => s.id === id)?.name ?? storeCode(id)
  }

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
  const [transferError, setTransferError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)

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
    return catalog.filter(
      (p) =>
        (categoryId === ALL || p.categoryId === categoryId) &&
        (q === '' || p.name.toLowerCase().includes(q)),
    )
  }, [query, categoryId, catalog])

  const current = catalog.find((p) => p.id === selectedId) ?? null
  const colors = current ? [...new Set(current.variants.map((v) => v.color))] : []
  const hasSizes = current ? current.variants.some((v) => v.size !== null) : false
  const sizes =
    current && color
      ? current.variants.filter((v) => v.color === color).map((v) => v.size)
      : []
  const selectedVariant =
    current?.variants.find((v) => v.color === color && v.size === size) ?? null
  const stock = selectedVariant?.inStock ?? 0

  // A choice is only usable when at least one matching variant has stock in this store.
  const colorStocked = (c: string) =>
    current?.variants.some((v) => v.color === c && v.inStock > 0) ?? false
  const sizeStocked = (s: string | null) =>
    current?.variants.some((v) => v.color === color && v.size === s && v.inStock > 0) ?? false

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
        variantId: selectedVariant.id,
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

  async function sendTransfer() {
    if (!toStoreId || items.length === 0) return
    const clientRef = `TR-${Date.now().toString().slice(-6)}`
    setTransferError(null)
    try {
      await apiRpc('transfer_stock', {
        p_to_store_id: toStoreId,
        p_items: items.map((i) => ({ variant_id: i.variantId, quantity: i.qty })),
        p_note: note.trim() || null,
        p_client_ref: clientRef,
      })
      setSentRef(clientRef)
      setView('sent')
    } catch (err) {
      setTransferError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not send the transfer. Please try again.',
      )
    }
  }

  async function confirmCancel() {
    if (!cancelId) return
    try {
      await apiRpc('cancel_transfer', { p_transfer_id: cancelId })
    } catch {
      // Fall through and update locally regardless.
    }
    setOutgoing((prev) =>
      prev.map((t) => (t.id === cancelId ? { ...t, status: 'cancelled' as const } : t)),
    )
    setCancelId(null)
  }

  function startOver() {
    setToStoreId(null)
    setQuery('')
    setTransferError(null)
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
        Pieces move from <strong>{myStore}</strong> to the store you pick below.
      </p>
      <div className="option-row transfer-store-options">
        {stores.filter((s) => s.code !== myStore).map((s) => (
          <motion.button
            type="button"
            key={s.id}
            className={`option-chip transfer-store-chip${toStoreId === s.id ? ' active' : ''}`}
            onClick={() => setToStoreId(s.id)}
            whileTap={{ scale: 0.94 }}
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
        >
          All
        </motion.button>
        {categories.map((c) => (
          <motion.button
            type="button"
            key={c.id}
            className={`chip${categoryId === c.id ? ' active' : ''}`}
            onClick={() => setCategoryId(c.id)}
            whileTap={{ scale: 0.94 }}
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
                              disabled={!colorStocked(c)}
                              whileTap={colorStocked(c) ? { scale: 0.94 } : undefined}
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
                                  disabled={!sizeStocked(s)}
                                  whileTap={sizeStocked(s) ? { scale: 0.94 } : undefined}
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
        {transferError ? (
          <div className="sale-error" role="alert">
            <span>{transferError}</span>
          </div>
        ) : null}
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
