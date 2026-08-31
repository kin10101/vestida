import { useMemo, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import type { InventoryUnit, ProductVariant, UnitStatus } from '../data'
import { Drawer, EmptyState, Field, PageHeader, StatusBadge } from '../ui'

const PAGE_SIZE = 10

const formatPeso = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value / 100)

const getVariantName = (variantId: string, variants: ProductVariant[]) => {
  const variant = variants.find((item) => item.id === variantId)
  if (!variant) {
    return 'Unknown variant'
  }

  return `${variant.color} ${variant.size}`
}

const getProductName = (variantId: string, variants: ProductVariant[], products: ReturnType<typeof useAdminData>['state']['products']) => {
  const variant = variants.find((item) => item.id === variantId)
  if (!variant) {
    return 'Unknown product'
  }

  return products.find((product) => product.id === variant.productId)?.name ?? 'Unknown product'
}

export default function Inventory() {
  const { state, applyIntake, adjustInventoryUnit, bulkAdjustInventoryUnits } = useAdminData()
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [expandedProductIds, setExpandedProductIds] = useState<string[]>([])
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([])
  const [bulkStatusDraft, setBulkStatusDraft] = useState<{ status: UnitStatus; note: string; staffName: string }>({
    status: 'in_stock',
    note: '',
    staffName: 'Admin',
  })
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustUnitId, setAdjustUnitId] = useState('')
  const [intakeDraft, setIntakeDraft] = useState({
    variantId: state.productVariants[0]?.id ?? '',
    storeId: state.stores[0]?.id ?? '',
    quantity: 1,
    costPriceCents: state.productVariants[0]?.costPriceCents ?? 150000,
    sourceNote: '',
    acquiredAt: new Date().toISOString(),
    staffName: 'Admin',
  })
  const [adjustDraft, setAdjustDraft] = useState<{ status: UnitStatus; note: string; staffName: string }>({
    status: 'in_stock',
    note: '',
    staffName: 'Admin',
  })

  const catalogStockOverview = useMemo(() => {
    const stockScope = state.inventoryUnits.filter((unit) => storeFilter === 'all' || unit.storeId === storeFilter)

    return state.products.map((product) => {
      const variants = state.productVariants.filter((variant) => variant.productId === product.id)
      const variantIdSet = new Set(variants.map((variant) => variant.id))
      const units = stockScope.filter((unit) => variantIdSet.has(unit.variantId))
      const countStatus = (status: UnitStatus) => units.filter((unit) => unit.status === status).length

      return {
        product,
        variants: variants.map((variant) => {
          const variantUnits = units.filter((unit) => unit.variantId === variant.id)
          return {
            variant,
            inStock: variantUnits.filter((unit) => unit.status === 'in_stock').length,
            sold: variantUnits.filter((unit) => unit.status === 'sold').length,
          }
        }),
        inStock: countStatus('in_stock'),
        sold: countStatus('sold'),
      }
    })
  }, [state.inventoryUnits, state.productVariants, state.products, storeFilter])

  const visibleUnits = useMemo(() => {
    return state.inventoryUnits.filter((unit) => {
      const matchesStore = storeFilter === 'all' || unit.storeId === storeFilter
      const matchesStatus = statusFilter === 'all' || unit.status === statusFilter
      const haystack = `${unit.unitCode} ${getProductName(unit.variantId, state.productVariants, state.products)} ${getVariantName(unit.variantId, state.productVariants)}`.toLowerCase()
      const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase())
      return matchesStore && matchesStatus && matchesSearch
    })
  }, [search, state.inventoryUnits, state.productVariants, state.products, statusFilter, storeFilter])

  const totalPages = Math.max(1, Math.ceil(visibleUnits.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginatedUnits = visibleUnits.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const openAdjustment = (unit: InventoryUnit) => {
    setAdjustUnitId(unit.id)
    setAdjustDraft({ status: unit.status, note: '', staffName: 'Admin' })
    setAdjustOpen(true)
  }

  const handleSaveAdjustment = () => {
    if (!adjustUnitId) {
      return
    }

    if (!window.confirm('This adjustment will update the stock status and log the movement in the ledger. Continue?')) {
      return
    }

    adjustInventoryUnit(adjustUnitId, adjustDraft.status, adjustDraft.note, adjustDraft.staffName)
    setAdjustOpen(false)
    setAdjustUnitId('')
  }

  const handleSaveIntake = () => {
    if (!intakeDraft.variantId || !intakeDraft.storeId) {
      return
    }

    applyIntake({
      variantId: intakeDraft.variantId,
      storeId: intakeDraft.storeId,
      quantity: intakeDraft.quantity,
      costPriceCents: intakeDraft.costPriceCents,
      sourceNote: intakeDraft.sourceNote || 'Manual stock entry',
      acquiredAt: intakeDraft.acquiredAt,
      staffName: intakeDraft.staffName,
    })
    setIntakeOpen(false)
  }

  const toggleProductOverview = (productId: string) => {
    setExpandedProductIds((previous) =>
      previous.includes(productId) ? previous.filter((id) => id !== productId) : [...previous, productId],
    )
  }

  const toggleUnitSelection = (unitId: string) => {
    setSelectedUnitIds((previous) =>
      previous.includes(unitId) ? previous.filter((id) => id !== unitId) : [...previous, unitId],
    )
  }

  const clearBulkSelection = () => {
    setBulkMode(false)
    setBulkMenuOpen(false)
    setSelectedUnitIds([])
  }

  const handleBulkStatusApply = () => {
    if (selectedUnitIds.length === 0) {
      return
    }

    const count = selectedUnitIds.length
    const targetLabel = bulkStatusDraft.status.replace('_', ' ')
    if (!window.confirm(`Update ${count} selected unit${count === 1 ? '' : 's'} to ${targetLabel}?`)) {
      return
    }

    bulkAdjustInventoryUnits(selectedUnitIds, bulkStatusDraft.status, bulkStatusDraft.note, bulkStatusDraft.staffName)
    clearBulkSelection()
  }

  return (
    <div className="admin-page inventory-page">
      <PageHeader
        title="Inventory"
        subtitle="Individual stock records across each boutique. Filter by store and status."
      />

      <section className="admin-panel inventory-overview" aria-labelledby="inventory-overview-title">
        <div className="panel-header-row inventory-overview-heading">
          <div>
            <h3 id="inventory-overview-title">Catalog stock overview</h3>
            <p>All catalog products. Counts reflect the selected store.</p>
          </div>
        </div>
        <div className="catalog-stock-list">
          {catalogStockOverview.map(({ product, variants, inStock, sold }) => {
            const isExpanded = expandedProductIds.includes(product.id)
            const category = state.categories.find((item) => item.id === product.categoryId)

            return (
              <div key={product.id} className={`catalog-stock-item ${isExpanded ? 'expanded' : ''}`}>
                <button
                  type="button"
                  className="catalog-stock-row"
                  onClick={() => toggleProductOverview(product.id)}
                  aria-expanded={isExpanded}
                  aria-controls={`catalog-stock-variants-${product.id}`}
                >
                  <span className="catalog-stock-product">
                    <strong>{product.name}</strong>
                    <small>{category?.name ?? 'Unassigned'} · {variants.length} variation{variants.length === 1 ? '' : 's'}</small>
                  </span>
                  <span className="catalog-stock-counts">
                    <span><strong>{inStock}</strong> in stock</span>
                    <span><strong>{sold}</strong> sold</span>
                  </span>
                  <ChevronDown className="catalog-stock-chevron" size={18} aria-hidden="true" />
                </button>

                {isExpanded ? (
                  <div id={`catalog-stock-variants-${product.id}`} className="catalog-variant-list">
                    {variants.length > 0 ? variants.map(({ variant, inStock: variantInStock, sold: variantSold }) => (
                      <div key={variant.id} className="catalog-variant-row">
                        <div>
                          <strong>{variant.color} {variant.size}</strong>
                          <small>{variant.sku}</small>
                        </div>
                        <div className="catalog-stock-counts">
                          <span><strong>{variantInStock}</strong> in stock</span>
                          <span><strong>{variantSold}</strong> sold</span>
                        </div>
                      </div>
                    )) : (
                      <p className="catalog-variant-empty">No variations have been added.</p>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      <>
          <div className="manager-toolbar">
            <div className="toolbar-left">
              <select value={storeFilter} onChange={(event) => { setStoreFilter(event.target.value); setPage(1) }} className="admin-select">
                <option value="all">All stores</option>
                {state.stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="admin-select">
                <option value="all">All statuses</option>
                <option value="in_stock">In stock</option>
                <option value="sold">Sold</option>
                <option value="in_transit">In transit</option>
              </select>
            </div>
            <div className="toolbar-right">
              <div className="search-box">
                <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search unit or SKU" aria-label="Search units" />
              </div>
              <div className="bulk-toolbar">
                {!bulkMode ? (
                  <>
                    <button type="button" className="secondary-button bulk-mode-toggle desktop-only" onClick={() => setBulkMode(true)} aria-label="Select inventory units for bulk status updates">
                      Select
                    </button>
                    <button type="button" className="secondary-button bulk-mode-toggle mobile-only" onClick={() => setBulkMenuOpen((previous) => !previous)} aria-label="Toggle bulk inventory actions">
                      {bulkMenuOpen ? 'Close' : 'Bulk'}
                    </button>
                    {bulkMenuOpen ? (
                      <button type="button" className="secondary-button bulk-mode-toggle mobile-menu" onClick={() => { setBulkMenuOpen(false); setBulkMode(true) }} aria-label="Select inventory units for bulk status updates">
                        Select
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button type="button" className="secondary-button bulk-mode-toggle" onClick={clearBulkSelection} aria-label="Done bulk inventory selection">
                    Done
                  </button>
                )}
              </div>
              <button type="button" className="primary-button" onClick={() => setIntakeOpen(true)} aria-label="Add new stock">
                <Plus size={16} />
                Add stock
              </button>
            </div>
          </div>

          {bulkMode ? (
            <div className="bulk-selection-bar" role="toolbar" aria-label="Bulk inventory actions">
              <span className="selection-count">{selectedUnitIds.length} selected</span>
              <select
                value={bulkStatusDraft.status}
                onChange={(event) => setBulkStatusDraft((previous) => ({ ...previous, status: event.target.value as UnitStatus }))}
                className="admin-select bulk-status-select"
                aria-label="Choose the status to apply to selected units"
              >
                <option value="in_stock">In stock</option>
                <option value="sold">Sold</option>
                <option value="in_transit">In transit</option>
              </select>
              <input
                value={bulkStatusDraft.note}
                onChange={(event) => setBulkStatusDraft((previous) => ({ ...previous, note: event.target.value }))}
                className="admin-input bulk-text-input"
                placeholder="Adjustment note"
                aria-label="Bulk inventory adjustment note"
              />
              <input
                value={bulkStatusDraft.staffName}
                onChange={(event) => setBulkStatusDraft((previous) => ({ ...previous, staffName: event.target.value }))}
                className="admin-input bulk-text-input"
                placeholder="Staff name"
                aria-label="Bulk inventory adjustment staff name"
              />
              <button type="button" className="primary-button bulk-action-button" onClick={handleBulkStatusApply} aria-label="Apply the selected status to the chosen inventory units" disabled={selectedUnitIds.length === 0}>
                Apply status
              </button>
              <button type="button" className="secondary-button bulk-action-button" onClick={() => setSelectedUnitIds([])} aria-label="Clear inventory unit selections">
                Clear
              </button>
            </div>
          ) : null}

          <div className="record-stack compact">
            {visibleUnits.length > 0 ? (
              paginatedUnits.map((unit) => {
                const variantName = getVariantName(unit.variantId, state.productVariants)
                const productName = getProductName(unit.variantId, state.productVariants, state.products)
                const store = state.stores.find((entry) => entry.id === unit.storeId)
                const isSelected = selectedUnitIds.includes(unit.id)

                return (
                  <div key={unit.id} className={`record-card stock-row ${isSelected ? 'bulk-selected' : ''}`}>
                    {bulkMode ? (
                      <button
                        type="button"
                        className={`bulk-select-button ${isSelected ? 'selected' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleUnitSelection(unit.id)
                        }}
                        aria-label={isSelected ? `Clear selection for ${unit.unitCode}` : `Select ${unit.unitCode}`}
                        aria-pressed={isSelected}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
                    ) : null}
                    <div className="record-main">
                      <strong>{unit.unitCode}</strong>
                      <small>
                        {productName} · {variantName}
                      </small>
                    </div>
                    <div className="record-side column align-end">
                      <span>{store?.isDeleted ? `Deleted store (${store.name})` : store?.name ?? 'Unknown store'}</span>
                      <StatusBadge label={unit.status === 'in_stock' ? 'In stock' : unit.status === 'in_transit' ? 'In transit' : 'Sold'} tone={unit.status === 'in_stock' ? 'success' : unit.status === 'in_transit' ? 'info' : 'neutral'} />
                    </div>
                    <div className="record-actions compact-actions">
                      <span>{formatPeso(unit.costPriceCents)}</span>
                      <button type="button" className="text-button" onClick={() => openAdjustment(unit)} aria-label={`Adjust stock status for ${unit.unitCode}`}>
                        Adjust
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState title="No units found" description="Try another status or store filter to see more stock." />
            )}
          </div>

          {visibleUnits.length > PAGE_SIZE ? (
            <nav className="pagination-controls" aria-label="Inventory pages">
              <span>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, visibleUnits.length)} of {visibleUnits.length} units
              </span>
              <div className="pagination-actions">
                <button type="button" className="secondary-button" onClick={() => setPage((previous) => Math.max(1, previous - 1))} disabled={currentPage === 1}>
                  Previous
                </button>
                <span aria-current="page">Page {currentPage} of {totalPages}</span>
                <button type="button" className="secondary-button" onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))} disabled={currentPage === totalPages}>
                  Next
                </button>
              </div>
            </nav>
          ) : null}
      </>

      <Drawer
        open={intakeOpen}
        size="panel"
        title="Add stock"
        subtitle="Create individual stock records and log their receipt."
        onClose={() => setIntakeOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setIntakeOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveIntake}>
              Add stock
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Variant">
            <select value={intakeDraft.variantId} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, variantId: event.target.value }))} className="admin-select">
              {state.productVariants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {getProductName(variant.id, state.productVariants, state.products)} · {variant.color} {variant.size}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Store">
            <select value={intakeDraft.storeId} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, storeId: event.target.value }))} className="admin-select">
              {state.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input type="number" min="1" value={intakeDraft.quantity} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, quantity: Number(event.target.value) || 1 }))} className="admin-input" />
          </Field>
          <Field label="Cost per unit">
            <input type="number" min="0" value={intakeDraft.costPriceCents / 100} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, costPriceCents: Math.round(Number(event.target.value || 0) * 100) }))} className="admin-input" />
          </Field>
          <Field label="Source note">
            <input value={intakeDraft.sourceNote} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, sourceNote: event.target.value }))} className="admin-input" placeholder="Supplier, event, or order reference" />
          </Field>
          <Field label="Staff name">
            <input value={intakeDraft.staffName} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, staffName: event.target.value }))} className="admin-input" placeholder="Admin or receiving staff" />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={adjustOpen}
        size="sheet"
        title="Adjust unit status"
        subtitle="Log a manual change to the physical record."
        onClose={() => setAdjustOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setAdjustOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveAdjustment}>
              Confirm adjustment
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Status">
            <select value={adjustDraft.status} onChange={(event) => setAdjustDraft((previous) => ({ ...previous, status: event.target.value as typeof previous.status }))} className="admin-select">
              <option value="in_stock">In stock</option>
              <option value="sold">Sold</option>
              <option value="in_transit">In transit</option>
            </select>
          </Field>
          <Field label="Note">
            <textarea value={adjustDraft.note} onChange={(event) => setAdjustDraft((previous) => ({ ...previous, note: event.target.value }))} className="admin-textarea" rows={4} placeholder="Explain the reason for the adjustment" />
          </Field>
          <Field label="Staff name">
            <input value={adjustDraft.staffName} onChange={(event) => setAdjustDraft((previous) => ({ ...previous, staffName: event.target.value }))} className="admin-input" />
          </Field>
        </div>
      </Drawer>
    </div>
  )
}
