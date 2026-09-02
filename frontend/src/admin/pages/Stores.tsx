import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Plus, UserRoundCog } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import type { Account } from '../data'
import { Drawer, EmptyState, Field, PageHeader, StatusBadge } from '../ui'

const tabs = ['locations', 'staff', 'accounts'] as const
type StoreTab = (typeof tabs)[number]

type StoreDraft = { id: string; code: string; name: string; isActive: boolean }
type StaffDraft = { id: string; name: string; title: string; storeId: string; isActive: boolean }
type AccountDraft = {
  authId: string
  displayName: string
  role: 'admin' | 'staff'
  storeId: string
  isActive: boolean
}

export default function Stores() {
  const {
    state,
    upsertStore,
    toggleStoreActive,
    deleteStore,
    upsertStaff,
    toggleStaffActive,
    deleteStaff,
    listAccounts,
    configureAccount,
  } = useAdminData()
  const [tab, setTab] = useState<StoreTab>('locations')
  const [storeOpen, setStoreOpen] = useState(false)
  const [staffOpen, setStaffOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountEditing, setAccountEditing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [staffStoreFilter, setStaffStoreFilter] = useState('all')
  const [storeDraft, setStoreDraft] = useState<StoreDraft>({ id: '', code: '', name: '', isActive: true })
  const [staffDraft, setStaffDraft] = useState<StaffDraft>({ id: '', name: '', title: '', storeId: '', isActive: true })
  const [accountDraft, setAccountDraft] = useState<AccountDraft>({ authId: '', displayName: '', role: 'staff', storeId: '', isActive: true })
  const [deletedStore, setDeletedStore] = useState<typeof state.stores[number] | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])

  const activeStores = useMemo(() => state.stores.filter((store) => !store.isDeleted), [state.stores])
  const filteredStaff = state.staff.filter((member) => staffStoreFilter === 'all' || member.storeId === staffStoreFilter)
  const unconfigured = useMemo(() => accounts.filter((account) => !account.staffId), [accounts])
  const deleteDependency = useMemo(() => {
    if (!deletedStore) return { staff: 0, inventory: 0 }
    return {
      staff: state.staff.filter((item) => item.storeId === deletedStore.id).length,
      inventory: state.inventoryUnits.filter((item) => item.storeId === deletedStore.id && item.status !== 'sold').length,
    }
  }, [deletedStore, state.inventoryUnits, state.staff])

  const storeName = (id: string | null | undefined) =>
    state.stores.find((store) => store.id === id)?.name ?? '—'

  // Fetch the Supabase account list whenever the Accounts tab is shown (and
  // after any admin state change while it is open, so a freshly configured
  // account reappears as configured).
  useEffect(() => {
    if (tab !== 'accounts') return
    let alive = true
    listAccounts()
      .then((rows) => {
        if (alive) setAccounts(rows)
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      alive = false
    }
  }, [tab, listAccounts])

  const openStoreForm = (store?: typeof state.stores[number]) => {
    setStoreDraft(store ? { id: store.id, code: store.code, name: store.name, isActive: store.isActive } : { id: '', code: '', name: '', isActive: true })
    setStoreOpen(true)
  }

  const openStaffForm = (member?: typeof state.staff[number]) => {
    setStaffDraft(member ? { id: member.id, name: member.name, title: member.title, storeId: member.storeId, isActive: member.isActive } : { id: '', name: '', title: '', storeId: activeStores[0]?.id ?? '', isActive: true })
    setStaffOpen(true)
  }

  const openAccountForm = (account?: Account) => {
    setAccountEditing(!!account)
    if (account) {
      setAccountDraft({
        authId: account.authId,
        displayName: account.displayName,
        role: account.role === 'admin' ? 'admin' : 'staff',
        storeId: account.role === 'admin' ? '' : (account.storeId ?? activeStores[0]?.id ?? ''),
        isActive: account.isActive,
      })
    } else {
      setAccountDraft({ authId: '', displayName: '', role: 'staff', storeId: activeStores[0]?.id ?? '', isActive: true })
    }
    setAccountOpen(true)
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

  const handleSaveAccount = async () => {
    if (!accountDraft.authId || !accountDraft.displayName.trim()) return
    if (accountDraft.role === 'staff' && !accountDraft.storeId) return
    const ok = await configureAccount({
      authId: accountDraft.authId,
      displayName: accountDraft.displayName.trim(),
      role: accountDraft.role,
      storeId: accountDraft.role === 'admin' ? null : accountDraft.storeId,
      isActive: accountDraft.isActive,
    })
    if (ok) {
      setAccountOpen(false)
    }
  }

  const toggleAccountActive = async (account: Account) => {
    if (!account.staffId) return
    await configureAccount({
      authId: account.authId,
      displayName: account.displayName,
      role: account.role === 'admin' ? 'admin' : 'staff',
      storeId: account.role === 'admin' ? null : account.storeId,
      isActive: !account.isActive,
    })
  }

  const handleDelete = async (force: boolean) => {
    if (!deletedStore) return
    const message = force
      ? `Force delete ${deletedStore.name}? This removes staff and unsold inventory. Historical sales and movements remain.`
      : `Delete ${deletedStore.name}? Historical records remain.`
    if (window.confirm(message)) {
      const ok = await deleteStore(deletedStore.id, force)
      if (ok) {
        setDeleteOpen(false)
        setDeletedStore(null)
      }
    }
  }

  const accountSaveDisabled =
    !accountDraft.authId || !accountDraft.displayName.trim() || (accountDraft.role === 'staff' && !accountDraft.storeId)
  const selectedUnconfigured = unconfigured.find((account) => account.authId === accountDraft.authId)

  return (
    <div className="admin-page stores-page">
      <PageHeader
        title="Stores"
        subtitle="Locations, staff assignments, and Supabase login accounts."
        actions={<div className="segment-wrap">{tabs.map((item) => <button key={item} type="button" className={`segmented-tab ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)}>{item === 'locations' ? 'Locations' : item === 'staff' ? 'Staff' : 'Accounts'}</button>)}</div>}
      />

      {tab === 'locations' ? <>
        <div className="manager-toolbar"><div className="toolbar-right full"><button type="button" className="primary-button" onClick={() => openStoreForm()}><Plus size={16} />Add location</button></div></div>
        <div className="record-stack compact">
          {activeStores.length > 0 ? activeStores.map((store) => <div key={store.id} className="record-card stock-row">
            <div className="record-main"><strong>{store.name}</strong><small>Code: {store.code}</small></div>
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
            <div className="record-main"><strong>{member.name}</strong><small>{member.title} - {storeName(member.storeId)}</small></div>
            <div className="record-side"><StatusBadge label={member.isActive ? 'Active' : 'Inactive'} tone={member.isActive ? 'success' : 'neutral'} /></div>
            <div className="record-actions compact-actions"><button type="button" className="text-button" onClick={() => openStaffForm(member)}>Edit</button><button type="button" className="text-button" onClick={() => toggleStaffActive(member.id)}>{member.isActive ? 'Deactivate' : 'Activate'}</button>{!member.isActive ? <button type="button" className="text-button danger-text-button" onClick={() => { if (window.confirm(`Delete ${member.name}?`)) deleteStaff(member.id) }}>Delete</button> : null}</div>
          </div>) : <EmptyState title="No staff records" description="No staff members match this store." />}
        </div>
      </> : null}

      {tab === 'accounts' ? <>
        <div className="manager-toolbar"><div className="toolbar-right full"><button type="button" className="primary-button" onClick={() => openAccountForm()} disabled={unconfigured.length === 0}><KeyRound size={16} />Add account</button></div></div>
        <div className="record-stack compact">
          {accounts.length > 0 ? accounts.map((account) => {
            const configured = !!account.staffId
            return <div key={account.authId} className="record-card stock-row">
              <div className="record-main">
                <strong>{configured ? account.displayName : account.email}</strong>
                <small>{configured
                  ? `${account.email} · ${account.role === 'admin' ? 'Admin (all stores)' : storeName(account.storeId)}`
                  : 'Login created in Supabase Auth — not configured yet'}</small>
              </div>
              <div className="record-side column align-end">
                {configured
                  ? <StatusBadge label={account.role === 'admin' ? 'Admin' : 'Staff'} tone={account.role === 'admin' ? 'info' : 'neutral'} />
                  : <StatusBadge label="No profile" tone="warning" />}
                {configured ? <StatusBadge label={account.isActive ? 'Active' : 'Inactive'} tone={account.isActive ? 'success' : 'neutral'} /> : null}
              </div>
              <div className="record-actions compact-actions">
                <button type="button" className="text-button" onClick={() => openAccountForm(account)}>{configured ? 'Edit' : 'Configure'}</button>
                {configured ? <button type="button" className="text-button" onClick={() => toggleAccountActive(account)}>{account.isActive ? 'Deactivate' : 'Activate'}</button> : null}
              </div>
            </div>
          }) : <EmptyState title="No login accounts" description="Create a login (email + password) in Supabase Auth, then configure its profile here." />}
        </div>
      </> : null}

      <Drawer open={storeOpen} size="sheet" title={storeDraft.id ? 'Edit location' : 'Add location'} subtitle="Keep the physical network current and active." onClose={() => setStoreOpen(false)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setStoreOpen(false)}>Cancel</button><button type="button" className="primary-button" onClick={handleSaveStore}>Save location</button></div>}>
        <div className="form-stack">
          <Field label="Store code"><input value={storeDraft.code} onChange={(event) => setStoreDraft((previous) => ({ ...previous, code: event.target.value }))} className="admin-input" /></Field>
          <Field label="Store name"><input value={storeDraft.name} onChange={(event) => setStoreDraft((previous) => ({ ...previous, name: event.target.value }))} className="admin-input" /></Field>
          <label className="check-row large"><input type="checkbox" checked={storeDraft.isActive} onChange={(event) => setStoreDraft((previous) => ({ ...previous, isActive: event.target.checked }))} /><span>Active location</span></label>
        </div>
      </Drawer>

      <Drawer open={staffOpen} size="sheet" title={staffDraft.id ? 'Edit staff' : 'Add staff'} subtitle="Record the people assigned to each boutique." onClose={() => setStaffOpen(false)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setStaffOpen(false)}>Cancel</button><button type="button" className="primary-button" onClick={handleSaveStaff}>Save staff</button></div>}>
        <div className="form-stack">
          <Field label="Name"><input value={staffDraft.name} onChange={(event) => setStaffDraft((previous) => ({ ...previous, name: event.target.value }))} className="admin-input" /></Field>
          <Field label="Role"><input value={staffDraft.title} onChange={(event) => setStaffDraft((previous) => ({ ...previous, title: event.target.value }))} className="admin-input" /></Field>
          <Field label="Assigned location"><select value={staffDraft.storeId} onChange={(event) => setStaffDraft((previous) => ({ ...previous, storeId: event.target.value }))} className="admin-select">{activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
          <label className="check-row large"><input type="checkbox" checked={staffDraft.isActive} onChange={(event) => setStaffDraft((previous) => ({ ...previous, isActive: event.target.checked }))} /><span>Active staff member</span></label>
        </div>
      </Drawer>

      <Drawer open={accountOpen} size="sheet" title={accountEditing ? 'Edit account' : 'Add account'} subtitle="Email and password are managed in Supabase Auth. Configure the profile, role, and store here." onClose={() => setAccountOpen(false)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setAccountOpen(false)}>Cancel</button><button type="button" className="primary-button" disabled={accountSaveDisabled} onClick={handleSaveAccount}>{accountEditing ? 'Save changes' : 'Add account'}</button></div>}>
        <div className="form-stack">
          {accountEditing ? (
            <Field label="Email (managed in Supabase Auth)"><div className="admin-input readonly-field">{accounts.find((account) => account.authId === accountDraft.authId)?.email ?? ''}</div></Field>
          ) : (
            <Field label="Supabase login" hint="Only logins created in Supabase Auth but not yet configured appear here.">
              {unconfigured.length === 0
                ? <div className="form-empty-hint">No new Supabase logins to configure. Create the login (email + password) in the Supabase Auth dashboard first — it will appear here afterwards.</div>
                : <select value={accountDraft.authId} onChange={(event) => setAccountDraft((previous) => ({ ...previous, authId: event.target.value }))} className="admin-select">{unconfigured.map((account) => <option key={account.authId} value={account.authId}>{account.email}</option>)}</select>}
            </Field>
          )}

          {!accountEditing && selectedUnconfigured ? <Field label="Chosen login"><div className="admin-input readonly-field">{selectedUnconfigured.email}</div></Field> : null}

          <Field label="Display name" hint="What this person is called in the app."><input value={accountDraft.displayName} onChange={(event) => setAccountDraft((previous) => ({ ...previous, displayName: event.target.value }))} className="admin-input" placeholder="e.g. Alyssa" /></Field>

          <Field label="Role"><select value={accountDraft.role} onChange={(event) => setAccountDraft((previous) => ({ ...previous, role: event.target.value as AccountDraft['role'], storeId: event.target.value === 'admin' ? '' : (previous.storeId || activeStores[0]?.id || '') }))} className="admin-select"><option value="staff">Staff</option><option value="admin">Admin</option></select></Field>

          {accountDraft.role === 'admin'
            ? <p className="form-note">Admins have access across all stores — no store assignment.</p>
            : <Field label="Assigned location"><select value={accountDraft.storeId} onChange={(event) => setAccountDraft((previous) => ({ ...previous, storeId: event.target.value }))} className="admin-select">{activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>}

          <label className="check-row large"><input type="checkbox" checked={accountDraft.isActive} onChange={(event) => setAccountDraft((previous) => ({ ...previous, isActive: event.target.checked }))} /><span>Active account</span></label>
        </div>
      </Drawer>

      <Drawer open={deleteOpen} size="sheet" title="Delete location" subtitle="The location remains a read-only Deleted store reference in historical records." onClose={() => setDeleteOpen(false)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setDeleteOpen(false)}>Cancel</button>{deleteDependency.staff + deleteDependency.inventory === 0 ? <button type="button" className="primary-button" onClick={() => handleDelete(false)}>Delete location</button> : <button type="button" className="secondary-button danger-button" onClick={() => handleDelete(true)}>Force delete</button>}</div>}>
        <div className="delete-summary">
          <p><strong>{deletedStore?.name}</strong> must be inactive before it can be deleted.</p>
          {deleteDependency.staff + deleteDependency.inventory > 0 ? <ul><li>{deleteDependency.staff} staff assignment(s)</li><li>{deleteDependency.inventory} unsold inventory unit(s)</li></ul> : <p>No operational records will be removed.</p>}
          <p>Force delete removes operational records only. Orders, payments, sales, and movement history remain.</p>
        </div>
      </Drawer>
    </div>
  )
}
