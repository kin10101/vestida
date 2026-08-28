import { useHeaderTitleValue } from '../headerTitle'

export default function Stock() {
  useHeaderTitleValue('Check Stock', 'Find a piece, in this store or another.')
  return (
    <div className="staff-page">
      <div className="placeholder-note">
        Coming soon: search across stores and per-piece status.
      </div>
    </div>
  )
}
