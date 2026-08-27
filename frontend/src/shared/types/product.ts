export type UnitStatus = 'available' | 'reserved' | 'in_transfer' | 'sold'

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
  code: string | null
  cost_price: number
  store_id: string
  status: UnitStatus
}
