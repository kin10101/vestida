import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRightLeft, ChevronDown, History, MoreHorizontal, Plus, SlidersHorizontal } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import type { InventoryUnit, Product, ProductVariant, UnitStatus } from '../data'
import { Drawer, EmptyState, Field, PageHeader, StatusBadge, Toast } from '../ui'

type StockScope = 'all' | 'in_stock' | 'out'

interface VariantRow {
  variant: ProductVariant
  product: Product
  onHand: number
  scopeUnits: InventoryUnit[]
  perStore: Array<{ storeId: string; count: number }>
}

interface ProductGroup {
  product: Product
  categoryName: string
  rows: VariantRow[]
  totalOnHand: number
  outCount: number
  storeCount: number
}

const KIND_LABELS: Record<string, string> = {
  received: 'Received',
  transferred_out: 'Transferred out',
  transferred_in: 'Transferred in',
  sold: 'Sold',
  adjustment: 'Adjusted',
}

const fmtDateTime = (value: string) => {
  const date = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? new Date(value) : new Date(value.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function Inventory() {
  const navigate = useNavigate()
  const { state, adjustInventoryUnit, transferStock } = useAdminData()
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StockScope>('all')
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [menu, setMenu] = useState<{ variantId: string; x: number; y: number } | null>(null)

  // Variant action states.
  const [adjustVariantId, setAdjustVariantId] = useState<string | null>(null)
  const [unitModal, setUnitModal] = useState<InventoryUnit | null>(null)
  const [unitDraft, setUnitDraft] = useState<{ status: UnitStatus; note: string }>({ status: 'in_stock', note: '' })
  const [transferVariantId, setTransferVariantId] = useState<string | null>(null)
  const [transferDraft, setTransferDraft] = useState({ fromStoreId: '', toStoreId: '', qty: 1, note: '' })
  const [historyVariantId, setHistoryVariantId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = window.setTimeout(() => setToast(null), 3400)
    return () => window.clearTimeout(timer)
  }, [toast])

  const productById = useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products])
  const variantById = useMemo(() => new Map(state.productVariants.map((v) => [v.id, v])), [state.productVariants])
  const categoryById = useMemo(() => new Map(state.categories.map((c) => [c.id, c])), [state.categories])
  const storeById = useMemo(() => new Map(state.stores.map((s) => [s.id, s])), [state.stores])

  const allStores = storeFilter === 'all'
  const searchTerm = search.trim().toLowerCase()
  const searchActive = searchTerm.length > 0

  const storeName = (id: string | null | undefined) => (id ? (storeById.get(id)?.name ?? 'Unknown store') : '')
  const storeCode = (id: string | null | undefined) => (id ? (storeById.get(id)?.code ?? '?') : '?')

  const variantLabel = (variantId: string) => {
    const variant = variantById.get(variantId)
    if (!variant) {
      return 'this variation'
    }
    const product = productById.get(variant.productId)
    return `${product?.name ?? 'Product'} · ${variant.color} ${variant.size}`
  }

  // Every variant that has at least one stock record in the current store scope.
  // "On hand" = count of in_stock units. A variant with records but 0 on hand is
  // kept (shown as Out of stock); variants with no records at all are hidden.
  const scopeRows = useMemo<VariantRow[]>(() => {
    const unitsByVariant = new Map<string, InventoryUnit[]>()
    for (const unit of state.inventoryUnits) {
      if (!allStores && unit.storeId !== storeFilter) {
        continue
      }
      const list = unitsByVariant.get(unit.variantId) ?? []
      list.push(unit)
      unitsByVariant.set(unit.variantId, list)
    }

    const out: VariantRow[] = []
    for (const [variantId, units] of unitsByVariant) {
      const variant = variantById.get(variantId)
      const product = variant ? productById.get(variant.productId) : undefined
      if (!variant || !product) {
        continue
      }
      const onHand = units.filter((u) => u.status === 'in_stock').length
      const perMap = new Map<string, number>()
      for (const u of units) {
        if (u.status === 'in_stock') {
          perMap.set(u.storeId, (perMap.get(u.storeId) ?? 0) + 1)
        }
      }
      out.push({
        variant,
        product,
        onHand,
        scopeUnits: units,
        perStore: [...perMap.entries()].map(([storeId, count]) => ({ storeId, count })),
      })
    }
    return out
  }, [state.inventoryUnits, variantById, productById, allStores, storeFilter])

  // Apply the status + product/SKU/color/size search filters.
  const filteredRows = useMemo(
    () =>
      scopeRows.filter((row) => {
        if (statusFilter === 'in_stock' && row.onHand === 0) {
          return false
        }
        if (statusFilter === 'out' && row.onHand > 0) {
          return false
        }
        if (searchActive) {
          const { sku, color, size } = row.variant
          const haystack = `${row.product.name} ${sku} ${color} ${size}`.toLowerCase()
          if (!haystack.includes(searchTerm)) {
            return false
          }
        }
        return true
      }),
    [scopeRows, statusFilter, searchActive, searchTerm],
  )

  // Group rows by product; only products with ≥1 matching stocked variation show.
  const groups = useMemo<ProductGroup[]>(() => {
    const rowsByProduct = new Map<string, VariantRow[]>()
    for (const row of filteredRows) {
      const list = rowsByProduct.get(row.product.id) ?? []
      list.push(row)
      rowsByProduct.set(row.product.id, list)
    }

    const out: ProductGroup[] = []
    for (const product of state.products) {
      const rows = rowsByProduct.get(product.id)
      if (!rows) {
        continue
      }
      const totalOnHand = rows.reduce((sum, row) => sum + row.onHand, 0)
      const outCount = rows.filter((row) => row.onHand === 0).length
      const storeSet = new Set<string>()
      for (const row of rows) {
        for (const loc of row.perStore) {
          storeSet.add(loc.storeId)
        }
      }
      out.push({
        product,
        categoryName: categoryById.get(product.categoryId)?.name ?? 'Unassigned',
        rows,
        totalOnHand,
        outCount,
        storeCount: storeSet.size,
      })
    }
    return out
  }, [filteredRows, state.products, categoryById])

  const isExpanded = (productId: string) => searchActive || expandedIds.includes(productId)

  const toggleProduct = (productId: string) => {
    if (searchActive) {
      return
    }
    setExpandedIds((previous) => (previous.includes(productId) ? previous.filter((id) => id !== productId) : [...previous, productId]))
  }

  const openMenu = (event: MouseEvent<HTMLButtonElement>, variantId: string) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({ variantId, x: rect.right, y: rect.bottom })
  }

  const menuLeft = menu ? Math.max(8, Math.min(menu.x, window.innerWidth - 196)) : 0
  const menuTop = menu ? menu.y + 8 : 0

  const openAdjust = (variantId: string) => {
    setMenu(null)
    setAdjustVariantId(variantId)
  }

  const openTransfer = (variantId: string) => {
    const byStore = new Map<string, number>()
    for (const u of state.inventoryUnits) {
      if (u.variantId === variantId && u.status === 'in_stock') {
        byStore.set(u.storeId, (byStore.get(u.storeId) ?? 0) + 1)
      }
    }
    const defaultFrom = !allStores && byStore.has(storeFilter) ? storeFilter : ([...byStore.entries()].find(([, n]) => n > 0)?.[0] ?? '')
    setMenu(null)
    setTransferVariantId(variantId)
    setTransferDraft({
      fromStoreId: defaultFrom,
      toStoreId: '',
      qty: byStore.get(defaultFrom) ?? 1,
      note: '',
    })
  }

  const openHistory = (variantId: string) => {
    setMenu(null)
    setHistoryVariantId(variantId)
  }

  // --- Single-unit adjust (hidden behind the variant ••• menu) -------------
  const adjustUnits = useMemo(() => {
    if (!adjustVariantId) {
      return []
    }
    return state.inventoryUnits
      .filter((u) => u.variantId === adjustVariantId && (allStores || u.storeId === storeFilter))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  }, [adjustVariantId, state.inventoryUnits, allStores, storeFilter])

  const openUnitAdjust = (unit: InventoryUnit) => {
    setUnitDraft({ status: unit.status, note: '' })
    setUnitModal(unit)
  }

  const confirmUnitAdjust = () => {
    if (!unitModal) {
      return
    }
    const label = unitDraft.status.replace('_', ' ')
    adjustInventoryUnit(unitModal.id, unitDraft.status, unitDraft.note, 'Admin')
    setToast(`Adjusted ${unitModal.unitCode || 'stock record'} to ${label}`)
    setUnitModal(null)
  }

  // --- Transfer ------------------------------------------------------------
  const transferStores = useMemo(() => {
    if (!transferVariantId) {
      return []
    }
    const byStore = new Map<string, number>()
    for (const u of state.inventoryUnits) {
      if (u.variantId === transferVariantId && u.status === 'in_stock') {
        byStore.set(u.storeId, (byStore.get(u.storeId) ?? 0) + 1)
      }
    }
    return [...byStore.entries()]
      .filter(([, n]) => n > 0)
      .map(([storeId, count]) => ({ storeId, count }))
  }, [transferVariantId, state.inventoryUnits])

  const transferToOptions = state.stores.filter((s) => !s.isDeleted && s.id !== transferDraft.fromStoreId)

  const changeTransferFrom = (storeId: string) => {
    const available = transferStores.find((s) => s.storeId === storeId)?.count ?? 1
    setTransferDraft((prev) => ({
      ...prev,
      fromStoreId: storeId,
      qty: available,
      toStoreId: prev.toStoreId === storeId ? '' : prev.toStoreId,
    }))
  }

  const confirmTransfer = () => {
    if (!transferVariantId || !transferDraft.fromStoreId || !transferDraft.toStoreId || transferDraft.fromStoreId === transferDraft.toStoreId) {
      return
    }
    const available = transferStores.find((s) => s.storeId === transferDraft.fromStoreId)?.count ?? 0
    const qty = Math.min(Math.max(1, Math.floor(transferDraft.qty)), available)
    if (qty < 1) {
      return
    }
    transferStock({
      fromStoreId: transferDraft.fromStoreId,
      toStoreId: transferDraft.toStoreId,
      items: [{ variantId: transferVariantId, quantity: qty }],
      note: transferDraft.note,
    })
    const toName = storeName(transferDraft.toStoreId)
    setToast(`Transferred ${qty} unit${qty === 1 ? '' : 's'} to ${toName}`)
    setTransferVariantId(null)
  }

  // --- Movement history ----------------------------------------------------
  const historyMoves = useMemo(() => {
    if (!historyVariantId) {
      return []
    }
    const unitIds = new Set(state.inventoryUnits.filter((u) => u.variantId === historyVariantId).map((u) => u.id))
    return state.stockMovements
      .filter((m) => unitIds.has(m.unitId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [historyVariantId, state.inventoryUnits, state.stockMovements])

  const movementRoute = (fromId: string | null, toId: string | null) => {
    const from = fromId ? storeName(fromId) : ''
    const to = toId ? storeName(toId) : ''
    if (from && to) {
      return `${from} → ${to}`
    }
    return to || from
  }

  const unitCode = (unit: InventoryUnit, index: number) => {
    const variant = variantById.get(unit.variantId)
    return unit.unitCode || `${variant?.sku ?? 'UNIT'}#${index + 1}`
  }

  return (
    <div className="admin-page inventory-page">
      <PageHeader title="Inventory" subtitle="Track product variations and stock across each boutique." />

      <div className="manager-toolbar inventory-toolbar">
        <div className="search-box inventory-search">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product, color or SKU"
            aria-label="Search inventory by product, color or SKU"
          />
        </div>
        <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="admin-select" aria-label="Filter by store">
          <option value="all">All stores</option>
          {state.stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.isDeleted ? `Deleted (${store.name})` : store.name}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StockScope)} className="admin-select" aria-label="Filter by stock status">
          <option value="all">All statuses</option>
          <option value="in_stock">In stock</option>
          <option value="out">Out of stock</option>
        </select>
        <button type="button" className="primary-button inventory-add" onClick={() => navigate('/admin/products')} aria-label="Add stock on the Products page">
          <Plus size={16} />
          Add stock
        </button>
      </div>

      <section className="admin-panel inventory-overview" aria-label="Catalog stock by product">
        <div className="inventory-note">
          {groups.length > 0 ? (
            <>
              <strong>{groups.length}</strong> product{groups.length === 1 ? '' : 's'} ·{' '}
              <strong>{filteredRows.length}</strong> stocked variation{filteredRows.length === 1 ? '' : 's'} ·{' '}
              <strong>{groups.reduce((sum, g) => sum + g.totalOnHand, 0)}</strong> on hand
              {!allStores && state.stores.length ? ` at ${storeName(storeFilter)}` : ''}
            </>
          ) : (
            'Variations with no stock records stay hidden here — add stock from the Products page.'
          )}
        </div>

        {groups.length > 0 ? (
          <div className="inventory-accordion">
            {groups.map((group) => {
              const expanded = isExpanded(group.product.id)
              return (
                <div key={group.product.id} className={`inventory-product ${expanded ? 'expanded' : ''}`}>
                  <button
                    type="button"
                    className="inventory-product-row"
                    onClick={() => toggleProduct(group.product.id)}
                    aria-expanded={expanded}
                    aria-controls={`inventory-rows-${group.product.id}`}
                  >
                    <span className="inv-product-main">
                      <strong>{group.product.name}</strong>
                      <small>
                        {group.categoryName} · {group.rows.length} variation{group.rows.length === 1 ? '' : 's'}
                        {allStores ? ` · ${group.storeCount} store${group.storeCount === 1 ? '' : 's'}` : ''}
                      </small>
                    </span>
                    <span className="inv-product-stats">
                      {group.outCount > 0 ? <span className="inv-outcount">{group.outCount} out of stock</span> : null}
                      <span className="inv-onhand">
                        <strong>{group.totalOnHand}</strong>
                        <small>On hand</small>
                      </span>
                    </span>
                    <ChevronDown className="inv-chevron" size={18} aria-hidden="true" />
                  </button>

                  {expanded ? (
                    <div id={`inventory-rows-${group.product.id}`} className="inventory-table-wrap">
                      <table className="inventory-table">
                        <thead>
                          <tr>
                            <th className="col-sku">SKU</th>
                            <th className="col-color">Color</th>
                            <th className="col-size">Size</th>
                            {allStores ? <th className="col-location">Location</th> : null}
                            <th className="col-qty">On hand</th>
                            <th className="col-status">Status</th>
                            <th className="col-actions"><span className="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row) => (
                            <tr key={row.variant.id} className={row.onHand === 0 ? 'out' : ''}>
                              <td className="col-sku inv-sku">{row.variant.sku || '—'}</td>
                              <td className="col-color">{row.variant.color}</td>
                              <td className="col-size">{row.variant.size}</td>
                              {allStores ? (
                                <td className="col-location">
                                  {row.perStore.length > 0 ? (
                                    <span className="inv-loc-list">
                                      {row.perStore.map((loc) => (
                                        <span key={loc.storeId} className="inv-loc-chip" title={storeName(loc.storeId)}>
                                          {storeCode(loc.storeId)} <b>{loc.count}</b>
                                        </span>
                                      ))}
                                    </span>
                                  ) : (
                                    <span className="inv-loc-empty">—</span>
                                  )}
                                </td>
                              ) : null}
                              <td className="col-qty">
                                <span className="inv-qty">{row.onHand}</span>
                              </td>
                              <td className="col-status">
                                <StatusBadge label={row.onHand > 0 ? 'In stock' : 'Out of stock'} tone={row.onHand > 0 ? 'success' : 'neutral'} />
                              </td>
                              <td className="col-actions">
                                <button
                                  type="button"
                                  className="icon-button plain inv-kebab"
                                  onClick={(event) => openMenu(event, row.variant.id)}
                                  aria-label={`Actions for ${row.variant.sku || variantLabel(row.variant.id)}`}
                                  aria-haspopup="menu"
                                >
                                  <MoreHorizontal size={18} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            title={searchActive || statusFilter !== 'all' ? 'No matching inventory' : 'No inventory yet'}
            description={
              searchActive || statusFilter !== 'all'
                ? 'Try another search, status, or store to see stock.'
                : 'Add stock from the Products page and it will appear here, grouped by product.'
            }
            action={
              <button type="button" className="primary-button" onClick={() => navigate('/admin/products')}>
                <Plus size={16} />
                Add stock
              </button>
            }
          />
        )}
      </section>

      {menu ? (
        <>
          <div className="kebab-backdrop" onClick={() => setMenu(null)} aria-hidden="true" />
          <div className="kebab-menu" style={{ left: menuLeft, top: menuTop }} role="menu" aria-label="Variant actions">
            <button type="button" role="menuitem" onClick={() => openAdjust(menu.variantId)}>
              <SlidersHorizontal size={16} />
              Adjust stock
            </button>
            <button type="button" role="menuitem" onClick={() => openTransfer(menu.variantId)}>
              <ArrowRightLeft size={16} />
              Transfer
            </button>
            <button type="button" role="menuitem" onClick={() => openHistory(menu.variantId)}>
              <History size={16} />
              Movement history
            </button>
          </div>
        </>
      ) : null}

      {/* Adjust stock — lists the variation's stock records in the current store scope. */}
      <Drawer
        open={adjustVariantId !== null}
        size="panel"
        title="Adjust stock"
        subtitle={adjustVariantId ? variantLabel(adjustVariantId) : undefined}
        onClose={() => setAdjustVariantId(null)}
      >
        {adjustUnits.length > 0 ? (
          <div className="unit-adjust-list">
            <p className="form-hint">Individual stock records for this variation{allStores ? '' : ` at ${storeName(storeFilter)}`}. Adjust a record to log a status change in the ledger.</p>
            {adjustUnits.map((unit, index) => (
              <div key={unit.id} className="unit-adjust-row">
                <div className="record-main">
                  <strong>{unitCode(unit, index)}</strong>
                  <small>{storeName(unit.storeId)}</small>
                </div>
                <StatusBadge
                  label={unit.status === 'in_stock' ? 'In stock' : unit.status === 'in_transit' ? 'In transit' : 'Sold'}
                  tone={unit.status === 'in_stock' ? 'success' : unit.status === 'in_transit' ? 'info' : 'neutral'}
                />
                <button type="button" className="text-button" onClick={() => openUnitAdjust(unit)}>
                  Adjust
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No records here" description="This variation has no stock records in the selected store." />
        )}
      </Drawer>

      {/* Single-record status adjustment. */}
      <Drawer
        open={unitModal !== null}
        size="sheet"
        title="Adjust stock record"
        subtitle={unitModal ? `${unitCode(unitModal, 0)} · ${storeName(unitModal.storeId)}` : undefined}
        onClose={() => setUnitModal(null)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setUnitModal(null)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={confirmUnitAdjust}>
              Confirm adjustment
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Status">
            <select value={unitDraft.status} onChange={(event) => setUnitDraft((prev) => ({ ...prev, status: event.target.value as UnitStatus }))} className="admin-select">
              <option value="in_stock">In stock</option>
              <option value="sold">Sold</option>
              <option value="in_transit">In transit</option>
            </select>
          </Field>
          <Field label="Note">
            <textarea value={unitDraft.note} onChange={(event) => setUnitDraft((prev) => ({ ...prev, note: event.target.value }))} className="admin-textarea" rows={3} placeholder="Explain the reason for the adjustment" />
          </Field>
        </div>
      </Drawer>

      {/* Transfer between boutiques. */}
      <Drawer
        open={transferVariantId !== null}
        size="sheet"
        title="Transfer stock"
        subtitle={transferVariantId ? variantLabel(transferVariantId) : undefined}
        onClose={() => setTransferVariantId(null)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setTransferVariantId(null)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={confirmTransfer} disabled={!transferDraft.fromStoreId || !transferDraft.toStoreId || transferDraft.fromStoreId === transferDraft.toStoreId}>
              Transfer
            </button>
          </div>
        }
      >
        {transferStores.length > 0 ? (
          <div className="form-grid">
            <Field label="From store">
              <select value={transferDraft.fromStoreId} onChange={(event) => changeTransferFrom(event.target.value)} className="admin-select">
                {transferStores.map((s) => (
                  <option key={s.storeId} value={s.storeId}>
                    {storeName(s.storeId)} ({s.count} on hand)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity">
              <input
                type="number"
                min="1"
                max={transferStores.find((s) => s.storeId === transferDraft.fromStoreId)?.count ?? 1}
                value={transferDraft.qty}
                onChange={(event) => setTransferDraft((prev) => ({ ...prev, qty: Number(event.target.value) || 1 }))}
                className="admin-input"
              />
            </Field>
            <Field label="To store">
              <select value={transferDraft.toStoreId} onChange={(event) => setTransferDraft((prev) => ({ ...prev, toStoreId: event.target.value }))} className="admin-select">
                <option value="" disabled>
                  Choose destination…
                </option>
                {transferToOptions.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note" hint="Optional. Logged with the transfer.">
              <input value={transferDraft.note} onChange={(event) => setTransferDraft((prev) => ({ ...prev, note: event.target.value }))} className="admin-input" placeholder="Reason for the transfer" />
            </Field>
          </div>
        ) : (
          <EmptyState title="Nothing to transfer" description="This variation has no in-stock units to move. Add stock first." />
        )}
      </Drawer>

      {/* Movement history. */}
      <Drawer
        open={historyVariantId !== null}
        size="panel"
        title="Movement history"
        subtitle={historyVariantId ? variantLabel(historyVariantId) : undefined}
        onClose={() => setHistoryVariantId(null)}
      >
        {historyMoves.length > 0 ? (
          <div className="movement-list">
            {historyMoves.map((move) => {
              const route = movementRoute(move.fromStoreId, move.toStoreId)
              return (
                <div key={move.id} className="movement-row">
                  <div className="movement-head">
                    <span className={`status-pill move-kind ${move.kind}`}>{KIND_LABELS[move.kind] ?? move.kind}</span>
                    <span className="movement-date">{fmtDateTime(move.createdAt)}</span>
                  </div>
                  {route ? <p className="movement-route">{route}</p> : null}
                  <div className="movement-meta">
                    {move.staffName ? <span>{move.staffName}</span> : null}
                    {move.note ? <span className="movement-note">{move.note}</span> : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState title="No movements yet" description="Stock additions, transfers, and adjustments for this variation will appear here." />
        )}
      </Drawer>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  )
}
