import { useHeaderTitleValue } from '../headerTitle'

export default function History() {
  useHeaderTitleValue('Sales History', 'Past sales for this store.')
  return (
    <div className="staff-page">
      <div className="placeholder-note">
        Coming soon: searchable list of orders and payments.
      </div>
    </div>
  )
}
