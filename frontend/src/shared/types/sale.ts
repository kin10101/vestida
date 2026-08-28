export type OrderType = 'ready_made' | 'made_to_order'

export type OrderStatus =
  | 'pending'
  | 'in_progress'
  | 'ready'
  | 'released'
  | 'cancelled'

export type PaymentMethod = 'cash' | 'gcash' | 'bank'

/** One sale — possibly several pieces paid together. */
export interface SaleOrder {
  id: string
  store_id: string
  staff_id: string
  customer_name: string
  order_type: OrderType
  status: OrderStatus
  agreed_total: number
  client_ref: string
  created_at: string
}

/** One piece on a sale, at its bargained price. */
export interface OrderLineItem {
  id: string
  order_id: string
  unit_id: string | null
  description: string
  agreed_price: number
}

/** A partial or full payment against an order (downpayment / balance). */
export interface Payment {
  id: string
  order_id: string
  amount: number
  method: PaymentMethod
  received_at: string
}
