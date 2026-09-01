import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { Check, ChevronDown, ChevronUp, Inbox } from 'lucide-react'
import { useHeaderTitleValue } from '../headerTitle'
import { dateGroupLabel, dateKey } from '../../shared/utils/dates'
import { apiRpc } from '../../shared/api/client'

// TODO (when the API is live):
//   Incoming list  → in_transit units inbound to this store, grouped
//     by from_store / sent batch (no transfer table exists).
//   Receive all    → apiRpc('receive_stock', { from_store_id,
//     unit_ids, client_ref }) — logs transferred_in, units → in_stock
//     at this store. Idempotent via client_ref for offline retries.
//   Home badge     → count of inbound in_transit units > 0 (the red
//     dot on the Home screen comes from this same query).

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
  const [incoming, setIncoming] = useState<IncomingBatch[]>([])
  const [received, setReceived] = useState<ReceivedBatch[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [stores, setStores] = useState<{ id: string; code: string; name: string }[]>([])

  useEffect(() => {
    let alive = true
    Promise.all([
      apiRpc<{ id: string; code: string; name: string }[]>('get_stores', {}),
      apiRpc<IncomingBatch[]>('get_incoming_transfers', {}),
      apiRpc<ReceivedBatch[]>('get_received_transfers', {}),
    ])
      .then(([sts, inc, rec]) => {
        if (!alive) return
        setStores(sts)
        setIncoming(inc)
        setReceived(rec)
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

  useHeaderTitleValue('Receive Stock', 'Check in pieces arriving from another store.')

  const incomingCount = useMemo(
    () => incoming.reduce((sum, b) => sum + batchCount(b), 0),
    [incoming],
  )

  // Received batches grouped by the date they were checked in, newest first.
  const groupedReceived = useMemo(() => {
    const groups = new Map<string, ReceivedBatch[]>()
    for (const b of received) {
      const key = dateKey(b.receivedAt)
      const arr = groups.get(key) ?? []
      arr.push(b)
      groups.set(key, arr)
    }
    return [...groups.entries()]
  }, [received])

  const confirmed = incoming.find((b) => b.id === confirmId) ?? null

  async function receiveBatch() {
    if (!confirmId) return
    const batch = incoming.find((b) => b.id === confirmId)
    if (!batch) return
    try {
      await apiRpc('receive_stock', { p_from_store_id: batch.fromStoreId, p_note: null })
    } catch {
      // Fall through and update locally regardless.
    }
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
        {groupedReceived.map(([key, batches]) => (
          <section className="date-group" key={key}>
            <h2 className="date-group-label">{dateGroupLabel(batches[0].receivedAt)}</h2>
            {batches.map((b) => {
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
          </section>
        ))}
      </div>
    )

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
            {(
              [
                { value: 'incoming', label: `Incoming${incomingCount > 0 ? ` (${incomingCount})` : ''}` },
                { value: 'received', label: 'Received' },
              ] as const
            ).map((t) => {
              const active = tab === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  className={`segmented-option${active ? ' active' : ''}`}
                  onClick={() => setTab(t.value)}
                  aria-pressed={active}
                >
                  {active && (
                    <motion.span
                      layoutId="receive-view-pill"
                      className="segmented-pill"
                      transition={{ duration: 0.18, ease: [0.65, 0, 0.35, 1] }}
                    />
                  )}
                  <span className="segmented-label">{t.label}</span>
                </button>
              )
            })}
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
      </motion.div>
    </MotionConfig>
  )
}
