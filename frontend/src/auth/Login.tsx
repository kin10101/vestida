import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { FormEvent } from 'react'
import { useAuth } from './AuthContext'

export default function Login() {
  const { user, loading, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Already signed in → go straight to their side.
  if (!loading && user) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/staff'} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const result = await signIn(email, password)
    setSubmitting(false)
    if (result.error) {
      setError(result.error)
    }
    // On success, onAuthStateChange updates `user` and the redirect above fires.
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>VESTIDA</h1>
        <p className="brand-mark">Store sign-in</p>

        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          placeholder="you@vestida.ph"
          value={email}
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          placeholder="••••••••"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="login-button" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>

        <p className="login-hint">
          Sign in with your Supabase Auth account to open the store.
        </p>
      </form>
    </div>
  )
}
