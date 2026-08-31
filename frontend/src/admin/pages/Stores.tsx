import { useMemo, useState } from 'react'
import { LockKeyhole, Plus, UserRoundCog } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import { Drawer, EmptyState, Field, PageHeader, StatusBadge } from '../ui'

const tabs = ['locations', 'staff', 'access'] as const

type StoreTab = (typeof tabs)[number]

export default function Stores() {
  const {
    state,
    upsertStore,
    toggleStoreActive,
    bulkToggleStoreActive,
    upsertStaff,
    toggleStaffActive,
    bulkToggleStaffActive,
    upsertStoreAccess,
    resetStoreAccess,
  } = useAdminData()
  const [tab, setTab] = useState<StoreTab>('locations')
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([])
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([])
  const [storeOpen, setStoreOpen] = useState(false)
  const [staffOpen, setStaffOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [storeDraft, setStoreDraft] = useState({ id: '', code: '', name: '', address: '', isActive: true })
  const [staffDraft, setStaffDraft] = useState({ id: '', name: '', title: '', storeId: state.stores[0]?.id ?? '', isActive: true, canCareOf: false })
  const [accessDraft, setAccessDraft] = useState({ storeId: state.stores[0]?.id ?? '', state: 'active' as 'active' | 'paused' | 'reset_required', note: '', lastResetAt: null as string | null })

  const storeAccessMap = useMemo(
    () => Object.fromEntries(state.storeAccess.map((item) => [item.storeId, item])),
    [state.storeAccess],
  )

  const openStoreForm = (store?: (typeof state.stores)[number]) => {
    if (store) {
      setStoreDraft({
        id: store.id,
        code: store.code,
        name: store.name,
        address: store.address,
        isActive: store.isActive,
      })
    } else {
      setStoreDraft({ id: '', code: '', name: '', address: '', isActive: true })
    }
    setStoreOpen(true)
  }

  const openStaffForm = (member?: (typeof state.staff)[number]) => {
    if (member) {
      setStaffDraft({
        id: member.id,
        name: member.name,
        title: member.title,
        storeId: member.storeId,
        isActive: member.isActive,
        canCareOf: member.canCareOf,
      })
    } else {
      setStaffDraft({ id: '', name: '', title: '', storeId: state.stores[0]?.id ?? '', isActive: true, canCareOf: false })
    }
    setStaffOpen(true)
  }

  const openAccessForm = (storeId: string) => {
    const entry = storeAccessMap[storeId]
    setAccessDraft({
      storeId,
      state: entry?.state ?? 'active',
      note: entry?.note ?? '',
      lastResetAt: entry?.lastResetAt ?? null,
    })
    setAccessOpen(true)
  }

  const clearBulkSelection = () => {
    setBulkMode(false)
    setBulkMenuOpen(false)
    setSelectedStoreIds([])
    setSelectedStaffIds([])
  }

  const toggleLocationSelection = (storeId: string) => {
    setSelectedStoreIds((previous) =>
      previous.includes(storeId) ? previous.filter((id) => id !== storeId) : [...previous, storeId],
    )
  }

  const toggleStaffSelection = (memberId: string) => {
    setSelectedStaffIds((previous) =>
      previous.includes(memberId) ? previous.filter((id) => id !== memberId) : [...previous, memberId],
    )
  }

  const applyBulkActiveState = (nextActive: boolean) => {
    const selectedIds = tab === 'locations' ? selectedStoreIds : selectedStaffIds
    if (selectedIds.length === 0) {
      return
    }

    if (!nextActive && !window.confirm(`Deactivate ${selectedIds.length} selected record${selectedIds.length === 1 ? '' : 's'}?`)) {
      return
    }

    if (tab === 'locations') {
      bulkToggleStoreActive(selectedIds, nextActive)
    } else {
      bulkToggleStaffActive(selectedIds, nextActive)
    }

    clearBulkSelection()
  }

  const handleTabChange = (nextTab: StoreTab) => {
    setTab(nextTab)
    setBulkMode(false)
    setBulkMenuOpen(false)
    setSelectedStoreIds([])
    setSelectedStaffIds([])
  }

  const handleBulkToggle = () => {
    if (!bulkMode) {
      setBulkMode(true)
      setBulkMenuOpen(false)
      return
    }

    clearBulkSelection()
  }

  const handleSaveStore = () => {
    if (!storeDraft.code.trim() || !storeDraft.name.trim()) {
      return
    }

    upsertStore({
      id: storeDraft.id || `store-${Date.now()}`,
      code: storeDraft.code,
      name: storeDraft.name,
      address: storeDraft.address,
      isActive: storeDraft.isActive,
      createdAt: storeDraft.id ? state.stores.find((store) => store.id === storeDraft.id)?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
    })
    setStoreOpen(false)
  }

  const handleSaveStaff = () => {
    if (!staffDraft.name.trim() || !staffDraft.title.trim()) {
      return
    }

    upsertStaff({
      id: staffDraft.id || `staff-${Date.now()}`,
      name: staffDraft.name,
      title: staffDraft.title,
      storeId: staffDraft.storeId,
      isActive: staffDraft.isActive,
      canCareOf: staffDraft.canCareOf,
      createdAt: staffDraft.id ? state.staff.find((item) => item.id === staffDraft.id)?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
    })
    setStaffOpen(false)
  }

  const handleSaveAccess = () => {
    upsertStoreAccess({
      storeId: accessDraft.storeId,
      state: accessDraft.state,
      lastResetAt: accessDraft.lastResetAt,
      note: accessDraft.note,
    })
    setAccessOpen(false)
  }

  return (
    <div className="admin-page stores-page">
      <PageHeader
        title="Stores"
        subtitle="Locations, staff assignments, and shared access state."
        actions={
          <div className="segment-wrap">
            {tabs.map((item) => (
              <button
                key={item}
                type="button"
                className={`segmented-tab ${tab === item ? 'active' : ''}`}
                onClick={() => handleTabChange(item)}
              >
                {item === 'locations' ? 'Locations' : item === 'staff' ? 'Staff' : 'Access'}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'locations' ? (
        <>
          <div className="manager-toolbar">
            <div className="toolbar-right full">
              <div className="bulk-toolbar">
                {!bulkMode ? (
                  <>
                    <button type="button" className="secondary-button bulk-mode-toggle desktop-only" onClick={handleBulkToggle} aria-label="Select locations for bulk activation or deactivation">
                      Select
                    </button>
                    <button type="button" className="secondary-button bulk-mode-toggle mobile-only" onClick={() => setBulkMenuOpen((previous) => !previous)} aria-label="Toggle bulk location actions">
                      {bulkMenuOpen ? 'Close' : 'Bulk'}
                    </button>
                    {bulkMenuOpen ? (
                      <button type="button" className="secondary-button bulk-mode-toggle mobile-menu" onClick={() => { setBulkMenuOpen(false); setBulkMode(true) }} aria-label="Select locations for bulk activation or deactivation">
                        Select
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button type="button" className="secondary-button bulk-mode-toggle" onClick={handleBulkToggle} aria-label="Done location bulk selection">
                    Done
                  </button>
                )}
              </div>
              <button type="button" className="primary-button" onClick={() => openStoreForm()} aria-label="Add a new location">
                <Plus size={16} />
                Add location
              </button>
            </div>
          </div>

          {bulkMode ? (
            <div className="bulk-selection-bar" role="toolbar" aria-label="Bulk location actions">
              <span className="selection-count">{selectedStoreIds.length} selected</span>
              <button type="button" className="primary-button bulk-action-button" onClick={() => applyBulkActiveState(true)} aria-label="Activate selected locations" disabled={selectedStoreIds.length === 0}>
                Activate
              </button>
              <button type="button" className="secondary-button bulk-action-button" onClick={() => applyBulkActiveState(false)} aria-label="Deactivate selected locations" disabled={selectedStoreIds.length === 0}>
                Deactivate
              </button>
              <button type="button" className="secondary-button bulk-action-button" onClick={() => setSelectedStoreIds([])} aria-label="Clear selected locations">
                Clear
              </button>
            </div>
          ) : null}

          <div className="record-stack compact">
            {state.stores.length > 0 ? (
              state.stores.map((store) => {
                const isSelected = selectedStoreIds.includes(store.id)
                return (
                  <div key={store.id} className={`record-card stock-row ${isSelected ? 'bulk-selected' : ''}`}>
                    {bulkMode ? (
                      <button
                        type="button"
                        className={`bulk-select-button ${isSelected ? 'selected' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleLocationSelection(store.id)
                        }}
                        aria-label={isSelected ? `Clear selection for ${store.name}` : `Select ${store.name}`}
                        aria-pressed={isSelected}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
                    ) : null}
                    <div className="record-main">
                      <strong>{store.name}</strong>
                      <small>
                        {store.code} · {store.address || 'No address on file'}
                      </small>
                    </div>
                    <div className="record-side column align-end">
                      <StatusBadge label={store.isActive ? 'Active' : 'Inactive'} tone={store.isActive ? 'success' : 'neutral'} />
                      <span>{storeAccessMap[store.id]?.state ?? 'active'}</span>
                    </div>
                    <div className="record-actions compact-actions">
                      <button type="button" className="text-button" onClick={() => openStoreForm(store)} aria-label={`Edit ${store.name}`}>
                        Edit
                      </button>
                      <button type="button" className="text-button" onClick={() => toggleStoreActive(store.id)} aria-label={store.isActive ? `Deactivate ${store.name}` : `Activate ${store.name}`}>
                        {store.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState title="No locations" description="Add the first store to your network." />
            )}
          </div>
        </>
      ) : null}

      {tab === 'staff' ? (
        <>
          <div className="manager-toolbar">
            <div className="toolbar-right full">
              <div className="bulk-toolbar">
                {!bulkMode ? (
                  <>
                    <button type="button" className="secondary-button bulk-mode-toggle desktop-only" onClick={handleBulkToggle} aria-label="Select staff records for bulk activation or deactivation">
                      Select
                    </button>
                    <button type="button" className="secondary-button bulk-mode-toggle mobile-only" onClick={() => setBulkMenuOpen((previous) => !previous)} aria-label="Toggle bulk staff actions">
                      {bulkMenuOpen ? 'Close' : 'Bulk'}
                    </button>
                    {bulkMenuOpen ? (
                      <button type="button" className="secondary-button bulk-mode-toggle mobile-menu" onClick={() => { setBulkMenuOpen(false); setBulkMode(true) }} aria-label="Select staff records for bulk activation or deactivation">
                        Select
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button type="button" className="secondary-button bulk-mode-toggle" onClick={handleBulkToggle} aria-label="Done staff bulk selection">
                    Done
                  </button>
                )}
              </div>
              <button type="button" className="primary-button" onClick={() => openStaffForm()} aria-label="Add a staff member">
                <UserRoundCog size={16} />
                Add staff
              </button>
            </div>
          </div>

          {bulkMode ? (
            <div className="bulk-selection-bar" role="toolbar" aria-label="Bulk staff actions">
              <span className="selection-count">{selectedStaffIds.length} selected</span>
              <button type="button" className="primary-button bulk-action-button" onClick={() => applyBulkActiveState(true)} aria-label="Activate selected staff records" disabled={selectedStaffIds.length === 0}>
                Activate
              </button>
              <button type="button" className="secondary-button bulk-action-button" onClick={() => applyBulkActiveState(false)} aria-label="Deactivate selected staff records" disabled={selectedStaffIds.length === 0}>
                Deactivate
              </button>
              <button type="button" className="secondary-button bulk-action-button" onClick={() => setSelectedStaffIds([])} aria-label="Clear selected staff records">
                Clear
              </button>
            </div>
          ) : null}

          <div className="record-stack compact">
            {state.staff.length > 0 ? (
              state.staff.map((member) => {
                const isSelected = selectedStaffIds.includes(member.id)
                return (
                  <div key={member.id} className={`record-card stock-row ${isSelected ? 'bulk-selected' : ''}`}>
                    {bulkMode ? (
                      <button
                        type="button"
                        className={`bulk-select-button ${isSelected ? 'selected' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleStaffSelection(member.id)
                        }}
                        aria-label={isSelected ? `Clear selection for ${member.name}` : `Select ${member.name}`}
                        aria-pressed={isSelected}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
                    ) : null}
                    <div className="record-main">
                      <strong>{member.name}</strong>
                      <small>
                        {member.title} · {state.stores.find((store) => store.id === member.storeId)?.name ?? 'Unknown'}
                      </small>
                    </div>
                    <div className="record-side column align-end">
                      <StatusBadge label={member.isActive ? 'Active' : 'Inactive'} tone={member.isActive ? 'success' : 'neutral'} />
                      <span>{member.canCareOf ? 'Care of' : 'Not eligible'}</span>
                    </div>
                    <div className="record-actions compact-actions">
                      <button type="button" className="text-button" onClick={() => openStaffForm(member)} aria-label={`Edit ${member.name}`}>
                        Edit
                      </button>
                      <button type="button" className="text-button" onClick={() => toggleStaffActive(member.id)} aria-label={member.isActive ? `Deactivate ${member.name}` : `Activate ${member.name}`}>
                        {member.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState title="No staff records" description="Add team members assigned to each boutique." />
            )}
          </div>
        </>
      ) : null}

      {tab === 'access' ? (
        <>
          <div className="manager-toolbar">
            <div className="toolbar-right full">
              <button type="button" className="primary-button" onClick={() => openAccessForm(state.stores[0]?.id ?? '')}>
                <LockKeyhole size={16} />
                Manage access
              </button>
            </div>
          </div>

          <div className="record-stack compact">
            {state.storeAccess.length > 0 ? (
              state.storeAccess.map((entry) => {
                const store = state.stores.find((item) => item.id === entry.storeId)
                return (
                  <div key={entry.storeId} className="record-card stock-row">
                    <div className="record-main">
                      <strong>{store?.name ?? 'Unknown store'}</strong>
                      <small>{entry.note || 'Shared login status not described.'}</small>
                    </div>
                    <div className="record-side column align-end">
                      <StatusBadge label={entry.state} tone={entry.state === 'active' ? 'success' : entry.state === 'paused' ? 'warning' : 'danger'} />
                      <span>{entry.lastResetAt ? new Date(entry.lastResetAt).toLocaleDateString('en-PH') : 'Never reset'}</span>
                    </div>
                    <div className="record-actions compact-actions">
                      <button type="button" className="text-button" onClick={() => openAccessForm(entry.storeId)}>
                        Edit
                      </button>
                      <button type="button" className="text-button" onClick={() => {
                        if (window.confirm('Reset the shared store access for this branch? This requires a fresh sign-in flow.')) {
                          resetStoreAccess(entry.storeId)
                        }
                      }}>
                        Reset
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState title="No access records" description="Access records are created automatically with each new store." />
            )}
          </div>
        </>
      ) : null}

      <Drawer
        open={storeOpen}
        size="sheet"
        title={storeDraft.id ? 'Edit location' : 'Add location'}
        subtitle="Keep the physical network current and active."
        onClose={() => setStoreOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setStoreOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveStore}>
              Save location
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Store code">
            <input value={storeDraft.code} onChange={(event) => setStoreDraft((previous) => ({ ...previous, code: event.target.value }))} className="admin-input" />
          </Field>
          <Field label="Store name">
            <input value={storeDraft.name} onChange={(event) => setStoreDraft((previous) => ({ ...previous, name: event.target.value }))} className="admin-input" />
          </Field>
          <Field label="Address">
            <input value={storeDraft.address} onChange={(event) => setStoreDraft((previous) => ({ ...previous, address: event.target.value }))} className="admin-input" />
          </Field>
          <label className="check-row large">
            <input type="checkbox" checked={storeDraft.isActive} onChange={(event) => setStoreDraft((previous) => ({ ...previous, isActive: event.target.checked }))} />
            <span>Active location</span>
          </label>
        </div>
      </Drawer>

      <Drawer
        open={staffOpen}
        size="sheet"
        title={staffDraft.id ? 'Edit staff' : 'Add staff'}
        subtitle="Record the people assigned to each boutique."
        onClose={() => setStaffOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setStaffOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveStaff}>
              Save staff
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Name">
            <input value={staffDraft.name} onChange={(event) => setStaffDraft((previous) => ({ ...previous, name: event.target.value }))} className="admin-input" />
          </Field>
          <Field label="Role">
            <input value={staffDraft.title} onChange={(event) => setStaffDraft((previous) => ({ ...previous, title: event.target.value }))} className="admin-input" />
          </Field>
          <Field label="Assigned location">
            <select value={staffDraft.storeId} onChange={(event) => setStaffDraft((previous) => ({ ...previous, storeId: event.target.value }))} className="admin-select">
              {state.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="check-row large">
            <input type="checkbox" checked={staffDraft.isActive} onChange={(event) => setStaffDraft((previous) => ({ ...previous, isActive: event.target.checked }))} />
            <span>Active staff member</span>
          </label>
          <label className="check-row large">
            <input type="checkbox" checked={staffDraft.canCareOf} onChange={(event) => setStaffDraft((previous) => ({ ...previous, canCareOf: event.target.checked }))} />
            <span>Care of eligibility</span>
          </label>
        </div>
      </Drawer>

      <Drawer
        open={accessOpen}
        size="sheet"
        title="Shared store access"
        subtitle="Manage the branch login without showing the password."
        onClose={() => setAccessOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setAccessOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveAccess}>
              Save access state
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Location">
            <select value={accessDraft.storeId} onChange={(event) => setAccessDraft((previous) => ({ ...previous, storeId: event.target.value }))} className="admin-select">
              {state.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={accessDraft.state} onChange={(event) => setAccessDraft((previous) => ({ ...previous, state: event.target.value as 'active' | 'paused' | 'reset_required' }))} className="admin-select">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="reset_required">Reset required</option>
            </select>
          </Field>
          <Field label="Note">
            <textarea value={accessDraft.note} onChange={(event) => setAccessDraft((previous) => ({ ...previous, note: event.target.value }))} className="admin-textarea" rows={3} />
          </Field>
        </div>
      </Drawer>
    </div>
  )
}
