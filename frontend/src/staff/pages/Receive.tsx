import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { Check, ChevronDown, ChevronUp, Inbox } from 'lucide-react'
import { useHeaderTitleValue } from '../headerTitle'

/* ------------------------------------------------------------------ */
/* Placeholder data + notes.                                           */
/*                                                                     */
/* Incoming stock = units in `in_transit` whose last `transferred_out` */
/* movement has to_store_id = currentUser.storeCode. Grouped by the    */
/* sending store + sent batch for display. Receiving all flips every   */
/* unit in the batch to `in_stock` here and logs `transferred_in`.     */
/*                                                                     */
/* TODO (when the API is live):                                        */
/*   Incoming list  → in_transit units inbound to this store, grouped  */
/*     by from_store / sent batch (no transfer table exists).          */
/*   Receive all    → apiRpc('receive_stock', { from_store_id,         */
/*     unit_ids, client_ref }) — logs transferred_in, units → in_stock */
/*     at this store. Idempotent via client_ref for offline retries.   */
/*   Home badge     → count of inbound in_transit units > 0 (the red   */
/*     dot on the Home screen comes from this same query).             */
/* ------------------------------------------------------------------ */

type Tab = 'incoming' | 'received'

interface BatchItem {
  name: string
  detail: string
  qty: number
}

interface IncomingBatch {
  id: string
  fromStoreId: string
  sentAt: string
  note?: string
  items: BatchItem[]
}

interface ReceivedBatch {
  id: string
  fromStoreId: string
  receivedAt: string
  items: BatchItem[]
}

const STORE_CODES: Record<string, string> = {
  b1: 'B1',
  lgf: 'LGF',
  gf: 'GF',
  lca: 'LCA',
}

const STORE_NAMES: Record<string, string> = {
  b1: 'Branch 1',
  lgf: 'Laguna F.',
  gf: 'G. Flores',
  lca: 'L. Caceres',
}

function daysAgoISO(days: number, hour = 10): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(hour, 15, 0, 0)
  return d.toISOString()
}

// TODO: derive from the stock_movement ledger (see header comment).
const INITIAL_INCOMING: IncomingBatch[] = [
  {
    id: 'rcv-5012',
    fromStoreId: 'gf',
    sentAt: daysAgoISO(1, 9),
    note: '2 veils on loan from GF',
    items: [
      { name: 'Veil', detail: 'White / 72"', qty: 1 },
      { name: 'Veil', detail: 'Ivory / 72"', qty: 1 },
    ],
  },
  {
    id: 'rcv-5011',
    fromStoreId: 'b1',
    sentAt: daysAgoISO(2, 14),
    items: [
      { name: 'Plain Barong', detail: 'Black / M', qty: 2 },
      { name: 'Arras Set', detail: 'Silver / Standard', qty: 1 },
    ],
  },
]

const INITIAL_RECEIVED: ReceivedBatch[] = [
  {
    id: 'rcv-5009',
    fromStoreId: 'lgf',
    receivedAt: daysAgoISO(5, 11),
    items: [
      { name: 'Formal Suit', detail: 'Navy / M', qty: 1 },
      { name: 'Trousers', detail: 'Black / 34', qty: 1 },
    ],
  },
]

function storeCode(id: string): string {
  return STORE_CODES[id] ?? id.toUpperCase()
}

function storeName(id: string): string {
  return STORE_NAMES[id] ?? storeCode(id)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function batchCount(batch: { items: BatchItem[] }): number {
  return batch.items.reduce((sum, i) => sum + i.qty, 0)
}

export default function Receive() {
  const [tab, setTab] = useState<Tab>('incoming')
  const [incoming, setIncoming] = useState<IncomingBatch[]>(INITIAL_INCOMING)
  const [received, setReceived] = useState<ReceivedBatch[]>(INITIAL_RECEIVED)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useHeaderTitleValue('Receive Stock', 'Check in pieces arriving from another store.')

  const incomingCount = useMemo(
    () => incoming.reduce((sum, b) => sum + batchCount(b), 0),
    [incoming],
  )

  const confirmed = incoming.find((b) => b.id === confirmId) ?? null

  function receiveBatch() {
    if (!confirmId) return
    const batch = incoming.find((b) => b.id === confirmId)
    if (!batch) return
    // TODO: wire to the backend RPC — idempotent for offline retries.
    //   await apiRpc('receive_stock', {
    //     from_store_id: batch.fromStoreId,
    //     unit_ids: <all units in this batch>,
    //     client_ref: <generated on-device>,
    //   })
    setReceived((prev) => [
      {
        id: batch.id,
        fromStoreId: batch.fromStoreId,
        receivedAt: new Date().toISOString(),
        items: batch.items,
      },
      ...prev,
    ])
    setIncoming((prev) => prev.filter((b) => b.id !== confirmId))
    setExpandedId(null)
    setConfirmId(null)
  }

  /* ------------------------- incoming -------------------------- */

  const incomingBody =
    incoming.length === 0 ? (
      <div className="receive-empty">
        <span className="receive-empty-icon">
          <Inbox size={30} strokeWidth={1.6} />
        </span>
        <p className="receive-empty-title">Nothing incoming</p>
        <p className="receive-empty-sub">
          When another store sends you pieces, they'll appear here to check in.
        </p>
      </div>
    ) : (
      <div className="transfer-list">
        {incoming.map((b) => {
          const isExpanded = expandedId === b.id
          return (
            <div key={b.id} className={`transfer-card${isExpanded ? ' expanded' : ''}`}>
              <button
                type="button"
                className="transfer-row-toggle"
                onClick={() => setExpandedId(isExpanded ? null : b.id)}
                aria-expanded={isExpanded}
              >
                <span className="transfer-store">
                  <span className="transfer-store-name">From {storeCode(b.fromStoreId)}</span>
                  <span className="transfer-store-sub">{storeName(b.fromStoreId)}</span>
                </span>
                <span className="transfer-count">{batchCount(b)} pcs</span>
                <span className="transfer-status in-transit">in transit</span>
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
                      {b.items.map((i) => (
                        <div className="transfer-item-row" key={`${i.name}-${i.detail}`}>
                          <span className="transfer-item-name">{i.name}</span>
                          <span className="transfer-item-detail">
                            {i.detail} · {i.qty} pcs
                          </span>
                        </div>
                      ))}
                      <div className="transfer-meta">
                        <span>Sent {formatDate(b.sentAt)}</span>
                        {b.note && <span className="transfer-meta-note">{b.note}</span>}
                      </div>
                      <button
                        type="button"
                        className="primary-btn transfer-receive-btn"
                        onClick={() => setConfirmId(b.id)}
                      >
                        <Check size={18} />
                        <span>Receive all</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    )

  /* ------------------------- received -------------------------- */

  const receivedBody =
    received.length === 0 ? (
      <p className="empty-note">Nothing received yet.</p>
    ) : (
      <div className="transfer-list">
        {received.map((b) => {
          const isExpanded = expandedId === b.id
          return (
            <div key={b.id} className={`transfer-card${isExpanded ? ' expanded' : ''}`}>
              <button
                type="button"
                className="transfer-row-toggle"
                onClick={() => setExpandedId(isExpanded ? null : b.id)}
                aria-expanded={isExpanded}
              >
                <span className="transfer-store">
                  <span className="transfer-store-name">From {storeCode(b.fromStoreId)}</span>
                  <span className="transfer-store-sub">{storeName(b.fromStoreId)}</span>
                </span>
                <span className="transfer-count">{batchCount(b)} pcs</span>
                <span className="transfer-status received">received</span>
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
                      {b.items.map((i) => (
                        <div className="transfer-item-row" key={`${i.name}-${i.detail}`}>
                          <span className="transfer-item-name">{i.name}</span>
                          <span className="transfer-item-detail">
                            {i.detail} · {i.qty} pcs
                          </span>
                        </div>
                      ))}
                      <div className="transfer-meta">
                        <span>Received {formatDate(b.receivedAt)}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    )

  /* --------------------------- render --------------------------- */

  return (
    <MotionConfig reducedMotion="user">
      <div className="sale-screen">
        <AnimatePresence>
          {confirmed && (
            <motion.div
              className="gate-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Receive stock"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              onClick={() => setConfirmId(null)}
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
                <h1 className="gate-title">Receive this stock?</h1>
                <p className="gate-sub">
                  {batchCount(confirmed)} piece{batchCount(confirmed) > 1 ? 's' : ''} from{' '}
                  {storeName(confirmed.fromStoreId)} are checked into this store.
                </p>
                <div className="modal-actions">
                  <button type="button" className="secondary-btn" onClick={() => setConfirmId(null)}>
                    Not yet
                  </button>
                  <button type="button" className="primary-btn" onClick={receiveBatch}>
                    <Check size={18} />
                    <span>Receive all</span>
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="sale-body">
          <div className="segmented-toggle" role="tablist" aria-label="Receive view">
            <button
              type="button"
              className={`segmented-option${tab === 'incoming' ? ' active' : ''}`}
              onClick={() => setTab('incoming')}
              aria-pressed={tab === 'incoming'}
            >
              Incoming{incomingCount > 0 ? ` (${incomingCount})` : ''}
            </button>
            <button
              type="button"
              className={`segmented-option${tab === 'received' ? ' active' : ''}`}
              onClick={() => setTab('received')}
              aria-pressed={tab === 'received'}
            >
              Received
            </button>
          </div>

          <div className="receive-body">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
              >
                {tab === 'incoming' ? incomingBody : receivedBody}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {tab === 'incoming' && incoming.length > 0 && (
          <div className="sale-footer">
            <button
              type="button"
              className="primary-btn"
              onClick={() => setConfirmId(incoming[0].id)}
            >
              <Check size={18} />
              <span>Receive all incoming</span>
            </button>
            <Link className="secondary-btn" to="/staff">
              Back to Home
            </Link>
          </div>
        )}
      </div>
    </MotionConfig>
  )
}
