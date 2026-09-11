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
  signIn: (identifier: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

/** Load the signed-in user's profile via the `get_current_user()` RPC. */
async function fetchProfile(): Promise<{ profile: CurrentUser | null; failed: boolean }> {
  const { data, error } = await supabase.rpc('get_current_user')
  // A transport/DB failure is NOT the same as "no profile": only a successful
  // call that returns nothing means the account is inactive.
  if (error) return { profile: null, failed: true }
  return { profile: (data as CurrentUser | null) ?? null, failed: false }
}

/**
 * Resolve a Supabase session into an app user.
 *
 * `get_current_user()` only returns a profile for ACTIVE staff members, so a
 * deactivated one (or an Auth user with no staff row) resolves to nothing.
 * Those sessions are signed out rather than left half-authenticated — a valid
 * token grants nothing anyway, since every RPC and every RLS policy re-checks
 * staff.is_active server-side.
 */
async function resolveSession(hasSession: boolean): Promise<CurrentUser | null> {
  if (!hasSession) return null
  const { profile, failed } = await fetchProfile()
  if (profile) return profile
  // Leave the session alone if we simply couldn't reach the server.
  if (!failed) await supabase.auth.signOut()
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const profile = await resolveSession(Boolean(data.session))
        if (alive) setUser(profile)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // Deferred: Supabase holds an internal lock while this callback runs, so
      // awaiting another auth call inline (the signOut in resolveSession) can
      // deadlock. This also means a member deactivated mid-session is signed
      // out on their next token refresh.
      setTimeout(() => {
        void resolveSession(Boolean(session)).then((profile) => {
          if (!alive) return
          setUser(profile)
          setLoading(false)
        })
      }, 0)
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signIn(identifier: string, password: string) {
    let email = identifier.trim()
    // The single login field accepts either an email or a display name. If the
    // value is not an email, resolve the display name to its linked account's
    // email (via resolve_login_identifier) before signing in.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      const { data } = await supabase.rpc('resolve_login_identifier', { p_identifier: identifier })
      const resolved = (data as { email?: string | null } | null)?.email
      if (resolved) email = resolved
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) return { error: error.message }

    // The password was accepted, but the app only lets in accounts that still
    // have an ACTIVE staff profile. Deactivating a member who has a login is
    // exactly how access is revoked, so say why instead of bouncing them back
    // to an unexplained login screen.
    const { profile, failed } = await fetchProfile()
    if (!profile) {
      await supabase.auth.signOut()
      return {
        error: failed
          ? 'Could not verify your account. Please try again.'
          : 'This account is inactive. Please ask an administrator.',
      }
    }
    setUser(profile)
    return { error: null }
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
