import { useHeaderTitleValue } from '../headerTitle'

export default function Receive() {
  useHeaderTitleValue('Receive Stock', 'Check in pieces arriving from another store.')
  return (
    <div className="staff-page">
      <div className="placeholder-note">
        Coming soon: pick an incoming transfer and confirm the pieces you
        receive.
      </div>
    </div>
  )
}
