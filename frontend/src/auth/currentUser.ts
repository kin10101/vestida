export type Role = 'staff' | 'admin'

export interface CurrentUser {
  name: string
  role: Role
  storeCode: string
}

// Temporary hard-coded sign-in until Supabase Auth is wired up.
//
// Demo accounts (password is `password` for both):
//   username: staff  → staff side
//   username: admin  → admin side (Gina, the owner)
//
// `currentUser` starts as null — you must sign in first.
const ACCOUNTS: Record<string, CurrentUser> = {
  staff: { name: 'Staff', role: 'staff', storeCode: 'LGA' },
  admin: { name: 'Gina', role: 'admin', storeCode: 'LGA' },
}

const PASSWORD = 'password'

export let currentUser: CurrentUser | null = null

export function signIn(username: string, password: string): CurrentUser | null {
  const account = ACCOUNTS[username.trim().toLowerCase()]
  if (!account || password !== PASSWORD) {
    return null
  }
  currentUser = account
  return account
}

export function signOut(): void {
  currentUser = null
}
