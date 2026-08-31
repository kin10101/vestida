import { ArrowUpRight, CheckCircle2, CircleDashed, Minus, X } from 'lucide-react'
import type { ReactNode } from 'react'

export type StatusTone = 'success' | 'warning' | 'neutral' | 'danger' | 'info'

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return <span className={`status-pill ${tone}`}>{label}</span>
}

export function MetricCard({
  title,
  value,
  helper,
  tone = 'neutral',
}: {
  title: string
  value: string
  helper: string
  tone?: StatusTone
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <span className="metric-card-label">{title}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field-shell">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="page-header-wrap">
      <div>
        <h2 className="page-title">{title}</h2>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <CircleDashed size={18} />
      <h4>{title}</h4>
      <p>{description}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  )
}

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'sheet',
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sheet' | 'panel'
}) {
  if (!open) {
    return null
  }

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className={`admin-modal ${size}`} onClick={(event) => event.stopPropagation()}>
        <div className="admin-modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="admin-modal-body">{children}</div>

        {footer ? <div className="admin-modal-footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="admin-toast" aria-live="polite">
      <div className="toast-copy">
        <CheckCircle2 size={16} />
        <span>{message}</span>
      </div>
      <button type="button" className="icon-button plain" onClick={onClose} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  )
}

export function SplitButtons({
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  primaryDisabled,
}: {
  primaryLabel: string
  secondaryLabel: string
  onPrimary: () => void
  onSecondary: () => void
  primaryDisabled?: boolean
}) {
  return (
    <div className="split-buttons">
      <button type="button" className="secondary-button" onClick={onSecondary}>
        <Minus size={16} />
        {secondaryLabel}
      </button>
      <button type="button" className="primary-button" onClick={onPrimary} disabled={primaryDisabled}>
        <ArrowUpRight size={16} />
        {primaryLabel}
      </button>
    </div>
  )
}
