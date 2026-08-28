import { useHeaderTitleValue } from '../headerTitle'

export default function Transfers() {
  useHeaderTitleValue('Transfer Stock', 'Send pieces to another store.')
  return (
    <div className="staff-page">
      <div className="placeholder-note">
        Coming soon: outgoing transfers and receiving stock from other stores.
      </div>
    </div>
  )
}
