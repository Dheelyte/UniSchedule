'use client';

import { useState } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import styles from './rooms.module.css';

export default function RoomsPage() {
    const { state, dispatch } = useApp();
    const { rooms } = state;

    // Search & sort
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState('name'); // 'name' | 'capacity'

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    // Form state
    const [form, setForm] = useState({ name: '', capacity: 100 });

    const filteredRooms = rooms
        .filter((r) => {
            if (!search) return true;
            return r.name.toLowerCase().includes(search.toLowerCase());
        })
        .sort((a, b) => {
            if (sortBy === 'capacity') return b.capacity - a.capacity;
            return a.name.localeCompare(b.name);
        });

    // Count scheduled items per room
    const scheduleCount = (roomId) => state.scheduleItems.filter((s) => s.roomId === roomId).length;

    const openAdd = () => {
        setEditing(null);
        setForm({ name: '', capacity: 100 });
        setShowModal(true);
    };

    const openEdit = (room) => {
        setEditing(room);
        setForm({ name: room.name, capacity: room.capacity });
        setShowModal(true);
    };

    const handleSave = () => {
        if (!form.name.trim() || !form.capacity) return;
        const payload = { name: form.name.trim(), capacity: parseInt(form.capacity) || 100 };
        if (editing) {
            dispatch({ type: ACTION_TYPES.UPDATE_ROOM, payload: { id: editing.id, ...payload } });
        } else {
            dispatch({ type: ACTION_TYPES.ADD_ROOM, payload });
        }
        setShowModal(false);
    };

    const handleDelete = (id) => {
        dispatch({ type: ACTION_TYPES.DELETE_ROOM, payload: id });
        setDeleteConfirm(null);
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

    return (
        <div className={styles.page}>
            {/* Header */}
            <div className={styles.pageHeader}>
                <div>
                    <h2 className={styles.pageTitle}>Room Registry</h2>
                    <p className={styles.pageSub}>Manage lecture halls, labs, and examination rooms.</p>
                </div>
                <button className="btn btn-primary" onClick={openAdd}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Add Room
                </button>
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
                    <option value="name">Sort by Name</option>
                    <option value="capacity">Sort by Capacity</option>
                </select>
            </div>

            {/* Results */}
            <div className={styles.resultCount}>
                Showing <strong>{filteredRooms.length}</strong> of {rooms.length} rooms
            </div>

            {/* Table */}
            <div className="table-container">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Room Name</th>
                            <th>Capacity</th>
                            <th>Size</th>
                            <th>Bookings</th>
                            <th style={{ width: 100 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRooms.map((room) => {
                            const tier = getCapacityTier(room.capacity);
                            const bookings = scheduleCount(room.id);
                            return (
                                <tr key={room.id}>
                                    <td style={{ fontWeight: 500, color: 'var(--color-text)' }}>{room.name}</td>
                                    <td>
                                        <div className={styles.capacityCell}>
                                            <span className={styles.capacityNum}>{room.capacity}</span>
                                            <div className={styles.capacityBar}>
                                                <div className={styles.capacityFill} style={{ width: `${Math.min(100, (room.capacity / 600) * 100)}%` }} />
                                            </div>
                                        </div>
                                    </td>
                                    <td><span className={`${styles.tier} ${tier.cls}`}>{tier.label}</span></td>
                                    <td>
                                        {bookings > 0 ? (
                                            <span className="badge badge-primary">{bookings} slot{bookings !== 1 ? 's' : ''}</span>
                                        ) : (
                                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>No bookings</span>
                                        )}
                                    </td>
                                    <td>
                                        <div className={styles.actions}>
                                            <button className={styles.actionBtn} onClick={() => openEdit(room)} title="Edit">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                            </button>
                                            <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => setDeleteConfirm(room)} title="Delete">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredRooms.length === 0 && (
                            <tr><td colSpan={5} className={styles.empty}>No rooms match your search.</td></tr>
                        )}
                    </tbody>
                </table>
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
                            <div className="form-group">
                                <label className="form-label">Seating Capacity</label>
                                <input className="form-input" type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="e.g. 300" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={!form.name.trim()}>
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
