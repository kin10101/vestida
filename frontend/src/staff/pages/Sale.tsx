import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import {
  ArrowLeft,
  Banknote,
  Check,
  Landmark,
  Minus,
  Plus,
  Scissors,
  Search,
  Shirt,
  Smartphone,
  X,
} from 'lucide-react'
import type { OrderType, PaymentMethod } from '../../shared/types/sale'
import { formatPesoWhole, pesosToNumber } from '../../shared/utils/currency'
import { useHeaderTitleValue } from '../headerTitle'

/* ------------------------------------------------------------------ */
/* Placeholder catalog + staff list.                                   */
/* TODO: load categories, products, variants and per-variant stock     */
/* from the API (COUNT(inventory_unit) WHERE status = 'in_stock'),     */
/* and call apiRpc('log_sale', ...) on Complete Sale.                  */
/* ------------------------------------------------------------------ */

interface CatalogVariant {
  color: string
  size: string | null
  regularPrice: number
  inStock: number
}

interface CatalogProduct {
  id: string
  categoryId: string
  name: string
  variants: CatalogVariant[]
}

const ALL = 'all'

const CATEGORIES: { id: string; name: string }[] = [
  { id: 'barong', name: 'Barong' },
  { id: 'suit', name: 'Suit' },
  { id: 'pants', name: 'Pants' },
  { id: 'acc', name: 'Accessories' },
]

const PRODUCTS: CatalogProduct[] = [
  {
    id: 'plain-barong',
    categoryId: 'barong',
    name: 'Plain Barong',
    variants: [
      { color: 'Black', size: 'M', regularPrice: 2500, inStock: 1 },
      { color: 'Black', size: 'L', regularPrice: 2500, inStock: 2 },
      { color: 'White', size: 'S', regularPrice: 2500, inStock: 3 },
      { color: 'White', size: 'M', regularPrice: 2500, inStock: 1 },
    ],
  },
  {
    id: 'barong-sports',
    categoryId: 'barong',
    name: 'Barong Sports Collar',
    variants: [
      { color: 'Black', size: 'M', regularPrice: 2800, inStock: 2 },
      { color: 'Black', size: 'L', regularPrice: 2800, inStock: 1 },
    ],
  },
  {
    id: 'formal-suit',
    categoryId: 'suit',
    name: 'Formal Suit',
    variants: [
      { color: 'Black', size: 'L', regularPrice: 5500, inStock: 1 },
      { color: 'Navy', size: 'M', regularPrice: 5500, inStock: 2 },
    ],
  },
  {
    id: 'trousers',
    categoryId: 'pants',
    name: 'Trousers',
    variants: [
      { color: 'Black', size: '32', regularPrice: 1000, inStock: 4 },
      { color: 'Black', size: '34', regularPrice: 1000, inStock: 2 },
      { color: 'Blue', size: '30', regularPrice: 1000, inStock: 1 },
    ],
  },
  {
    id: 'arras-set',
    categoryId: 'acc',
    name: 'Arras Set',
    variants: [
      { color: 'Silver', size: null, regularPrice: 650, inStock: 2 },
      { color: 'Gold', size: null, regularPrice: 650, inStock: 1 },
    ],
  },
]

const STAFF = ['Gina', 'Cel', 'Ian']

const PAYMENT_METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'gcash', label: 'GCash', icon: Smartphone },
  { id: 'bank', label: 'Bank Transfer', icon: Landmark },
]

interface OrderItem {
  key: number
  name: string
  detail: string // e.g. "Black / M" or "MTO"
  qty: number
  price: number // agreed unit price
  regular: number
  spec?: string // MTO note
}

type Step = 'gate' | 'entry' | 'checkout' | 'done'

function dateStamp(): string {
  return new Date().toISOString().slice(2, 10).replace(/-/g, '')
}

export default function Sale() {
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('gate')
  const [orderType, setOrderType] = useState<OrderType>('ready_made')

  // Ready-made selection
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState(ALL)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [color, setColor] = useState<string | null>(null)
  const [size, setSize] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [agreedPrice, setAgreedPrice] = useState('')

  // Made-to-order entry
  const [mtoStyle, setMtoStyle] = useState('')
  const [mtoSpec, setMtoSpec] = useState('')
  const [mtoPrice, setMtoPrice] = useState('')

  // Order + checkout
  const [items, setItems] = useState<OrderItem[]>([])
  const [customerName, setCustomerName] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [careOf, setCareOf] = useState(STAFF[0])
  const [orderNo, setOrderNo] = useState('')

  // Focus the opener of whichever card just expanded.
  const headRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    const head = selectedId ? headRefs.current[selectedId] : null
    if (head) {
      head.focus({ preventScroll: true })
    }
  }, [selectedId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PRODUCTS.filter(
      (p) =>
        (categoryId === ALL || p.categoryId === categoryId) &&
        (q === '' || p.name.toLowerCase().includes(q)),
    )
  }, [query, categoryId])

  const current = PRODUCTS.find((p) => p.id === selectedId) ?? null
  const colors = current ? [...new Set(current.variants.map((v) => v.color))] : []
  const hasSizes = current ? current.variants.some((v) => v.size !== null) : false
  const sizes = current && color
    ? current.variants.filter((v) => v.color === color).map((v) => v.size)
    : []
  const selectedVariant =
    current?.variants.find((v) => v.color === color && v.size === size) ?? null
  const stock = selectedVariant?.inStock ?? 0

  const total = items.reduce((sum, i) => sum + i.qty * i.price, 0)
  const paid = pesosToNumber(amount)
  const balance = Math.max(total - paid, 0)
  const paidInFull = total > 0 && paid >= total
  const orderTypeLabel = orderType === 'made_to_order' ? 'Made-to-Order' : 'Ready-made'
  const methodLabel = PAYMENT_METHODS.find((m) => m.id === method)?.label ?? 'Cash'

  const stepTitle =
    step === 'gate' ? 'Log a Sale'
    : step === 'checkout' ? 'Checkout'
    : step === 'done' ? 'Sale Complete'
    : orderType === 'made_to_order' ? 'Made-to-Order Sale'
    : 'Ready-made Sale'
  const stepSubtitle =
    step === 'gate' ? 'Choose how this order starts.'
    : step === 'checkout' ? 'Review the order, then take payment.'
    : step === 'done' ? ''
    : orderType === 'made_to_order' ? 'Describe the piece and agree on a price.'
    : 'Find the piece, then add it to the order.'
  useHeaderTitleValue(stepTitle, stepSubtitle)

  function startEntry(type: OrderType) {
    setOrderType(type)
    setStep('entry')
  }

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
    setAgreedPrice(String(first?.regularPrice ?? ''))
  }

  function pickColor(c: string) {
    setColor(c)
    setSize(current?.variants.find((v) => v.color === c)?.size ?? null)
  }

  function addReadyMade() {
    if (!current || !selectedVariant || stock === 0) return
    setItems((prev) => [
      ...prev,
      {
        key: Date.now(),
        name: current.name,
        detail: [color, size].filter(Boolean).join(' / '),
        qty,
        price: pesosToNumber(agreedPrice) || selectedVariant.regularPrice,
        regular: selectedVariant.regularPrice,
      },
    ])
    setSelectedId(null)
    setQuery('')
  }

  function addMto() {
    const price = pesosToNumber(mtoPrice)
    if (!mtoStyle.trim() || price <= 0) return
    setItems((prev) => [
      ...prev,
      {
        key: Date.now(),
        name: mtoStyle.trim(),
        detail: 'MTO',
        qty: 1,
        price,
        regular: price,
        spec: mtoSpec.trim() || undefined,
      },
    ])
    setMtoStyle('')
    setMtoSpec('')
    setMtoPrice('')
  }

  function removeItem(key: number) {
    const next = items.filter((i) => i.key !== key)
    setItems(next)
    if (next.length === 0 && step === 'checkout') {
      setStep('entry')
    }
  }

  function completeSale() {
    // TODO: wire to the backend RPC —
    //   await apiRpc('log_sale', {
    //     order_type: orderType,
    //     customer_name: customerName,
    //     items,
    //     payment: { method, amount: paid, note },
    //     care_of: careOf,
    //   })
    setOrderNo(`LGA-${dateStamp()}-${String(Math.floor(100 + Math.random() * 900))}`)
    setStep('done')
  }

  function startOver() {
    setStep('gate')
    setOrderType('ready_made')
    setQuery('')
    setCategoryId(ALL)
    setSelectedId(null)
    setColor(null)
    setSize(null)
    setQty(1)
    setAgreedPrice('')
    setMtoStyle('')
    setMtoSpec('')
    setMtoPrice('')
    setItems([])
    setCustomerName('')
    setMethod('cash')
    setAmount('')
    setNote('')
    setCareOf(STAFF[0])
    setOrderNo('')
  }

  const orderList = (
    <div className="order-card">
      {items.map((i) => (
        <div key={i.key} className="order-item">
          <div className="order-item-main">
            <div className="order-item-name">{i.name}</div>
            <div className="order-item-sub">
              {i.detail} · {i.qty} × {formatPesoWhole(i.price)}
            </div>
            {i.spec && <div className="order-item-spec">{i.spec}</div>}
          </div>
          <div className="order-item-side">
            <span className="order-item-amount">{formatPesoWhole(i.qty * i.price)}</span>
            {step !== 'done' && (
              <button
                type="button"
                className="order-remove"
                aria-label={`Remove ${i.name}`}
                onClick={() => removeItem(i.key)}
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )

  const currentOrderSection =
    items.length > 0 ? (
      <>
        <h2 className="order-section-title">
          Current Order · {items.length} item{items.length > 1 ? 's' : ''}
        </h2>
        {orderList}
      </>
    ) : null

  const readyMadeEntry = (
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
                  <span className="product-head-text">
                    <span className="product-name">{p.name}</span>
                    <span className="product-price">
                      from {formatPesoWhole(Math.min(...p.variants.map((v) => v.regularPrice)))}
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
                            <button
                              type="button"
                              key={c}
                              className={`option-chip${color === c ? ' active' : ''}`}
                              onClick={() => pickColor(c)}
                            >
                              {c}
                            </button>
                          ))}
                        </div>

                        {hasSizes && (
                          <>
                            <div className="step-tag">2 · Size</div>
                            <div className="option-row">
                              {sizes.map((s) => (
                                <button
                                  type="button"
                                  key={s ?? 'one-size'}
                                  className={`option-chip${size === s ? ' active' : ''}`}
                                  onClick={() => setSize(s)}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          </>
                        )}

                        <div className="stock-note">
                          <strong>{stock}</strong> in stock at this store
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

                        <div className="step-tag">4 · Agreed Price</div>
                        <div className="price-field">
                          <span>₱</span>
                          <input
                            className="price-input"
                            inputMode="decimal"
                            value={agreedPrice}
                            onChange={(e) => setAgreedPrice(e.target.value)}
                            placeholder="Agreed price"
                          />
                        </div>
                        {selectedVariant && (
                          <p className="regular-hint">
                            Regular: {formatPesoWhole(selectedVariant.regularPrice)}
                          </p>
                        )}

                        <button
                          type="button"
                          className="primary-btn panel-action"
                          disabled={stock === 0}
                          onClick={addReadyMade}
                        >
                          {stock === 0 ? 'Out of stock' : 'Add to Order'}
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

      {currentOrderSection}
    </>
  )

  const mtoEntry = (
    <>
      <div className="variant-panel">
        <div className="step-tag">1 · Style / Item</div>
        <input
          className="text-input"
          value={mtoStyle}
          onChange={(e) => setMtoStyle(e.target.value)}
          placeholder='e.g. "Mestiza Top — Cazar style"'
        />

        <div className="step-tag">2 · Spec Note</div>
        <textarea
          className="text-input textarea"
          value={mtoSpec}
          onChange={(e) => setMtoSpec(e.target.value)}
          placeholder="Fabric, color, measurements..."
        />

        <div className="step-tag">3 · Agreed Price</div>
        <div className="price-field">
          <span>₱</span>
          <input
            className="price-input"
            inputMode="decimal"
            value={mtoPrice}
            onChange={(e) => setMtoPrice(e.target.value)}
            placeholder="Total price"
          />
        </div>

        <button
          type="button"
          className="primary-btn panel-action"
          disabled={!mtoStyle.trim() || pesosToNumber(mtoPrice) <= 0}
          onClick={addMto}
        >
          Add to Order
        </button>
      </div>

      {currentOrderSection}
    </>
  )

  const checkoutBody = (
    <>
      <button type="button" className="checkout-back" onClick={() => setStep('entry')}>
        <ArrowLeft size={15} />
        Back to order
      </button>

      <h2 className="order-section-title">Order Summary</h2>
      {orderList}
      <div className="summary-total-row">
        <span>Total</span>
        <span className="summary-total-value">{formatPesoWhole(total)}</span>
      </div>

      <label className="field-label" htmlFor="sale-customer">Customer Name</label>
      <input
        id="sale-customer"
        className="text-input"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        placeholder="Name (optional)"
      />

      <span className="field-label">Payment Method</span>
      <div className="method-row">
        {PAYMENT_METHODS.map((m) => {
          const Icon = m.icon
          return (
            <button
              type="button"
              key={m.id}
              className={`method-chip${method === m.id ? ' active' : ''}`}
              onClick={() => setMethod(m.id)}
            >
              <Icon size={16} />
              {m.label}
            </button>
          )
        })}
      </div>

      <label className="field-label" htmlFor="sale-amount">Amount Received</label>
      <div className="amount-row">
        <span className="amount-peso">₱</span>
        <input
          id="sale-amount"
          className="price-input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount received"
        />
        <button type="button" className="text-btn" onClick={() => setAmount(String(total))}>
          Full amount
        </button>
      </div>

      <input
        className="text-input checkout-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder='Note (e.g. "downpayment")'
      />

      {paid > 0 && !paidInFull && (
        <div className="balance-note">
          <span>Balance due later</span>
          <strong>{formatPesoWhole(balance)}</strong>
        </div>
      )}
      {paidInFull && <div className="paid-note">Paid in full</div>}

      <span className="field-label">Care of</span>
      <div className="option-row">
        {STAFF.map((s) => (
          <button
            type="button"
            key={s}
            className={`option-chip${careOf === s ? ' active' : ''}`}
            onClick={() => setCareOf(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </>
  )

  const doneBody = (
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
        Order {orderNo} · {orderTypeLabel}
      </p>

      {orderList}

      <div className="success-summary">
        <div className="summary-row">
          <span>Total</span>
          <span>{formatPesoWhole(total)}</span>
        </div>
        <div className="summary-row">
          <span>{paid > 0 ? 'Paid' : 'Amount received'}</span>
          <span>{formatPesoWhole(paid)}</span>
        </div>
        <div className="summary-row">
          <span>{paidInFull ? 'Balance' : 'Balance due'}</span>
          <span>{paidInFull ? 'Paid in full' : formatPesoWhole(balance)}</span>
        </div>
        <div className="summary-row">
          <span>Method</span>
          <span>{methodLabel}</span>
        </div>
        {customerName && (
          <div className="summary-row">
            <span>Customer</span>
            <span>{customerName}</span>
          </div>
        )}
        <div className="summary-row">
          <span>Care of</span>
          <span>{careOf}</span>
        </div>
      </div>

      <button type="button" className="primary-btn" onClick={startOver}>
        Log Another Sale
      </button>
      <Link className="secondary-btn" to="/staff">
        Back to Home
      </Link>
    </div>
  )

  const footer =
    step === 'entry' && items.length > 0 ? (
      <motion.div
        className="sale-footer"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <div className="footer-total">
          <span className="footer-total-label">
            {items.length} item{items.length > 1 ? 's' : ''}
          </span>
          <span className="footer-total-value">{formatPesoWhole(total)}</span>
        </div>
        <button type="button" className="primary-btn" onClick={() => setStep('checkout')}>
          Proceed to Checkout
        </button>
      </motion.div>
    ) : step === 'checkout' ? (
      <motion.div
        className="sale-footer"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <div className="footer-total">
          <span className="footer-total-label">Total</span>
          <span className="footer-total-value">{formatPesoWhole(total)}</span>
        </div>
        {paid > 0 && !paidInFull && (
          <div className="footer-balance">
            <span>Balance due</span>
            <span>{formatPesoWhole(balance)}</span>
          </div>
        )}
        <button type="button" className="primary-btn" onClick={completeSale}>
          Complete Sale
        </button>
      </motion.div>
    ) : null

  return (
    <MotionConfig reducedMotion="user">
      <div className="sale-screen">
        <AnimatePresence>
          {step === 'gate' && (
            <motion.div
              className="gate-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Choose order type"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              <motion.div
                className="gate-card"
                initial={{ opacity: 0, scale: 0.94, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 10 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ transformOrigin: '50% 100%' }}
              >
                <h1 className="gate-title">Log a Sale</h1>
                <p className="gate-sub">Choose how this order starts.</p>

                <button type="button" className="gate-option" onClick={() => startEntry('ready_made')}>
                  <span className="gate-option-icon">
                    <Shirt size={24} strokeWidth={1.6} />
                  </span>
                  <span className="gate-option-label">Ready-made</span>
                  <span className="gate-option-sub">Sell pieces already in stock</span>
                </button>
                <button type="button" className="gate-option" onClick={() => startEntry('made_to_order')}>
                  <span className="gate-option-icon">
                    <Scissors size={24} strokeWidth={1.6} />
                  </span>
                  <span className="gate-option-label">Made-to-Order</span>
                  <span className="gate-option-sub">Custom piece, made after the order</span>
                </button>

                <button type="button" className="gate-cancel" onClick={() => navigate('/staff')}>
                  Cancel
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="sale-body">
          <AnimatePresence mode="wait" initial={false}>
            {step === 'entry' && (
              <motion.div
                key="entry"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
              >
                {orderType === 'ready_made' ? readyMadeEntry : mtoEntry}
              </motion.div>
            )}
            {step === 'checkout' && (
              <motion.div
                key="checkout"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
              >
                {checkoutBody}
              </motion.div>
            )}
            {step === 'done' && (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
              >
                {doneBody}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {footer}
      </div>
    </MotionConfig>
  )
}
