import { useHeaderTitleValue } from '../headerTitle'

export default function Reserve() {
  useHeaderTitleValue('Reserve Item', 'Hold a piece for a customer.')
  return (
    <div>
      <div className="placeholder-note">
        Coming soon: pick a piece, set the hold, release or convert to a sale.
      </div>
    </div>
  )
}
