export type UnitStatus = 'in_stock' | 'reserved' | 'sold' | 'damaged' | 'returned' | 'in_transit'

/** Top-level grouping, e.g. Barong, Suit, Pants. */
export interface Category {
  id: string
  name: string
}

/** A style, e.g. "Plain Barong". */
export interface Product {
  id: string
  category_id: string
  name: string
  description: string | null
}

/** A color + size combination of a product; holds the reference price. */
export interface ProductVariant {
  id: string
  product_id: string
  color: string
  size: string
  regular_price: number
}

/** One physical piece — the atomic unit of stock tracking. */
export interface InventoryUnit {
  id: string
  variant_id: string
  unit_code: string | null
  cost_price: number
  source_note: string | null
  current_store_id: string
  status: UnitStatus
}
