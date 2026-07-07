'use client';

import { useState, useEffect } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import { useAuth } from '@/context/AuthContext';
import { TablePageSkeleton } from '@/components/Skeleton/Skeleton';
import { isViewerRole, isGsAdmin } from '@/lib/roles';
import styles from './rooms.module.css';

export default function RoomsPage() {
    const { state, dispatch } = useApp();
    const { rooms, faculties } = state;
    const { addToast } = useToast();
    const { user } = useAuth();
    const role = user?.role;

    // Search & sort
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState('name'); // 'custom' | 'name' | 'capacity' (defaulting to name ascending)
    const [filterFaculty, setFilterFaculty] = useState('');
    const [collapsedFaculties, setCollapsedFaculties] = useState(new Set());

    const toggleFaculty = (facId) => {
        setCollapsedFaculties((prev) => {
            const next = new Set(prev);
            if (next.has(facId)) {
                next.delete(facId);
            } else {
                next.add(facId);
            }
            return next;
        });
    };

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    // Form state
    const [form, setForm] = useState({ name: '', capacity: 100, facultyId: '', isLab: false });
    const [loading, setLoading] = useState(true);

    const normalizeRoom = (r) => ({ ...r, facultyId: r.faculty_id ?? r.facultyId ?? null, isLab: r.is_lab ?? r.isLab ?? false });

    useEffect(() => {
        let mounted = true;
        async function loadRooms() {
            try {
                const [rooms, faculties] = await Promise.all([
                    apiClient.get('/timetable/rooms').catch(() => []),
                    apiClient.get('/timetable/faculties').catch(() => [])
                ]);
                if (mounted) {
                    dispatch({ type: ACTION_TYPES.INIT_STATE, payload: { rooms: (rooms || []).map(normalizeRoom), faculties: faculties || [] } });
                    setLoading(false);
                }
            } catch (e) {
                console.error('Failed to JIT load rooms', e);
            }
        }
        loadRooms();
        return () => { mounted = false; };
    }, [dispatch]);

    const filteredRooms = [...rooms]
        .filter((r) => {
            if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
            if (filterFaculty && (r.facultyId || r.faculty_id) !== filterFaculty) return false;
            return true;
        })
        .sort((a, b) => {
            if (sortBy === 'capacity') return b.capacity - a.capacity;
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            return (a.display_order || 0) - (b.display_order || 0);
        });

    const isDraggable = sortBy === 'custom' && !search && !isViewerRole(role);

    const saveNewOrder = async (sortedList) => {
        try {
            const reorderPayload = {
                rooms: sortedList.map((r, idx) => ({ id: r.id, display_order: idx }))
            };
            const updatedRoomsRes = await apiClient.post('/timetable/rooms/reorder', reorderPayload);
            dispatch({ type: ACTION_TYPES.INIT_STATE, payload: { rooms: updatedRoomsRes.map(normalizeRoom) } });
        } catch (err) {
            console.error("Reorder failed", err);
            addToast({ type: 'error', title: 'Reorder Failed', message: 'Could not save the new room order.' });
        }
    };

    const handleMoveUp = (roomList, index) => {
        if (index === 0) return;
        const updatedGroup = [...roomList];
        const temp = updatedGroup[index - 1];
        updatedGroup[index - 1] = updatedGroup[index];
        updatedGroup[index] = temp;

        const otherRooms = rooms.filter(r => !updatedGroup.some(ug => ug.id === r.id));
        const mergedRooms = [...otherRooms, ...updatedGroup];

        dispatch({ type: ACTION_TYPES.INIT_STATE, payload: { rooms: mergedRooms } });
        saveNewOrder(mergedRooms);
    };

    const handleMoveDown = (roomList, index) => {
        if (index === roomList.length - 1) return;
        const updatedGroup = [...roomList];
        const temp = updatedGroup[index + 1];
        updatedGroup[index + 1] = updatedGroup[index];
        updatedGroup[index] = temp;

        const otherRooms = rooms.filter(r => !updatedGroup.some(ug => ug.id === r.id));
        const mergedRooms = [...otherRooms, ...updatedGroup];

        dispatch({ type: ACTION_TYPES.INIT_STATE, payload: { rooms: mergedRooms } });
        saveNewOrder(mergedRooms);
    };


    // Count scheduled items per room
    const scheduleCount = (roomId) => state.scheduleItems.filter((s) => s.roomId === roomId).length;

    const openAdd = () => {
        setEditing(null);
        setForm({ name: '', capacity: 100, facultyId: isGsAdmin(role) ? '' : (faculties[0]?.id || ''), isLab: false });
        setShowModal(true);
    };

    const openEdit = (room) => {
        setEditing(room);
        setForm({ name: room.name, capacity: room.capacity, facultyId: room.facultyId || '', isLab: !!room.isLab });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!form.name.trim() || !form.capacity) return;
        if (!form.facultyId && !isGsAdmin(role)) return;
        try {
            const payload = { name: form.name.trim(), capacity: parseInt(form.capacity) || 100, faculty_id: form.facultyId || null, is_lab: !!form.isLab };
            if (editing) {
                await apiClient.put(`/timetable/rooms/${editing.id}`, payload);
                dispatch({ type: ACTION_TYPES.UPDATE_ROOM, payload: { id: editing.id, name: payload.name, capacity: payload.capacity, facultyId: payload.faculty_id, isLab: payload.is_lab } });
            } else {
                const res = await apiClient.post('/timetable/rooms', payload);
                dispatch({ type: ACTION_TYPES.ADD_ROOM, payload: { id: res.id, name: res.name, capacity: res.capacity, facultyId: res.faculty_id, isLab: res.is_lab ?? payload.is_lab } });
            }
            setShowModal(false);
            addToast({ type: 'success', title: editing ? 'Room Updated' : 'Room Added', message: 'Room has been saved successfully.' });
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Save Failed', message: e.message || 'An error occurred while saving the room.' });
        }
    };

    const handleDelete = async (id) => {
        try {
            await apiClient.delete(`/timetable/rooms/${id}`);
            dispatch({ type: ACTION_TYPES.DELETE_ROOM, payload: id });
            setDeleteConfirm(null);
            addToast({ type: 'success', title: 'Room Deleted', message: 'The room was successfully deleted.' });
        } catch (e) {
            console.error('Failed to delete room', e);
            addToast({ type: 'error', title: 'Deletion Failed', message: e.message || 'An error occurred while deleting the room.' });
        }
    };

    // Capacity distribution
    const totalCapacity = rooms.reduce((a, r) => a + r.capacity, 0);
    const avgCapacity = rooms.length ? Math.round(totalCapacity / rooms.length) : 0;

    // Capacity tiers
    const getCapacityTier = (cap) => {
        if (cap >= 300) return { label: 'Large', cls: styles.tierLarge };
        if (cap >= 100) return { label: 'Medium', cls: styles.tierMedium };
        return { label: 'Small', cls: styles.tierSmall };
    };

    // Extract unique faculties from filtered rooms, then sort faculties alphabetically by name
    const activeFacIds = Array.from(new Set(filteredRooms.map(r => r.facultyId).filter(Boolean)));
    const activeFaculties = faculties
        .filter(f => activeFacIds.includes(f.id))
        .sort((a, b) => a.name.localeCompare(b.name));

    const showUnassigned = filteredRooms.some(r => !r.facultyId);
    const unassignedRooms = filteredRooms.filter(r => !r.facultyId);

    const renderRoomsTable = (roomList) => {
        return (
            <div className="table-container">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Room Name</th>
                            <th>Faculty</th>
                            <th>Capacity</th>
                            <th>Size</th>
                            <th>Bookings</th>
                            {isDraggable && <th style={{ width: 60, textAlign: 'center' }}>Order</th>}
                            <th style={{ width: 100 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {roomList.map((room, index) => {
                            const tier = getCapacityTier(room.capacity);
                            const bookings = scheduleCount(room.id);
                            const fac = faculties.find(f => f.id === room.facultyId);
                            return (
                                <tr key={room.id}>
                                    <td style={{ fontWeight: 500, color: 'var(--color-text)' }}>{room.name}</td>
                                    <td style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{fac?.name || '-'}</td>
                                    <td>
                                        {room.isLab ? (
                                            <span className={styles.labTag}>Lab</span>
                                        ) : (
                                            <div className={styles.capacityCell}>
                                                <span className={styles.capacityNum}>{room.capacity}</span>
                                                <div className={styles.capacityBar}>
                                                    <div className={styles.capacityFill} style={{ width: `${Math.min(100, (room.capacity / 600) * 100)}%` }} />
                                                </div>
                                            </div>
                                        )}
                                    </td>
                                    <td><span className={`${styles.tier} ${tier.cls}`}>{tier.label}</span></td>
                                    <td>
                                        {bookings > 0 ? (
                                            <span className="badge badge-primary">{bookings} slot{bookings !== 1 ? 's' : ''}</span>
                                        ) : (
                                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>No bookings</span>
                                        )}
                                    </td>
                                    {isDraggable && (
                                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                            <button
                                                onClick={() => handleMoveUp(roomList, index)}
                                                disabled={index === 0}
                                                style={{ background: 'transparent', border: '1px solid var(--color-border)', cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.3 : 1, padding: '2px 6px', borderRadius: '4px', marginRight: '4px' }}
                                                title="Move Up"
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                                            </button>
                                            <button
                                                onClick={() => handleMoveDown(roomList, index)}
                                                disabled={index === roomList.length - 1}
                                                style={{ background: 'transparent', border: '1px solid var(--color-border)', cursor: index === roomList.length - 1 ? 'not-allowed' : 'pointer', opacity: index === roomList.length - 1 ? 0.3 : 1, padding: '2px 6px', borderRadius: '4px' }}
                                                title="Move Down"
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                                            </button>
                                        </td>
                                    )}
                                    <td>
                                        {!isViewerRole(role) && (!isGsAdmin(role) || !room.facultyId) ? (
                                            <div className={styles.actions}>
                                                <button className={styles.actionBtn} onClick={() => openEdit(room)} title="Edit">
                                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                </button>
                                                <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => setDeleteConfirm(room)} title="Delete">
                                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                                </button>
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Read Only</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    if (loading) return <TablePageSkeleton columns={3} rows={6} />;

    return (
        <div className={styles.page}>
            {/* Header */}
            <div className={styles.pageHeader}>
                <div />
                {!isViewerRole(role) && (
                    <button className="btn btn-primary" onClick={openAdd}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        Add Room
                    </button>
                )}
            </div>

            {/* Stats */}
            <div className={styles.statsRow}>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>{rooms.length}</div>
                    <div className={styles.statLabel}>Total Rooms</div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>{totalCapacity.toLocaleString()}</div>
                    <div className={styles.statLabel}>Total Capacity</div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>{avgCapacity}</div>
                    <div className={styles.statLabel}>Avg. Capacity</div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>{rooms.filter((r) => r.capacity >= 300).length}</div>
                    <div className={styles.statLabel}>Large Venues</div>
                </div>
            </div>

            {/* Filters */}
            <div className={styles.filters}>
                <div className={styles.searchWrap}>
                    <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    <input className={styles.searchInput} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rooms..." />
                </div>
                <select className="form-select form-input" style={{ width: 180 }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="custom">Custom Order</option>
                    <option value="name">Sort by Name</option>
                    <option value="capacity">Sort by Capacity</option>
                </select>
                <select className="form-select form-input" style={{ width: 180 }} value={filterFaculty} onChange={(e) => setFilterFaculty(e.target.value)}>
                    <option value="">All Faculties</option>
                    {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
            </div>

            {/* Results */}
            <div className={styles.resultCount}>
                Showing <strong>{filteredRooms.length}</strong> of {rooms.length} rooms
            </div>

            {/* Accordion List */}
            <div className={styles.accordion}>
                {activeFaculties.map((fac) => {
                    const roomsInFac = filteredRooms.filter(r => r.facultyId === fac.id);
                    const isOpen = !collapsedFaculties.has(fac.id);
                    return (
                        <div key={fac.id} className={styles.accordionItem}>
                            <button className={styles.accordionHeader} onClick={() => toggleFaculty(fac.id)}>
                                <div className={styles.accordionHeaderLeft}>
                                    <span className={styles.accordionTitle}>{fac.name}</span>
                                    <span className={styles.accordionCount}>{roomsInFac.length} venue{roomsInFac.length !== 1 ? 's' : ''}</span>
                                </div>
                                <svg
                                    className={`${styles.accordionIcon} ${isOpen ? styles.accordionIconOpen : ''}`}
                                    width="18" height="18" viewBox="0 0 24 24" fill="none"
                                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                >
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </button>
                            {isOpen && (
                                <div className={styles.accordionBody}>
                                    {renderRoomsTable(roomsInFac)}
                                </div>
                            )}
                        </div>
                    );
                })}

                {showUnassigned && (
                    <div className={`${styles.accordionItem} ${styles.unassignedItem}`}>
                        <button className={`${styles.accordionHeader} ${styles.unassignedHeader}`} onClick={() => toggleFaculty('__unassigned__')}>
                            <div className={styles.accordionHeaderLeft}>
                                <span className={styles.accordionTitle}>Other / Unassigned Venues</span>
                                <span className={styles.accordionCount}>{unassignedRooms.length} venue{unassignedRooms.length !== 1 ? 's' : ''}</span>
                            </div>
                            <svg
                                className={`${styles.accordionIcon} ${!collapsedFaculties.has('__unassigned__') ? styles.accordionIconOpen : ''}`}
                                width="18" height="18" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </button>
                        {!collapsedFaculties.has('__unassigned__') && (
                            <div className={styles.accordionBody}>
                                {renderRoomsTable(unassignedRooms)}
                            </div>
                        )}
                    </div>
                )}

                {activeFaculties.length === 0 && !showUnassigned && (
                    <div className={styles.emptyContainer}>
                        No rooms match your search or filters.
                    </div>
                )}
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editing ? 'Edit Room' : 'Add Room'}</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Room Name</label>
                                <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. LT-A (Main Lecture Theatre)" autoFocus />
                            </div>
                            {!isGsAdmin(role) && (
                                <div className="form-group">
                                    <label className="form-label">Faculty</label>
                                    <select className="form-select form-input" value={form.facultyId} onChange={(e) => setForm({ ...form, facultyId: e.target.value })}>
                                        <option value="">Select Faculty...</option>
                                        {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Seating Capacity</label>
                                <input className="form-input" type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="e.g. 300" />
                            </div>
                            <div className="form-group">
                                <label className={styles.toggleRow}>
                                    <span className={styles.toggleText}>
                                        <span className="form-label" style={{ marginBottom: 2 }}>Lab</span>
                                        <span className={styles.toggleHint}>Mark this venue as a laboratory</span>
                                    </span>
                                    <input
                                        type="checkbox"
                                        className={styles.toggleInput}
                                        checked={!!form.isLab}
                                        onChange={(e) => setForm({ ...form, isLab: e.target.checked })}
                                    />
                                    <span className={styles.toggleSwitch} aria-hidden="true" />
                                </label>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={!form.name.trim() || (!form.facultyId && !isGsAdmin(role))}>
                                {editing ? 'Save Changes' : 'Add Room'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            {deleteConfirm && (
                <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Delete Room</h3>
                            <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                                Are you sure you want to delete <strong style={{ color: 'var(--color-text)' }}>{deleteConfirm.name}</strong> (capacity: {deleteConfirm.capacity})?
                                <br /><span style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>⚠ All schedule items booked in this room will also be removed.</span>
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm.id)}>Delete Room</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
