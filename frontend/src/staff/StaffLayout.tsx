import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, HelpCircle, LogOut, Phone, X } from 'lucide-react'
import { HeaderTitleProvider } from './headerTitleProvider'
import { useHeaderTitle } from './headerTitle'
import { useAuth } from '../auth/AuthContext'

// Owner's direct line — TODO: replace with Gina's real number.
const OWNER_PHONE = '+639170000000'

const HELP_SECTIONS = [
  {
    title: 'Log a Sale',
    steps: [
      'Tap Log a Sale, then pick Ready-made or Made-to-Order.',
      'Ready-made: find the piece, pick color and size, set the agreed price, add to order.',
      'Made-to-Order: describe the piece, set the price, add to order.',
      'Checkout: enter what was received, or tap "Full amount".',
      'A balance shows automatically when the amount is less than the total.',
    ],
  },
  {
    title: 'Check Stock',
    steps: ['Find a piece across stores and see each unit\'s status.'],
  },
  {
    title: 'Receive Stock',
    steps: ['Check in pieces arriving from another store and confirm what you received.'],
  },
  {
    title: 'Transfer Stock',
    steps: ['Send pieces to another store; every move is tracked.'],
  },
  {
    title: 'Sales History',
    steps: ['Review past orders and payments for this store.'],
  },
  {
    title: 'Reserve Item',
    steps: ['Hold a piece for a customer; release it or turn it into a sale later.'],
  },
  {
    title: 'Call the owner',
    steps: ['Tap "Gina" in the header to call her directly.'],
  },
]

function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="help-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            className="help-panel"
            role="dialog"
            aria-modal="true"
            aria-label="How to use this system"
            initial={{ opacity: 0, scale: 0.92, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ transformOrigin: 'top right' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="help-head">
              <h2 className="help-title">How to use this system</h2>
              <button
                type="button"
                className="help-close"
                onClick={onClose}
                aria-label="Close help"
              >
                <X size={20} />
              </button>
            </div>
            <div className="help-scroll">
              {HELP_SECTIONS.map((section) => (
                <section className="help-section" key={section.title}>
                  <h3 className="help-section-title">{section.title}</h3>
                  <ol className="help-steps">
                    {section.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Header() {
  const location = useLocation()
  const { title, subtitle } = useHeaderTitle()
  const { signOut } = useAuth()
  const [helpOpen, setHelpOpen] = useState(false)
  const isHome = location.pathname === '/staff'

  return (
    <>
      <header className="staff-header">
        {isHome ? (
          <span className="logo-badge">LGA</span>
        ) : (
          <Link className="back-button" to="/staff" aria-label="Back to home">
            <ArrowLeft size={22} />
          </Link>
        )}

        {isHome ? (
          <a className="gina-pill" href={`tel:${OWNER_PHONE}`}>
            <Phone size={16} />
            <span>Gina</span>
          </a>
        ) : (
          <div className="staff-header-title">
            <span className="staff-header-h">{title}</span>
            {subtitle && <span className="staff-header-sub">{subtitle}</span>}
          </div>
        )}

        <div className="staff-header-actions">
          {isHome && (
            <button
              type="button"
              className="settings-button"
              aria-label="Help"
              onClick={() => setHelpOpen(true)}
            >
              <HelpCircle size={22} />
            </button>
          )}
          <button
            type="button"
            className="settings-button"
            aria-label="Log out"
            title="Log out"
            onClick={() => void signOut()}
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  )
}

export default function StaffLayout() {
  return (
    <HeaderTitleProvider>
      <div className="staff-app">
        <Header />
        <main className="staff-main">
          <Outlet />
        </main>
      </div>
    </HeaderTitleProvider>
  )
}
