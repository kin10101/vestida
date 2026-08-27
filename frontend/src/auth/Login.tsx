import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { FormEvent } from 'react'
import { signIn, type Role } from './currentUser'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loggedInAs, setLoggedInAs] = useState<Role | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const user = signIn(username, password)
    if (!user) {
      setError('Invalid username or password.')
      return
    }
    setLoggedInAs(user.role)
  }

  if (loggedInAs) {
    return (
      <Navigate to={loggedInAs === 'admin' ? '/admin' : '/staff'} replace />
    )
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>VESTIDA</h1>
        <p className="brand-mark">Store sign-in</p>

        <label htmlFor="login-username">Username</label>
        <input
          id="login-username"
          type="text"
          placeholder="staff or admin"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          placeholder="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="login-button">
          Sign In
        </button>

        <p className="login-hint">
          Demo accounts: <strong>staff</strong> / <strong>admin</strong> ·
          password <strong>password</strong>
        </p>
      </form>
    </div>
  )
}
