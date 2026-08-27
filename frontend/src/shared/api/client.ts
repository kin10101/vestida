// Placeholder API client.
//
// Later this wraps Supabase:
//   - simple reads via PostgREST
//   - compound writes (log_sale, receive_stock, transfer_stock) via RPC
//   - Row Level Security provides store scoping

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''

export async function apiGet<T>(path: string): Promise<T> {
  throw new Error(`API client not implemented yet (GET ${API_BASE_URL}${path})`)
}

export async function apiRpc<T>(fnName: string, args: unknown): Promise<T> {
  throw new Error(
    `API client not implemented yet (RPC ${fnName} ${JSON.stringify(args)})`,
  )
}
