import { useEffect, useMemo, useState } from 'react'
import { CirclePlus, PencilLine, Tag, ToggleLeft, ToggleRight } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import type { Product, ProductVariant } from '../data'
import { Drawer, EmptyState, Field, PageHeader, StatusBadge } from '../ui'

interface ProductDraft {
  id?: string
  categoryId: string
  name: string
  description: string
  isActive: boolean
  isTypicallyMto: boolean
}

interface VariantDraft {
  id?: string
  productId: string
  color: string
  size: string
  sku: string
  regularPriceCents: number
  costPriceCents: number
  isActive: boolean
}

const emptyProductDraft = (categoryId: string): ProductDraft => ({
  categoryId,
  name: '',
  description: '',
  isActive: true,
  isTypicallyMto: false,
})

const emptyVariantDraft = (productId: string): VariantDraft => ({
  productId,
  color: '',
  size: '',
  sku: '',
  regularPriceCents: 250000,
  costPriceCents: 150000,
  isActive: true,
})

const formatPeso = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value / 100)

export default function Products() {
  const { state, upsertProduct, upsertVariant, toggleProductActive, bulkToggleProductActive, toggleVariantActive } = useAdminData()
  const [search, setSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(state.products[0]?.id ?? null)
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [variantModalOpen, setVariantModalOpen] = useState(false)
  const [productDraft, setProductDraft] = useState<ProductDraft>(() => emptyProductDraft(state.categories[0]?.id ?? ''))
  const [variantDraft, setVariantDraft] = useState<VariantDraft>(() => emptyVariantDraft(state.products[0]?.id ?? ''))

  const visibleProducts = useMemo(
    () =>
      state.products.filter((product) => {
        if (!search.trim()) {
          return true
        }

        const haystack = `${product.name} ${product.description}`.toLowerCase()
        return haystack.includes(search.trim().toLowerCase())
      }),
    [search, state.products],
  )

  useEffect(() => {
    if (!selectedProductId && visibleProducts[0]) {
      setSelectedProductId(visibleProducts[0].id)
    }

    if (selectedProductId && !visibleProducts.some((product) => product.id === selectedProductId)) {
      setSelectedProductId(visibleProducts[0]?.id ?? null)
    }
  }, [selectedProductId, visibleProducts])

  const selectedProduct = useMemo(
    () => state.products.find((product) => product.id === selectedProductId) ?? state.products[0] ?? null,
    [selectedProductId, state.products],
  )

  const selectedVariants = useMemo(
    () =>
      selectedProduct
        ? state.productVariants.filter((variant) => variant.productId === selectedProduct.id)
        : [],
    [selectedProduct, state.productVariants],
  )

  const openProductModal = (product?: Product) => {
    if (product) {
      setProductDraft({
        id: product.id,
        categoryId: product.categoryId,
        name: product.name,
        description: product.description,
        isActive: product.isActive,
        isTypicallyMto: product.isTypicallyMto,
      })
    } else {
      setProductDraft(emptyProductDraft(state.categories[0]?.id ?? ''))
    }
    setProductModalOpen(true)
  }

  const openVariantModal = (variant?: ProductVariant) => {
    if (variant) {
      setVariantDraft({
        id: variant.id,
        productId: variant.productId,
        color: variant.color,
        size: variant.size,
        sku: variant.sku,
        regularPriceCents: variant.regularPriceCents,
        costPriceCents: variant.costPriceCents,
        isActive: variant.isActive,
      })
    } else if (selectedProduct) {
      setVariantDraft(emptyVariantDraft(selectedProduct.id))
    }
    setVariantModalOpen(true)
  }

  const handleSaveProduct = () => {
    if (!productDraft.name.trim()) {
      return
    }

    upsertProduct({
      id: productDraft.id ?? `product-${Date.now()}`,
      categoryId: productDraft.categoryId,
      name: productDraft.name,
      description: productDraft.description,
      isActive: productDraft.isActive,
      isTypicallyMto: productDraft.isTypicallyMto,
      createdAt: productDraft.id
        ? state.products.find((product) => product.id === productDraft.id)?.createdAt ?? new Date().toISOString()
        : new Date().toISOString(),
    })
    setProductModalOpen(false)
  }

  const handleSaveVariant = () => {
    if (!selectedProduct || !variantDraft.color.trim() || !variantDraft.size.trim() || !variantDraft.sku.trim()) {
      return
    }

    upsertVariant({
      id: variantDraft.id ?? `variant-${Date.now()}`,
      productId: variantDraft.productId || selectedProduct.id,
      color: variantDraft.color,
      size: variantDraft.size,
      sku: variantDraft.sku,
      regularPriceCents: variantDraft.regularPriceCents,
      costPriceCents: variantDraft.costPriceCents,
      isActive: variantDraft.isActive,
      createdAt: variantDraft.id
        ? state.productVariants.find((variant) => variant.id === variantDraft.id)?.createdAt ?? new Date().toISOString()
        : new Date().toISOString(),
    })
    setVariantModalOpen(false)
  }

  const handleToggleProduct = (product: Product) => {
    const nextText = product.isActive ? 'deactivate this product' : 'reactivate this product'
    const confirmed = window.confirm(`Are you sure you want to ${nextText}?`)
    if (confirmed) {
      toggleProductActive(product.id)
    }
  }

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((previous) =>
      previous.includes(productId) ? previous.filter((id) => id !== productId) : [...previous, productId],
    )
  }

  const clearBulkSelection = () => {
    setBulkMode(false)
    setBulkMenuOpen(false)
    setSelectedProductIds([])
  }

  const applyBulkProductState = (nextActive: boolean) => {
    if (selectedProductIds.length === 0) {
      return
    }

    if (!nextActive && !window.confirm(`Deactivate ${selectedProductIds.length} selected product${selectedProductIds.length === 1 ? '' : 's'}?`)) {
      return
    }

    bulkToggleProductActive(selectedProductIds, nextActive)
    clearBulkSelection()
  }

  if (!selectedProduct) {
    return (
      <div className="admin-page">
        <PageHeader title="Products" subtitle="Catalog and variant management." />
        <EmptyState title="No products yet" description="Create your first product to start the boutique catalog." action={<button type="button" className="primary-button" onClick={() => openProductModal()}>Add product</button>} />
      </div>
    )
  }

  return (
    <div className="admin-page product-page">
      <PageHeader
        title="Products"
        subtitle="Product catalog, variant pricing, and active controls."
        actions={
          <div className="inline-actions">
            <div className="bulk-toolbar">
              {!bulkMode ? (
                <>
                  <button type="button" className="secondary-button bulk-mode-toggle desktop-only" onClick={() => setBulkMode(true)} aria-label="Select products for bulk activation or deactivation">
                    Select
                  </button>
                  <button type="button" className="secondary-button bulk-mode-toggle mobile-only" onClick={() => setBulkMenuOpen((previous) => !previous)} aria-label="Toggle bulk product actions">
                    {bulkMenuOpen ? 'Close' : 'Bulk'}
                  </button>
                  {bulkMenuOpen ? (
                    <button type="button" className="secondary-button bulk-mode-toggle mobile-menu" onClick={() => { setBulkMenuOpen(false); setBulkMode(true) }} aria-label="Select products for bulk activation or deactivation">
                      Select
                    </button>
                  ) : null}
                </>
              ) : (
                <button type="button" className="secondary-button bulk-mode-toggle" onClick={clearBulkSelection} aria-label="Done bulk product selection">
                  Done
                </button>
              )}
            </div>
            <button type="button" className="primary-button" onClick={() => openProductModal()} aria-label="Add a new product">
              <CirclePlus size={16} />
              Add product
            </button>
          </div>
        }
      />

      {bulkMode ? (
        <div className="bulk-selection-bar" role="toolbar" aria-label="Bulk product actions">
          <span className="selection-count">{selectedProductIds.length} selected</span>
          <button type="button" className="primary-button bulk-action-button" onClick={() => applyBulkProductState(true)} aria-label="Activate selected products" disabled={selectedProductIds.length === 0}>
            Activate
          </button>
          <button type="button" className="secondary-button bulk-action-button" onClick={() => applyBulkProductState(false)} aria-label="Deactivate selected products" disabled={selectedProductIds.length === 0}>
            Deactivate
          </button>
          <button type="button" className="secondary-button bulk-action-button" onClick={() => setSelectedProductIds([])} aria-label="Clear product selections">
            Clear
          </button>
        </div>
      ) : null}

      <div className="two-column-layout">
        <section className="admin-panel">
          <div className="panel-header-row">
            <h3>Catalog</h3>
            <div className="search-box small">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search products"
                aria-label="Search products"
              />
            </div>
          </div>

          <div className="record-stack">
            {visibleProducts.length > 0 ? (
              visibleProducts.map((product) => {
                const isSelected = selectedProductIds.includes(product.id)
                return (
                  <div
                    key={product.id}
                    role={bulkMode ? 'checkbox' : 'button'}
                    tabIndex={0}
                    aria-checked={bulkMode ? isSelected : undefined}
                    className={`record-card ${selectedProduct?.id === product.id ? 'selected' : ''} ${bulkMode && isSelected ? 'bulk-selected' : ''}`}
                    onClick={() => {
                      if (bulkMode) {
                        toggleProductSelection(product.id)
                        return
                      }
                      setSelectedProductId(product.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (bulkMode) {
                          toggleProductSelection(product.id)
                          return
                        }
                        setSelectedProductId(product.id)
                      }
                    }}
                  >
                    {bulkMode ? (
                      <span className={`bulk-select-button ${isSelected ? 'selected' : ''}`} aria-hidden="true">
                        {isSelected ? '✓' : ''}
                      </span>
                    ) : null}
                    <div className="record-main">
                      <strong>{product.name}</strong>
                      <small>{state.categories.find((category) => category.id === product.categoryId)?.name ?? 'No category'}</small>
                    </div>
                    <div className="record-side">
                      <StatusBadge label={product.isActive ? 'Active' : 'Inactive'} tone={product.isActive ? 'success' : 'neutral'} />
                      <span>{state.productVariants.filter((variant) => variant.productId === product.id).length} variants</span>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState title="No matches" description="Adjust the search to find the catalog item you need." />
            )}
          </div>
        </section>

        <section className="admin-panel detail-panel">
          <div className="panel-header-row detail-header">
            <div>
              <h3>{selectedProduct.name}</h3>
              <small>{selectedProduct.description || 'No description provided.'}</small>
            </div>
            <div className="inline-actions">
              <button type="button" className="secondary-button" onClick={() => openProductModal(selectedProduct)}>
                <PencilLine size={16} />
                Edit
              </button>
              <button type="button" className="secondary-button" onClick={() => handleToggleProduct(selectedProduct)}>
                {selectedProduct.isActive ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
                {selectedProduct.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>

          <div className="detail-meta-grid">
            <div>
              <span>Category</span>
              <strong>{state.categories.find((category) => category.id === selectedProduct.categoryId)?.name ?? 'Unassigned'}</strong>
            </div>
            <div>
              <span>Typical MTO</span>
              <strong>{selectedProduct.isTypicallyMto ? 'Yes' : 'No'}</strong>
            </div>
            <div>
              <span>Variants</span>
              <strong>{selectedVariants.length}</strong>
            </div>
            <div>
              <span>Active</span>
              <strong>{selectedProduct.isActive ? 'On' : 'Off'}</strong>
            </div>
          </div>

          <div className="section-actions">
            <button type="button" className="primary-button" onClick={() => openVariantModal()}>
              <Tag size={16} />
              Add variant
            </button>
          </div>

          <div className="record-stack compact">
            {selectedVariants.length > 0 ? (
              selectedVariants.map((variant) => {
                const liveUnits = state.inventoryUnits.filter((unit) => unit.variantId === variant.id)
                const inStockCount = liveUnits.filter((unit) => unit.status === 'in_stock').length

                return (
                  <div key={variant.id} className="record-card variant-row">
                    <div className="record-main">
                      <strong>
                        {variant.color} {variant.size}
                      </strong>
                      <small>{variant.sku}</small>
                    </div>
                    <div className="record-side column">
                      <span>{formatPeso(variant.regularPriceCents)}</span>
                      <StatusBadge label={variant.isActive ? 'Active' : 'Inactive'} tone={variant.isActive ? 'success' : 'neutral'} />
                    </div>
                    <div className="record-actions">
                      <span>{inStockCount} in stock</span>
                      <button type="button" className="text-button" onClick={() => openVariantModal(variant)}>
                        Edit
                      </button>
                      <button type="button" className="text-button" onClick={() => toggleVariantActive(variant.id)}>
                        {variant.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState title="No variants yet" description="Add the first option for this product." />
            )}
          </div>
        </section>
      </div>

      <Drawer
        open={productModalOpen}
        size="panel"
        title={productDraft.id ? 'Edit product' : 'Add product'}
        subtitle="Keep the catalog active and easy to scan."
        onClose={() => setProductModalOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setProductModalOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveProduct}>
              Save product
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Product name">
            <input
              value={productDraft.name}
              onChange={(event) => setProductDraft((previous) => ({ ...previous, name: event.target.value }))}
              className="admin-input"
              placeholder="E.g. Luna Blouse"
            />
          </Field>
          <Field label="Category">
            <select
              value={productDraft.categoryId}
              onChange={(event) => setProductDraft((previous) => ({ ...previous, categoryId: event.target.value }))}
              className="admin-select"
            >
              {state.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="inline-row multi">
            <label className="check-row">
              <input
                type="checkbox"
                checked={productDraft.isActive}
                onChange={(event) => setProductDraft((previous) => ({ ...previous, isActive: event.target.checked }))}
              />
              <span>Active</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={productDraft.isTypicallyMto}
                onChange={(event) => setProductDraft((previous) => ({ ...previous, isTypicallyMto: event.target.checked }))}
              />
              <span>Typical MTO</span>
            </label>
          </div>
          <Field label="Description">
            <textarea
              value={productDraft.description}
              onChange={(event) => setProductDraft((previous) => ({ ...previous, description: event.target.value }))}
              className="admin-textarea"
              rows={4}
              placeholder="Write a short product summary"
            />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={variantModalOpen}
        size="panel"
        title={variantDraft.id ? 'Edit variant' : 'Add variant'}
        subtitle="Manage color, size, pricing, and availability."
        onClose={() => setVariantModalOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setVariantModalOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveVariant}>
              Save variant
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Color">
            <input
              value={variantDraft.color}
              onChange={(event) => setVariantDraft((previous) => ({ ...previous, color: event.target.value }))}
              className="admin-input"
              placeholder="Ivory"
            />
          </Field>
          <Field label="Size">
            <input
              value={variantDraft.size}
              onChange={(event) => setVariantDraft((previous) => ({ ...previous, size: event.target.value }))}
              className="admin-input"
              placeholder="M"
            />
          </Field>
          <Field label="SKU">
            <input
              value={variantDraft.sku}
              onChange={(event) => setVariantDraft((previous) => ({ ...previous, sku: event.target.value }))}
              className="admin-input"
              placeholder="LUNA-IV-M"
            />
          </Field>
          <Field label="Regular price">
            <input
              type="number"
              min="0"
              value={variantDraft.regularPriceCents / 100}
              onChange={(event) =>
                setVariantDraft((previous) => ({
                  ...previous,
                  regularPriceCents: Math.round(Number(event.target.value || 0) * 100),
                }))
              }
              className="admin-input"
            />
          </Field>
          <Field label="Cost price">
            <input
              type="number"
              min="0"
              value={variantDraft.costPriceCents / 100}
              onChange={(event) =>
                setVariantDraft((previous) => ({
                  ...previous,
                  costPriceCents: Math.round(Number(event.target.value || 0) * 100),
                }))
              }
              className="admin-input"
            />
          </Field>
          <label className="check-row large">
            <input
              type="checkbox"
              checked={variantDraft.isActive}
              onChange={(event) => setVariantDraft((previous) => ({ ...previous, isActive: event.target.checked }))}
            />
            <span>Active variant</span>
          </label>
        </div>
      </Drawer>
    </div>
  )
}
