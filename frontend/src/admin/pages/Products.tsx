import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Eye, EyeOff, PencilLine, Plus, X } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import type { Product } from '../data'
import { Drawer, EmptyState, Field, PageHeader, StatusBadge, Toast } from '../ui'

interface ProductDraft {
  id?: string
  categoryId: string
  name: string
  description: string
  isActive: boolean
  // Product-level matrix fields are carried through so editing the product
  // (name/category/etc.) never wipes the color/size/SKU/pricing definition.
  skuPrefix: string
  colors: string[]
  sizes: string[]
  costPriceCents: number
  regularPriceCents: number
}

const emptyProductDraft = (categoryId: string): ProductDraft => ({
  categoryId,
  name: '',
  description: '',
  isActive: true,
  skuPrefix: '',
  colors: [],
  sizes: [],
  costPriceCents: 0,
  regularPriceCents: 0,
})

const formatPeso = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value / 100)

// SKU = [SKU_PREFIX]-[first 3 letters of color]-[SIZE], e.g. LUNA-IVO-L.
const buildSku = (prefix: string, color: string, size: string) =>
  `${prefix.trim().toUpperCase()}-${color.trim().toUpperCase().slice(0, 3)}-${size.trim().toUpperCase()}`

export default function Products() {
  const { state, upsertCategory, deleteCategory, upsertProduct, toggleProductActive, bulkToggleProductActive, deleteProducts, applyIntake } = useAdminData()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(state.products[0]?.id ?? null)
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [deleteWarnOpen, setDeleteWarnOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [categoryDraft, setCategoryDraft] = useState({ id: '', name: '' })
  const [productDraft, setProductDraft] = useState<ProductDraft>(() => emptyProductDraft(state.categories[0]?.id ?? ''))
  const [detailFocused, setDetailFocused] = useState(false)
  const detailPanelRef = useRef<HTMLElement>(null)
  const detailHeadingRef = useRef<HTMLHeadingElement>(null)

  // Selected color + size drive the SKU and stock shown in the detail panel.
  const [selectedColor, setSelectedColor] = useState<string | null>(null)
  const [selectedSize, setSelectedSize] = useState<string | null>(null)

  // Matrix edit-mode draft (colors/sizes/sku prefix/cost/selling price).
  const [editMode, setEditMode] = useState(false)
  const [editColors, setEditColors] = useState<string[]>([])
  const [editSizes, setEditSizes] = useState<string[]>([])
  const [editSkuPrefix, setEditSkuPrefix] = useState('')
  const [editCostCents, setEditCostCents] = useState(0)
  const [editSellCents, setEditSellCents] = useState(0)
  const [newColor, setNewColor] = useState('')
  const [newSize, setNewSize] = useState('')

  // Add-stock modal.
  const [stockOpen, setStockOpen] = useState(false)
  const [stockQty, setStockQty] = useState(1)
  const [stockStoreId, setStockStoreId] = useState(state.stores[0]?.id ?? '')

  // Success toast shown after stock is added.
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = window.setTimeout(() => setToast(null), 3400)
    return () => window.clearTimeout(timer)
  }, [toast])

  const categoryName = (categoryId: string) =>
    state.categories.find((category) => category.id === categoryId)?.name ?? 'Unassigned'

  const visibleProducts = useMemo(
    () =>
      state.products.filter((product) => {
        if (categoryFilter !== 'all' && product.categoryId !== categoryFilter) {
          return false
        }
        if (!search.trim()) {
          return true
        }
        const haystack = `${product.name} ${product.description}`.toLowerCase()
        return haystack.includes(search.trim().toLowerCase())
      }),
    [search, categoryFilter, state.products],
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

  // When the selected product changes (and when leaving edit mode) reset the
  // per-product selection + edit drafts to match the product.
  useEffect(() => {
    if (!selectedProduct) {
      setEditMode(false)
      return
    }
    setSelectedColor((previous) => (previous && selectedProduct.colors.includes(previous) ? previous : (selectedProduct.colors[0] ?? null)))
    setSelectedSize((previous) => (previous && selectedProduct.sizes.includes(previous) ? previous : (selectedProduct.sizes[0] ?? null)))
    setEditColors(selectedProduct.colors)
    setEditSizes(selectedProduct.sizes)
    setEditSkuPrefix(selectedProduct.skuPrefix)
    setEditCostCents(selectedProduct.costPriceCents)
    setEditSellCents(selectedProduct.regularPriceCents)
    setStockStoreId((previous) => (state.stores.some((store) => store.id === previous) ? previous : (state.stores[0]?.id ?? '')))
    setStockQty(1)
  }, [selectedProduct, state.stores])

  const selectedVariant = useMemo(() => {
    if (!selectedProduct || !selectedColor || !selectedSize) {
      return null
    }
    return (
      state.productVariants.find(
        (variant) => variant.productId === selectedProduct.id && variant.color === selectedColor && variant.size === selectedSize,
      ) ?? null
    )
  }, [selectedProduct, selectedColor, selectedSize, state.productVariants])

  const displaySku =
    selectedProduct && selectedColor && selectedSize
      ? selectedVariant?.sku || buildSku(selectedProduct.skuPrefix, selectedColor, selectedSize)
      : ''

  const selectedInStock = selectedVariant
    ? state.inventoryUnits.filter((unit) => unit.variantId === selectedVariant.id && unit.status === 'in_stock').length
    : 0

  const openProductModal = (product?: Product) => {
    if (product) {
      setProductDraft({
        id: product.id,
        categoryId: product.categoryId,
        name: product.name,
        description: product.description,
        isActive: product.isActive,
        skuPrefix: product.skuPrefix,
        colors: product.colors,
        sizes: product.sizes,
        costPriceCents: product.costPriceCents,
        regularPriceCents: product.regularPriceCents,
      })
    } else {
      setProductDraft(emptyProductDraft(state.categories[0]?.id ?? ''))
    }
    setProductModalOpen(true)
  }

  const selectProduct = (productId: string) => {
    setEditMode(false)
    setSelectedProductId(productId)
    window.requestAnimationFrame(() => {
      detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      detailHeadingRef.current?.focus({ preventScroll: true })
      setDetailFocused(true)
      window.setTimeout(() => setDetailFocused(false), 1_200)
    })
  }

  const openCategoryModal = (category?: { id: string; name: string }) => {
    setCategoryDraft({ id: category?.id ?? '', name: category?.name ?? '' })
    setCategoryModalOpen(true)
  }

  const saveCategory = () => {
    if (!categoryDraft.name.trim()) {
      return
    }
    upsertCategory({ id: categoryDraft.id || undefined, name: categoryDraft.name })
    setCategoryDraft({ id: '', name: '' })
  }

  const removeCategory = (categoryId: string) => {
    const category = state.categories.find((item) => item.id === categoryId)
    const productCount = state.products.filter((product) => product.categoryId === categoryId).length
    if (!category) {
      return
    }

    if (productCount === 0) {
      if (window.confirm(`Delete the ${category.name} category?`)) {
        deleteCategory(categoryId)
      }
      return
    }

    const confirmation = window.prompt(
      `Deleting ${category.name} permanently removes ${productCount} product${productCount === 1 ? '' : 's'} and all of their stock records. Sales history remains. Type DELETE to continue.`,
    )
    if (confirmation === 'DELETE') {
      deleteCategory(categoryId, true)
      setCategoryDraft({ id: '', name: '' })
    }
  }

  const handleSaveProduct = () => {
    if (!productDraft.name.trim() || !productDraft.categoryId) {
      return
    }

    upsertProduct({
      id: productDraft.id ?? `product-${Date.now()}`,
      categoryId: productDraft.categoryId,
      name: productDraft.name,
      description: productDraft.description,
      isActive: productDraft.isActive,
      skuPrefix: productDraft.skuPrefix,
      colors: productDraft.colors,
      sizes: productDraft.sizes,
      costPriceCents: productDraft.costPriceCents,
      regularPriceCents: productDraft.regularPriceCents,
      createdAt: productDraft.id
        ? state.products.find((product) => product.id === productDraft.id)?.createdAt ?? new Date().toISOString()
        : new Date().toISOString(),
    })
    setProductModalOpen(false)
  }

  const handleToggleProduct = (product: Product) => {
    toggleProductActive(product.id)
    setToast(product.isActive ? `Disabled product “${product.name}”` : `Enabled product “${product.name}”`)
  }

  // --- Matrix edit mode ------------------------------------------------
  const startEdit = () => {
    if (!selectedProduct) {
      return
    }
    setEditColors(selectedProduct.colors)
    setEditSizes(selectedProduct.sizes)
    setEditSkuPrefix(selectedProduct.skuPrefix)
    setEditCostCents(selectedProduct.costPriceCents)
    setEditSellCents(selectedProduct.regularPriceCents)
    setNewColor('')
    setNewSize('')
    setEditMode(true)
  }

  const cancelEdit = () => {
    if (!selectedProduct) {
      return
    }
    setEditColors(selectedProduct.colors)
    setEditSizes(selectedProduct.sizes)
    setEditSkuPrefix(selectedProduct.skuPrefix)
    setEditCostCents(selectedProduct.costPriceCents)
    setEditSellCents(selectedProduct.regularPriceCents)
    setEditMode(false)
  }

  const saveMatrix = () => {
    if (!selectedProduct) {
      return
    }
    const colors = editColors.map((color) => color.trim()).filter((color) => color !== '')
    const sizes = editSizes.map((size) => size.trim()).filter((size) => size !== '')
    upsertProduct({
      ...selectedProduct,
      skuPrefix: editSkuPrefix.trim(),
      colors,
      sizes,
      costPriceCents: editCostCents,
      regularPriceCents: editSellCents,
    })
    setEditMode(false)
    setSelectedColor((previous) => (previous && colors.includes(previous) ? previous : (colors[0] ?? null)))
    setSelectedSize((previous) => (previous && sizes.includes(previous) ? previous : (sizes[0] ?? null)))
  }

  const updateEditValue = (kind: 'colors' | 'sizes', index: number, value: string) => {
    const setter = kind === 'colors' ? setEditColors : setEditSizes
    setter((previous) => previous.map((item, i) => (i === index ? value : item)))
  }

  const removeEditValue = (kind: 'colors' | 'sizes', index: number) => {
    const setter = kind === 'colors' ? setEditColors : setEditSizes
    setter((previous) => previous.filter((_, i) => i !== index))
  }

  const addEditValue = (kind: 'colors' | 'sizes') => {
    const value = (kind === 'colors' ? newColor : newSize).trim()
    if (!value) {
      return
    }
    const setter = kind === 'colors' ? setEditColors : setEditSizes
    setter((previous) => [...previous, value])
    if (kind === 'colors') {
      setNewColor('')
    } else {
      setNewSize('')
    }
  }

  // --- Add stock modal -------------------------------------------------
  const openStockModal = () => {
    setStockQty(1)
    setStockOpen(true)
  }

  const confirmStock = () => {
    if (!selectedVariant || !stockStoreId) {
      return
    }
    const qty = stockQty
    const store = state.stores.find((item) => item.id === stockStoreId)
    applyIntake({
      variantId: selectedVariant.id,
      storeId: stockStoreId,
      quantity: qty,
      costPriceCents: selectedProduct?.costPriceCents ?? 0,
      staffName: 'Admin',
    })
    setStockOpen(false)
    setToast(`Added ${qty} unit${qty === 1 ? '' : 's'} of ${displaySku || 'this item'} to ${store?.name ?? 'store'}`)
  }

  // --- Bulk selection --------------------------------------------------
  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((previous) =>
      previous.includes(productId) ? previous.filter((id) => id !== productId) : [...previous, productId],
    )
  }

  const clearBulkSelection = () => {
    setBulkMode(false)
    setSelectedProductIds([])
  }

  const applyBulkProductState = (nextActive: boolean) => {
    if (selectedProductIds.length === 0) {
      return
    }
    bulkToggleProductActive(selectedProductIds, nextActive)
    clearBulkSelection()
  }

  // --- Bulk delete -----------------------------------------------------
  const handleBulkDelete = async () => {
    if (selectedProductIds.length === 0) {
      return
    }
    const ids = [...selectedProductIds]
    setDeleting(true)
    const result = await deleteProducts(ids, false)
    setDeleting(false)
    if (result.ok) {
      setToast(`Deleted ${ids.length} product${ids.length === 1 ? '' : 's'}`)
      clearBulkSelection()
    } else if (result.reason === 'has_stock') {
      setDeleteWarnOpen(true)
    }
  }

  const confirmBulkDelete = async () => {
    const ids = [...selectedProductIds]
    setDeleteWarnOpen(false)
    setDeleting(true)
    const result = await deleteProducts(ids, true)
    setDeleting(false)
    if (result.ok) {
      setToast(`Deleted ${ids.length} product${ids.length === 1 ? '' : 's'}`)
      clearBulkSelection()
    }
  }

  const deleteWarningDrawer = (
    <Drawer
      open={deleteWarnOpen}
      size="sheet"
      title={selectedProductIds.length === 1 ? 'This product has items in stock' : 'Selected products have items in stock'}
      subtitle="These products are still carrying stock."
      onClose={() => setDeleteWarnOpen(false)}
      footer={
        <div className="modal-footer-actions">
          <button type="button" className="secondary-button" onClick={() => setDeleteWarnOpen(false)} disabled={deleting}>
            Cancel
          </button>
          <button type="button" className="primary-button danger-button" onClick={() => void confirmBulkDelete()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Force delete'}
          </button>
        </div>
      }
    >
      <p className="delete-warning-copy">
        {selectedProductIds.length === 1
          ? 'This product has items in stock across your stores. Deleting it also removes its current shelf stock and unsold variants.'
          : `${selectedProductIds.length} selected products have items in stock across your stores. Deleting them also removes their current shelf stock and unsold variants.`}
      </p>
      <p className="delete-warning-copy muted">Previously sold variants and their sales history are kept in the database.</p>
    </Drawer>
  )

  const categoryDrawer = (
    <Drawer
      open={categoryModalOpen}
      size="panel"
      title="Manage categories"
      subtitle="Create, rename, or remove product categories."
      onClose={() => setCategoryModalOpen(false)}
    >
      <div className="form-grid">
        <Field label={categoryDraft.id ? 'Category name' : 'New category'}>
          <div className="inline-actions">
            <input value={categoryDraft.name} onChange={(event) => setCategoryDraft((previous) => ({ ...previous, name: event.target.value }))} className="admin-input" placeholder="E.g. Dresses" />
            <button type="button" className="primary-button" onClick={saveCategory}>{categoryDraft.id ? 'Save' : 'Add'}</button>
          </div>
        </Field>
      </div>
      <div className="record-stack compact category-manager-list">
        {state.categories.map((category) => {
          const productCount = state.products.filter((product) => product.categoryId === category.id).length
          return (
            <div key={category.id} className="record-card stock-row">
              <div className="record-main">
                <strong>{category.name}</strong>
                <small>{productCount === 0 ? 'Unused category' : `${productCount} product${productCount === 1 ? '' : 's'} assigned`}</small>
              </div>
              <div className="record-actions compact-actions">
                <button type="button" className="text-button" onClick={() => openCategoryModal(category)}>Edit</button>
                <button type="button" className="text-button destructive-text" onClick={() => removeCategory(category.id)}>{productCount === 0 ? 'Delete' : 'Force delete'}</button>
              </div>
            </div>
          )
        })}
      </div>
    </Drawer>
  )

  const productDrawer = (
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
          <button type="button" className="primary-button" onClick={handleSaveProduct} disabled={state.categories.length === 0}>
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
          {state.categories.length === 0 ? (
            <p className="form-hint">Every product needs a category. Create one via “Add category” first.</p>
          ) : (
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
          )}
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={productDraft.isActive}
            onChange={(event) => setProductDraft((previous) => ({ ...previous, isActive: event.target.checked }))}
          />
          <span>Active</span>
        </label>
        <Field label="Description">
          <textarea
            value={productDraft.description}
            onChange={(event) => setProductDraft((previous) => ({ ...previous, description: event.target.value }))}
            className="admin-textarea"
            rows={4}
            placeholder="Write a short product summary"
          />
        </Field>
        <Field label="SKU prefix">
          <input
            value={productDraft.skuPrefix}
            onChange={(event) => setProductDraft((previous) => ({ ...previous, skuPrefix: event.target.value }))}
            className="admin-input"
            placeholder="E.g. LUNA"
          />
        </Field>
      </div>
    </Drawer>
  )

  const matrixEditor = (
    <div className="matrix-editor">
      <Field label="SKU code prefix">
        <input
          value={editSkuPrefix}
          onChange={(event) => setEditSkuPrefix(event.target.value)}
          className="admin-input"
          placeholder="E.g. LUNA"
        />
      </Field>

      <div className="matrix-edit-group">
        <span className="matrix-label">Colors</span>
        {editColors.length > 0 ? (
          <div className="matrix-edit-list">
            {editColors.map((value, index) => (
              <div className="matrix-edit-item" key={index}>
                <input
                  value={value}
                  onChange={(event) => updateEditValue('colors', index, event.target.value)}
                  className="admin-input"
                  aria-label={`Color ${index + 1}`}
                />
                <button type="button" className="mini-icon-btn" onClick={() => removeEditValue('colors', index)} title="Remove color" aria-label="Remove color">
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="form-hint">No colors added yet.</p>
        )}
        <div className="matrix-add-item">
          <input
            value={newColor}
            onChange={(event) => setNewColor(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addEditValue('colors')
              }
            }}
            className="admin-input"
            placeholder="Add color"
            aria-label="Add a new color"
          />
          <button type="button" className="mini-icon-btn add" onClick={() => addEditValue('colors')} title="Add color" aria-label="Add color">
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="matrix-edit-group">
        <span className="matrix-label">Sizes</span>
        {editSizes.length > 0 ? (
          <div className="matrix-edit-list">
            {editSizes.map((value, index) => (
              <div className="matrix-edit-item" key={index}>
                <input
                  value={value}
                  onChange={(event) => updateEditValue('sizes', index, event.target.value)}
                  className="admin-input"
                  aria-label={`Size ${index + 1}`}
                />
                <button type="button" className="mini-icon-btn" onClick={() => removeEditValue('sizes', index)} title="Remove size" aria-label="Remove size">
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="form-hint">No sizes added yet.</p>
        )}
        <div className="matrix-add-item">
          <input
            value={newSize}
            onChange={(event) => setNewSize(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addEditValue('sizes')
              }
            }}
            className="admin-input"
            placeholder="Add size"
            aria-label="Add a new size"
          />
          <button type="button" className="mini-icon-btn add" onClick={() => addEditValue('sizes')} title="Add size" aria-label="Add size">
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="matrix-edit-prices">
        <Field label="Cost price (₱)">
          <input
            type="number"
            min="0"
            value={editCostCents / 100}
            onChange={(event) => setEditCostCents(Math.max(0, Math.round(Number(event.target.value || 0) * 100)))}
            className="admin-input"
          />
        </Field>
        <Field label="Selling price (₱)">
          <input
            type="number"
            min="0"
            value={editSellCents / 100}
            onChange={(event) => setEditSellCents(Math.max(0, Math.round(Number(event.target.value || 0) * 100)))}
            className="admin-input"
          />
        </Field>
      </div>
      <p className="form-hint">
        Saving generates one variant (and SKU) for every color × size combination.
      </p>
    </div>
  )

  const stockDrawer = (
    <Drawer
      open={stockOpen}
      size="panel"
      title="Add stock"
      subtitle="Receive new pieces for the selected size."
      onClose={() => setStockOpen(false)}
      footer={
        <div className="modal-footer-actions stock-footer">
          <button type="button" className="secondary-button" onClick={() => setStockOpen(false)}>
            Cancel
          </button>
          <button type="button" className="primary-button stock-confirm" onClick={confirmStock} disabled={!selectedVariant || !stockStoreId || stockQty < 1}>
            Add {stockQty} unit{stockQty === 1 ? '' : 's'}
          </button>
        </div>
      }
    >
      <div className="stock-modal">
        <div className="stock-product-head">
          <strong className="stock-product-name">{selectedProduct?.name ?? 'Product'}</strong>
          <span className="stock-product-variant">
            {selectedColor
              ? `${selectedColor}${selectedSize ? ` · Size ${selectedSize}` : ''}`
              : selectedSize
                ? `Size ${selectedSize}`
                : '—'}
          </span>
          {displaySku ? <span className="stock-product-sku">SKU · {displaySku}</span> : null}
        </div>

        <Field label="Quantity to add">
          <input
            type="number"
            min="1"
            step="1"
            value={stockQty}
            onChange={(event) => setStockQty(Math.max(1, Math.round(Number(event.target.value || 1))))}
            className="admin-input"
          />
        </Field>

        <Field label="Store / location">
          {state.stores.length === 0 ? (
            <p className="form-hint">No stores yet. Add a store before receiving stock.</p>
          ) : (
            <select value={stockStoreId} onChange={(event) => setStockStoreId(event.target.value)} className="admin-select">
              {state.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name} ({store.code})
                </option>
              ))}
            </select>
          )}
        </Field>

        {!selectedVariant ? (
          <p className="form-hint">
            This combination isn’t created yet — save the color/size matrix once to generate its SKU before adding stock.
          </p>
        ) : null}
      </div>
    </Drawer>
  )

  if (!selectedProduct) {
    return (
      <div className="admin-page">
        <PageHeader title="Products" subtitle="Catalog and variant management." />
        <EmptyState
          title="No products yet"
          description="Create a category first, then add your first product."
          action={
            <div className="inline-actions">
              <button type="button" className="secondary-button" onClick={() => openCategoryModal()}>Add category</button>
              <button type="button" className="primary-button" onClick={() => openProductModal()}>Add product</button>
            </div>
          }
        />
        {categoryDrawer}
        {productDrawer}
      </div>
    )
  }

  return (
    <div className="admin-page product-page">
      <PageHeader
        title="Products"
        subtitle="Catalog, colors, sizes, and per-location stock."
        actions={
          <div className="inline-actions">
            <button type="button" className="secondary-button" onClick={() => openCategoryModal()}>
              Manage categories
            </button>
            <button type="button" className="primary-button" onClick={() => openProductModal()} aria-label="Add a new product">
              <Plus size={16} />
              Add product
            </button>
          </div>
        }
      />

      <div className="two-column-layout product-master-detail">
        {/* ---------------- Catalogue (≈40%) ---------------- */}
        <section className="admin-panel product-catalogue">
          <div className="catalogue-head">
            <h3>Catalogue</h3>
            <button
              type="button"
              className="secondary-button catalogue-select"
              onClick={() => (bulkMode ? clearBulkSelection() : setBulkMode(true))}
              aria-pressed={bulkMode}
            >
              {bulkMode ? 'Done' : 'Select'}
            </button>
          </div>

          <div className="search-box small catalogue-search">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search products"
              aria-label="Search products"
            />
          </div>

          <div className="catalogue-controls">
            <div className="chip-scroll catalogue-cat-row">
              <button
                type="button"
                className={`option-chip ${categoryFilter === 'all' ? 'active' : ''}`}
                onClick={() => setCategoryFilter('all')}
              >
                All
              </button>
              {state.categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`option-chip ${categoryFilter === category.id ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
            <button type="button" className="mini-icon-btn catalogue-add" onClick={() => openCategoryModal()} title="Add category" aria-label="Add category">
              <Plus size={18} />
            </button>
          </div>

          {bulkMode ? (
            <div className="bulk-selection-bar" role="toolbar" aria-label="Bulk product actions">
              <span className="selection-count">{selectedProductIds.length} selected</span>
              <button type="button" className="primary-button bulk-action-button" onClick={() => applyBulkProductState(true)} aria-label="Activate selected products" disabled={selectedProductIds.length === 0}>
                Activate
              </button>
              <button type="button" className="secondary-button bulk-action-button" onClick={() => applyBulkProductState(false)} aria-label="Deactivate selected products" disabled={selectedProductIds.length === 0}>
                Deactivate
              </button>
              <button type="button" className="secondary-button bulk-action-button bulk-delete-button" onClick={() => void handleBulkDelete()} aria-label="Delete selected products" disabled={selectedProductIds.length === 0 || deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" className="secondary-button bulk-action-button" onClick={() => setSelectedProductIds([])} aria-label="Clear product selections">
                Clear
              </button>
            </div>
          ) : null}

          <div className="record-stack catalogue-list">
            {visibleProducts.length > 0 ? (
              visibleProducts.map((product) => {
                const isSelected = selectedProductIds.includes(product.id)
                return (
                  <div
                    key={product.id}
                    role={bulkMode ? 'checkbox' : 'button'}
                    tabIndex={0}
                    aria-checked={bulkMode ? isSelected : undefined}
                    className={`record-card catalogue-item ${product.isActive ? '' : 'inactive'} ${selectedProduct?.id === product.id ? 'selected' : ''} ${bulkMode && isSelected ? 'bulk-selected' : ''}`}
                    onClick={() => {
                      if (bulkMode) {
                        toggleProductSelection(product.id)
                        return
                      }
                      selectProduct(product.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (bulkMode) {
                          toggleProductSelection(product.id)
                          return
                        }
                        selectProduct(product.id)
                      }
                    }}
                  >
                    {bulkMode ? (
                      <span className={`bulk-select-button ${isSelected ? 'selected' : ''}`} aria-hidden="true">
                        {isSelected ? '✓' : ''}
                      </span>
                    ) : null}
                    <div className="catalogue-item-main">
                      <strong className="catalogue-item-name">{product.name}</strong>
                      <span className="status-pill catalogue-item-cat">{categoryName(product.categoryId)}</span>
                    </div>
                    {!bulkMode ? <ChevronRight className="catalogue-chevron" size={18} /> : null}
                  </div>
                )
              })
            ) : (
              <EmptyState title="No matches" description="Adjust the search or filters to find the item you need." />
            )}
          </div>
        </section>

        {/* ---------------- Product details (≈60%) ---------------- */}
        <section ref={detailPanelRef} className={`admin-panel detail-panel product-details ${detailFocused ? 'detail-focused' : ''}`}>
          {selectedProduct ? (
            <>
              <div className="panel-header-row detail-header product-detail-head">
                <div className="detail-title-block">
                  <span className="detail-overline">Product details</span>
                  <h3 ref={detailHeadingRef} tabIndex={-1}>{selectedProduct.name}</h3>
                  <div className="product-tag-row">
                    <span className="status-pill">{categoryName(selectedProduct.categoryId)}</span>
                    <StatusBadge label={selectedProduct.isActive ? 'Active' : 'Inactive'} tone={selectedProduct.isActive ? 'success' : 'neutral'} />
                  </div>
                  <p className="product-description">{selectedProduct.description || 'No description provided.'}</p>
                </div>
                <div className="detail-head-tools">
                  <button type="button" className="mini-icon-btn" onClick={() => openProductModal(selectedProduct)} title="Edit product" aria-label="Edit product">
                    <PencilLine size={16} />
                  </button>
                  <button
                    type="button"
                    className="mini-icon-btn"
                    onClick={() => handleToggleProduct(selectedProduct)}
                    title={selectedProduct.isActive ? 'Deactivate product' : 'Activate product'}
                    aria-label={selectedProduct.isActive ? 'Deactivate product' : 'Activate product'}
                  >
                    {selectedProduct.isActive ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                </div>
              </div>

              <div className="detail-section">
                <div className="section-actions">
                  <div>
                    <h4>Variants and stock</h4>
                    <small>{editMode ? 'Editing color, size, SKU and pricing options.' : 'Pick a color and size to see its SKU and stock.'}</small>
                  </div>
                  {editMode ? (
                    <div className="inline-actions">
                      <button type="button" className="secondary-button" onClick={cancelEdit}>Cancel</button>
                      <button type="button" className="primary-button" onClick={saveMatrix}>
                        <Check size={16} />
                        Save
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="secondary-button matrix-edit-toggle" onClick={startEdit}>
                      <PencilLine size={14} />
                      Edit
                    </button>
                  )}
                </div>

                {editMode ? (
                  matrixEditor
                ) : (
                  <>
                    <div className="matrix-block">
                      <span className="matrix-label">Color</span>
                      {selectedProduct.colors.length > 0 ? (
                        <div className="matrix-options">
                          {selectedProduct.colors.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={`option-chip ${selectedColor === color ? 'active' : ''}`}
                              onClick={() => setSelectedColor(color)}
                            >
                              {color}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="form-hint">No colors yet. Press Edit to add color and size options.</p>
                      )}
                    </div>

                    <div className="matrix-block">
                      <span className="matrix-label">Size</span>
                      {selectedProduct.sizes.length > 0 ? (
                        <div className="matrix-options">
                          {selectedProduct.sizes.map((size) => (
                            <button
                              key={size}
                              type="button"
                              className={`option-chip ${selectedSize === size ? 'active' : ''}`}
                              onClick={() => setSelectedSize(size)}
                            >
                              {size}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="form-hint">No sizes yet. Press Edit to add size options.</p>
                      )}
                    </div>

                    <div className="matrix-stats">
                      <div className="matrix-stat"><span>Cost price</span><strong>{formatPeso(selectedProduct.costPriceCents)}</strong></div>
                      <div className="matrix-stat"><span>Regular selling price</span><strong>{formatPeso(selectedProduct.regularPriceCents)}</strong></div>
                    </div>

                    <div className="matrix-current">
                      <div className="matrix-current-sku">
                        <span>SKU</span>
                        <strong className="sku-mono">{displaySku || '—'}</strong>
                      </div>
                      <div className="matrix-current-stock">
                        <span>In stock</span>
                        <strong>{selectedInStock}</strong>
                      </div>
                    </div>

                    {selectedColor && selectedSize && !selectedVariant ? (
                      <p className="form-hint">This combination isn’t created yet — open Edit and save once to generate its SKU.</p>
                    ) : null}

                    <button type="button" className="primary-button add-stock-button" onClick={openStockModal} disabled={!selectedVariant}>
                      <Plus size={16} />
                      Add stock
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <EmptyState title="No product selected" description="Add a product or choose one from the catalog to manage its details." />
          )}
        </section>
      </div>

      {categoryDrawer}
      {productDrawer}
      {stockDrawer}
      {deleteWarningDrawer}
      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  )
}
