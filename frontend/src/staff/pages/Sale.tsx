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
import { apiRpc } from '../../shared/api/client'
import { useAuth } from '../../auth/AuthContext'
import { useHeaderTitleValue } from '../headerTitle'

interface CatalogVariant {
  id: string
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

const PAYMENT_METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'gcash', label: 'GCash', icon: Smartphone },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: Landmark }
]

interface OrderItem {
  key: number
  name: string
  detail: string // e.g. "Black / M" or "MTO"
  qty: number
  price: number // agreed unit price (pesos)
  regular: number
  variantId?: string // ready-made only — used to auto-assign units server-side
  spec?: string // MTO note
}

type Step = 'gate' | 'entry' | 'checkout' | 'done'

function dateStamp(): string {
  return new Date().toISOString().slice(2, 10).replace(/-/g, '')
}

function totalStock(p: CatalogProduct): number {
  return p.variants.reduce((sum, v) => sum + v.inStock, 0)
}

export default function Sale() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const storeCode = user?.storeCode ?? 'STORE'

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
  const [saleError, setSaleError] = useState<string | null>(null)

  // Catalog, categories and staff loaded from the API.
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [staff, setStaff] = useState<string[]>([])

  const [careOf, setCareOf] = useState(staff[0])
  const [orderNo, setOrderNo] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([
      apiRpc<{ id: string; name: string }[]>('get_categories', {}),
      apiRpc<CatalogProduct[]>('get_catalog', {}),
      apiRpc<string[]>('get_staff', {}),
    ])
      .then(([cats, prods, staffList]) => {
        if (!alive) return
        setCategories(cats)
        setProducts(prods)
        setStaff(staffList)
      })
      .catch(() => {
        /* leave empty; pages render empty states */
      })
    return () => {
      alive = false
    }
  }, [])

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
    return products.filter(
      (p) =>
        (categoryId === ALL || p.categoryId === categoryId) &&
        (q === '' || p.name.toLowerCase().includes(q)),
    )
  }, [query, categoryId, products])

  const current = products.find((p) => p.id === selectedId) ?? null
  const colors = current ? [...new Set(current.variants.map((v) => v.color))] : []
  const hasSizes = current ? current.variants.some((v) => v.size !== null) : false
  const sizes = current && color
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
    setAgreedPrice('')
  }

  function pickColor(c: string) {
    setColor(c)
    setSize(current?.variants.find((v) => v.color === c)?.size ?? null)
  }

  function addReadyMade() {
    if (!current || !selectedVariant || stock === 0) return
    const price = pesosToNumber(agreedPrice) || selectedVariant.regularPrice
    const detail = [color, size].filter(Boolean).join(' / ')
    setItems((prev) => [
      ...prev,
      ...Array.from({ length: qty }, (_, index) => ({
        key: Date.now() + index,
        name: current.name,
        detail,
        qty: 1,
        price,
        regular: selectedVariant.regularPrice,
        variantId: selectedVariant.id,
      })),
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

  async function completeSale() {
    if (items.length === 0) return
    const clientRef = `${storeCode}-${dateStamp()}-${String(Math.floor(100 + Math.random() * 900))}`
    setSaleError(null)
    try {
      await apiRpc('log_sale', {
        p_order_type: orderType,
        p_customer_name: customerName.trim() || null,
        p_items: items.map((i) => ({
          variant_id: i.variantId ?? null,
          quantity: i.qty,
          agreed_price: i.price,
          spec_note: i.spec ?? null,
        })),
        p_payment: paid > 0 ? { method, amount: paid, note: note.trim() || null } : null,
        p_care_of: null, // staff-uuid mapping not wired yet; dispatched_by is informational
        p_client_ref: clientRef,
      })
    } catch (err) {
      setSaleError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the sale. Please try again.',
      )
      return
    }
    setOrderNo(clientRef)
    setStep('done')
  }

  function startOver() {
    setStep('gate')
    setOrderType('ready_made')
    setSaleError(null)
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
    setCareOf(staff[0])
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
                      {totalStock(p) > 0 ? `${totalStock(p)} in stock` : 'Out of stock'}
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

                        <div className="step-tag">4 · Agreed Price <em className="per-unit">per unit</em></div>
                        <div className="price-field">
                          <input
                            className="price-input"
                            inputMode="decimal"
                            value={agreedPrice}
                            onChange={(e) => setAgreedPrice(e.target.value)}
                            placeholder="Agreed price per unit"
                          />
                        </div>
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

        <div className="step-tag">3 · Agreed Price <em className="per-unit">per unit</em></div>
        <div className="price-field">
          <input
            className="price-input"
            inputMode="decimal"
            value={mtoPrice}
            onChange={(e) => setMtoPrice(e.target.value)}
            placeholder="Agreed price per unit"
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
    <div className="checkout-body">
      <button type="button" className="checkout-back" onClick={() => setStep('entry')}>
        <ArrowLeft size={15} />
        Back to order
      </button>

      <h2 className="order-section-title">Order</h2>
      {orderList}

      <h2 className="field-label field-label-lg">Payment Method</h2>
      <div className="method-row">
        {PAYMENT_METHODS.map((m) => {
          const Icon = m.icon
          return (
            <motion.button
              type="button"
              key={m.id}
              className={`method-chip${method === m.id ? ' active' : ''}`}
              aria-pressed={method === m.id}
              onClick={() => setMethod(m.id)}
              whileTap={{ scale: 0.94 }}
            >
              <Icon size={16} />
              {m.label}
            </motion.button>
          )
        })}
      </div>

      <label className="field-label field-label-lg" htmlFor="sale-amount">Payment Amount</label>
      <div className="amount-row">
        <input
          id="sale-amount"
          className="price-input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Enter payment amount"
        />
        <button type="button" className="amount-fill-btn" onClick={() => setAmount(String(total))}>
          Full amount
        </button>
      </div>

      {paid > 0 && !paidInFull && (
        <div className="balance-note">
          <span>Balance due later</span>
          <strong>{formatPesoWhole(balance)}</strong>
        </div>
      )}
      {paidInFull && <div className="paid-note">Paid in full</div>}

      <h2 className="optional-heading">Optional Details</h2>

      <label className="field-label field-label-sm" htmlFor="sale-customer">Customer Name</label>
      <input
        id="sale-customer"
        className="text-input"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        placeholder="Name (optional)"
      />

      <span className="field-label field-label-sm">Care of</span>
      <div className="option-row">
        {staff.map((s) => (
          <motion.button
            type="button"
            key={s}
            className={`option-chip${careOf === s ? ' active' : ''}`}
            aria-pressed={careOf === s}
            onClick={() => setCareOf(s)}
            whileTap={{ scale: 0.94 }}
          >
            {s}
          </motion.button>
        ))}
      </div>

      <label className="field-label field-label-sm" htmlFor="sale-note">Note</label>
      <input
        id="sale-note"
        className="text-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder='e.g. "downpayment"'
      />
    </div>
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
          <span>{paid > 0 ? 'Paid' : 'Payment'}</span>
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
        <button type="button" className="primary-btn complete-sale-btn" onClick={completeSale}>
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

        {saleError ? (
          <div className="sale-error" role="alert">
            <span>{saleError}</span>
          </div>
        ) : null}

        {footer}
      </div>
    </MotionConfig>
  )
}
