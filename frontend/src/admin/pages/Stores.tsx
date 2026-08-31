import { useMemo, useState } from 'react'
import { LockKeyhole, Plus, UserRoundCog } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import { Drawer, EmptyState, Field, PageHeader, StatusBadge } from '../ui'

const tabs = ['locations', 'staff', 'access'] as const
type StoreTab = (typeof tabs)[number]

type StoreDraft = { id: string; code: string; name: string; address: string; isActive: boolean }

export default function Stores() {
  const { state, upsertStore, toggleStoreActive, deleteStore, upsertStaff, toggleStaffActive, upsertStoreAccess, disconnectStoreDevice } = useAdminData()
  const [tab, setTab] = useState<StoreTab>('locations')
  const [storeOpen, setStoreOpen] = useState(false)
  const [staffOpen, setStaffOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [staffStoreFilter, setStaffStoreFilter] = useState('all')
  const [storeDraft, setStoreDraft] = useState<StoreDraft>({ id: '', code: '', name: '', address: '', isActive: true })
  const [staffDraft, setStaffDraft] = useState({ id: '', name: '', title: '', storeId: '', isActive: true, canCareOf: false })
  const [accessDraft, setAccessDraft] = useState({ storeId: '', username: '', password: '', isEnabled: true })
  const [deletedStore, setDeletedStore] = useState<typeof state.stores[number] | null>(null)

  const activeStores = useMemo(() => state.stores.filter((store) => !store.isDeleted), [state.stores])
  const storeAccessMap = useMemo(() => Object.fromEntries(state.storeAccess.map((item) => [item.storeId, item])), [state.storeAccess])
  const filteredStaff = state.staff.filter((member) => staffStoreFilter === 'all' || member.storeId === staffStoreFilter)
  const deleteDependency = useMemo(() => {
    if (!deletedStore) return { staff: 0, inventory: 0, access: 0 }
    return {
      staff: state.staff.filter((item) => item.storeId === deletedStore.id).length,
      inventory: state.inventoryUnits.filter((item) => item.storeId === deletedStore.id && item.status !== 'sold').length,
      access: state.storeAccess.filter((item) => item.storeId === deletedStore.id).length,
    }
  }, [deletedStore, state.inventoryUnits, state.staff, state.storeAccess])

  const openStoreForm = (store?: typeof state.stores[number]) => {
    setStoreDraft(store ? { id: store.id, code: store.code, name: store.name, address: store.address, isActive: store.isActive } : { id: '', code: '', name: '', address: '', isActive: true })
    setStoreOpen(true)
  }

  const openStaffForm = (member?: typeof state.staff[number]) => {
    setStaffDraft(member ? { id: member.id, name: member.name, title: member.title, storeId: member.storeId, isActive: member.isActive, canCareOf: member.canCareOf } : { id: '', name: '', title: '', storeId: activeStores[0]?.id ?? '', isActive: true, canCareOf: false })
    setStaffOpen(true)
  }

  const openAccessForm = (storeId: string) => {
    const entry = storeAccessMap[storeId]
    setAccessDraft({ storeId, username: entry?.username ?? '', password: '', isEnabled: entry?.isEnabled ?? true })
    setAccessOpen(true)
  }

  const handleSaveStore = () => {
    if (!storeDraft.code.trim() || !storeDraft.name.trim()) return
    upsertStore({ ...storeDraft, id: storeDraft.id || `store-${Date.now()}`, createdAt: storeDraft.id ? state.stores.find((store) => store.id === storeDraft.id)?.createdAt ?? new Date().toISOString() : new Date().toISOString() })
    setStoreOpen(false)
  }

  const handleSaveStaff = () => {
    if (!staffDraft.name.trim() || !staffDraft.title.trim() || !staffDraft.storeId) return
    upsertStaff({ ...staffDraft, id: staffDraft.id || `staff-${Date.now()}`, createdAt: staffDraft.id ? state.staff.find((item) => item.id === staffDraft.id)?.createdAt ?? new Date().toISOString() : new Date().toISOString() })
    setStaffOpen(false)
  }

  const handleSaveAccess = () => {
    if (!accessDraft.username.trim()) return
    const existing = storeAccessMap[accessDraft.storeId]
    upsertStoreAccess({ ...accessDraft, passwordUpdatedAt: existing?.passwordUpdatedAt ?? null, devices: existing?.devices ?? [] })
    setAccessOpen(false)
  }

  const handleDelete = (force: boolean) => {
    if (!deletedStore) return
    const message = force
      ? `Force delete ${deletedStore.name}? This removes staff, unsold inventory, credentials, and devices. Historical sales and movements remain.`
      : `Delete ${deletedStore.name}? Historical records remain.`
    if (window.confirm(message) && deleteStore(deletedStore.id, force)) {
      setDeleteOpen(false)
      setDeletedStore(null)
    }
  }

  return (
    <div className="admin-page stores-page">
      <PageHeader
        title="Stores"
        subtitle="Locations, staff assignments, and shared branch credentials."
        actions={<div className="segment-wrap">{tabs.map((item) => <button key={item} type="button" className={`segmented-tab ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)}>{item === 'locations' ? 'Locations' : item === 'staff' ? 'Staff' : 'Access'}</button>)}</div>}
      />

      {tab === 'locations' ? <>
        <div className="manager-toolbar"><div className="toolbar-right full"><button type="button" className="primary-button" onClick={() => openStoreForm()}><Plus size={16} />Add location</button></div></div>
        <div className="record-stack compact">
          {activeStores.length > 0 ? activeStores.map((store) => <div key={store.id} className="record-card stock-row">
            <div className="record-main"><strong>{store.name}</strong><small>{store.code} {store.address ? `- ${store.address}` : '- No address on file'}</small></div>
            <div className="record-side column align-end"><StatusBadge label={store.isActive ? 'Active' : 'Inactive'} tone={store.isActive ? 'success' : 'neutral'} /></div>
            <div className="record-actions compact-actions">
              <button type="button" className="text-button" onClick={() => openStoreForm(store)}>Edit</button>
              <button type="button" className="text-button" onClick={() => toggleStoreActive(store.id)}>{store.isActive ? 'Deactivate' : 'Activate'}</button>
              {!store.isActive ? <button type="button" className="text-button danger-text-button" onClick={() => { setDeletedStore(store); setDeleteOpen(true) }}>Delete</button> : null}
            </div>
          </div>) : <EmptyState title="No locations" description="Add the first store to your network." />}
        </div>
      </> : null}

      {tab === 'staff' ? <>
        <div className="manager-toolbar">
          <select value={staffStoreFilter} onChange={(event) => setStaffStoreFilter(event.target.value)} className="admin-select" aria-label="Filter staff by store">
            <option value="all">All stores</option>
            {activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
          <div className="toolbar-right"><button type="button" className="primary-button" onClick={() => openStaffForm()}><UserRoundCog size={16} />Add staff</button></div>
        </div>
        <div className="record-stack compact">
          {filteredStaff.length > 0 ? filteredStaff.map((member) => <div key={member.id} className="record-card stock-row">
            <div className="record-main"><strong>{member.name}</strong><small>{member.title} - {state.stores.find((store) => store.id === member.storeId)?.name ?? 'Deleted store'}</small></div>
            <div className="record-side column align-end"><StatusBadge label={member.isActive ? 'Active' : 'Inactive'} tone={member.isActive ? 'success' : 'neutral'} /><span>{member.canCareOf ? 'Care of' : 'Not eligible'}</span></div>
            <div className="record-actions compact-actions"><button type="button" className="text-button" onClick={() => openStaffForm(member)}>Edit</button><button type="button" className="text-button" onClick={() => toggleStaffActive(member.id)}>{member.isActive ? 'Deactivate' : 'Activate'}</button></div>
          </div>) : <EmptyState title="No staff records" description="No staff members match this store." />}
        </div>
      </> : null}

      {tab === 'access' ? <div className="record-stack compact">
        {activeStores.length > 0 ? activeStores.map((store) => {
          const entry = storeAccessMap[store.id]
          return <div key={store.id} className="record-card access-record">
            <div className="record-main"><strong>{store.name}</strong><small>{entry?.username ? `Username: ${entry.username}` : 'Credentials not set'}</small></div>
            <div className="record-side column align-end"><StatusBadge label={entry?.isEnabled ? 'Enabled' : 'Disabled'} tone={entry?.isEnabled ? 'success' : 'neutral'} /><span>{entry?.devices.length ?? 0} connected</span></div>
            <div className="record-actions compact-actions"><button type="button" className="text-button" onClick={() => openAccessForm(store.id)}><LockKeyhole size={16} />Edit credentials</button></div>
            {entry?.devices.length ? <div className="access-devices">{entry.devices.map((device) => <div key={device.id} className="access-device"><div><strong>{device.name}</strong><small>Last active {new Date(device.lastActiveAt).toLocaleDateString('en-PH')}</small></div><button type="button" className="text-button danger-text-button" onClick={() => { if (window.confirm(`Disconnect ${device.name}?`)) disconnectStoreDevice(store.id, device.id) }}>Disconnect</button></div>)}</div> : null}
          </div>
        }) : <EmptyState title="No locations" description="Add a store to manage its shared credentials." />}
      </div> : null}

      <Drawer open={storeOpen} size="sheet" title={storeDraft.id ? 'Edit location' : 'Add location'} subtitle="Keep the physical network current and active." onClose={() => setStoreOpen(false)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setStoreOpen(false)}>Cancel</button><button type="button" className="primary-button" onClick={handleSaveStore}>Save location</button></div>}>
        <div className="form-grid">
          <Field label="Store code"><input value={storeDraft.code} onChange={(event) => setStoreDraft((previous) => ({ ...previous, code: event.target.value }))} className="admin-input" /></Field>
          <Field label="Store name"><input value={storeDraft.name} onChange={(event) => setStoreDraft((previous) => ({ ...previous, name: event.target.value }))} className="admin-input" /></Field>
          <Field label="Address"><input value={storeDraft.address} onChange={(event) => setStoreDraft((previous) => ({ ...previous, address: event.target.value }))} className="admin-input" /></Field>
          <label className="check-row large"><input type="checkbox" checked={storeDraft.isActive} onChange={(event) => setStoreDraft((previous) => ({ ...previous, isActive: event.target.checked }))} /><span>Active location</span></label>
        </div>
      </Drawer>

      <Drawer open={staffOpen} size="sheet" title={staffDraft.id ? 'Edit staff' : 'Add staff'} subtitle="Record the people assigned to each boutique." onClose={() => setStaffOpen(false)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setStaffOpen(false)}>Cancel</button><button type="button" className="primary-button" onClick={handleSaveStaff}>Save staff</button></div>}>
        <div className="form-grid">
          <Field label="Name"><input value={staffDraft.name} onChange={(event) => setStaffDraft((previous) => ({ ...previous, name: event.target.value }))} className="admin-input" /></Field>
          <Field label="Role"><input value={staffDraft.title} onChange={(event) => setStaffDraft((previous) => ({ ...previous, title: event.target.value }))} className="admin-input" /></Field>
          <Field label="Assigned location"><select value={staffDraft.storeId} onChange={(event) => setStaffDraft((previous) => ({ ...previous, storeId: event.target.value }))} className="admin-select">{activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
          <label className="check-row large"><input type="checkbox" checked={staffDraft.isActive} onChange={(event) => setStaffDraft((previous) => ({ ...previous, isActive: event.target.checked }))} /><span>Active staff member</span></label>
          <label className="check-row large"><input type="checkbox" checked={staffDraft.canCareOf} onChange={(event) => setStaffDraft((previous) => ({ ...previous, canCareOf: event.target.checked }))} /><span>Care of eligibility</span></label>
        </div>
      </Drawer>

      <Drawer open={accessOpen} size="sheet" title="Shared store credentials" subtitle="The password is never shown after it is saved." onClose={() => setAccessOpen(false)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setAccessOpen(false)}>Cancel</button><button type="button" className="primary-button" onClick={handleSaveAccess}>Save credentials</button></div>}>
        <div className="form-grid">
          <Field label="Store"><select value={accessDraft.storeId} onChange={(event) => openAccessForm(event.target.value)} className="admin-select">{activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
          <Field label="Shared username"><input value={accessDraft.username} onChange={(event) => setAccessDraft((previous) => ({ ...previous, username: event.target.value }))} className="admin-input" /></Field>
          <Field label="New password" hint="Leave blank to keep the current password."><input type="password" value={accessDraft.password} onChange={(event) => setAccessDraft((previous) => ({ ...previous, password: event.target.value }))} className="admin-input" autoComplete="new-password" /></Field>
          <label className="check-row large"><input type="checkbox" checked={accessDraft.isEnabled} onChange={(event) => setAccessDraft((previous) => ({ ...previous, isEnabled: event.target.checked }))} /><span>Enable shared store login</span></label>
        </div>
      </Drawer>

      <Drawer open={deleteOpen} size="sheet" title="Delete location" subtitle="The location remains a read-only Deleted store reference in historical records." onClose={() => setDeleteOpen(false)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setDeleteOpen(false)}>Cancel</button>{deleteDependency.staff + deleteDependency.inventory + deleteDependency.access === 0 ? <button type="button" className="primary-button" onClick={() => handleDelete(false)}>Delete location</button> : <button type="button" className="secondary-button danger-button" onClick={() => handleDelete(true)}>Force delete</button>}</div>}>
        <div className="delete-summary">
          <p><strong>{deletedStore?.name}</strong> must be inactive before it can be deleted.</p>
          {deleteDependency.staff + deleteDependency.inventory + deleteDependency.access > 0 ? <ul><li>{deleteDependency.staff} staff assignment(s)</li><li>{deleteDependency.inventory} unsold inventory unit(s)</li><li>{deleteDependency.access} shared credential record(s)</li></ul> : <p>No operational records will be removed.</p>}
          <p>Force delete removes operational records only. Orders, payments, sales, and movement history remain.</p>
        </div>
      </Drawer>
    </div>
  )
}
