import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '../shared/supabase/client'
import type { CurrentUser } from './currentUser'

interface AuthState {
  user: CurrentUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

/** Load the signed-in user's profile via the `get_current_user()` RPC. */
async function fetchProfile(): Promise<CurrentUser | null> {
  const { data, error } = await supabase.rpc('get_current_user')
  if (error || !data) return null
  return data as CurrentUser
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (data.session) {
          const profile = await fetchProfile()
          if (alive) setUser(profile)
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session) {
          const profile = await fetchProfile()
          if (alive) setUser(profile)
        } else if (alive) {
          setUser(null)
        }
        if (alive) setLoading(false)
      },
    )

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
