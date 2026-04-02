'use client';

import { useState } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import styles from './courses.module.css';

export default function CoursesPage() {
    const { state, dispatch, getCoursesWithDetails } = useApp();
    const { faculties, departments } = state;

    // Filters
    const [filterFaculty, setFilterFaculty] = useState('');
    const [filterDept, setFilterDept] = useState('');
    const [search, setSearch] = useState('');

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    // Form state
    const [form, setForm] = useState({ code: '', title: '', creditLoad: 3, lecturers: '', departmentId: '' });

    const filteredDepts = filterFaculty
        ? departments.filter((d) => d.facultyId === filterFaculty)
        : departments;

    const filteredCourses = getCoursesWithDetails.filter((c) => {
        if (filterFaculty) {
            const dept = departments.find((d) => d.id === c.departmentId);
            if (!dept || dept.facultyId !== filterFaculty) return false;
        }
        if (filterDept && c.departmentId !== filterDept) return false;
        if (search) {
            const q = search.toLowerCase();
            return c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || c.lecturers.some((l) => l.toLowerCase().includes(q));
        }
        return true;
    });

    const openAdd = () => {
        setEditing(null);
        setForm({ code: '', title: '', creditLoad: 3, lecturers: '', departmentId: departments[0]?.id || '' });
        setShowModal(true);
    };

    const openEdit = (course) => {
        setEditing(course);
        setForm({
            code: course.code,
            title: course.title,
            creditLoad: course.creditLoad,
            lecturers: course.lecturers.join(', '),
            departmentId: course.departmentId,
        });
        setShowModal(true);
    };

    const handleSave = () => {
        if (!form.code.trim() || !form.title.trim() || !form.departmentId) return;
        const payload = {
            code: form.code.trim(),
            title: form.title.trim(),
            creditLoad: parseInt(form.creditLoad) || 3,
            lecturers: form.lecturers.split(',').map((l) => l.trim()).filter(Boolean),
            departmentId: form.departmentId,
        };
        if (editing) {
            dispatch({ type: ACTION_TYPES.UPDATE_COURSE, payload: { id: editing.id, ...payload } });
        } else {
            dispatch({ type: ACTION_TYPES.ADD_COURSE, payload });
        }
        setShowModal(false);
    };

    const handleDelete = (id) => {
        dispatch({ type: ACTION_TYPES.DELETE_COURSE, payload: id });
        setDeleteConfirm(null);
    };

    // Form dept options grouped by faculty
    const formDepts = filterFaculty
        ? departments.filter((d) => d.facultyId === filterFaculty)
        : departments;

    return (
        <div className={styles.page}>
            {/* Header */}
            <div className={styles.pageHeader}>
                <div>
                    <h2 className={styles.pageTitle}>Course Registry</h2>
                    <p className={styles.pageSub}>Register and manage courses across departments.</p>
                </div>
                <button className="btn btn-primary" onClick={openAdd}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Add Course
                </button>
            </div>

            {/* Filters */}
            <div className={styles.filters}>
                <div className={styles.filterGroup}>
                    <label className="form-label">Faculty</label>
                    <select className="form-select form-input" value={filterFaculty} onChange={(e) => { setFilterFaculty(e.target.value); setFilterDept(''); }}>
                        <option value="">All Faculties</option>
                        {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                </div>
                <div className={styles.filterGroup}>
                    <label className="form-label">Department</label>
                    <select className="form-select form-input" value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                        <option value="">All Departments</option>
                        {filteredDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                </div>
                <div className={styles.filterGroup}>
                    <label className="form-label">Search</label>
                    <input className="form-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by code, title, or lecturer..." />
                </div>
            </div>

            {/* Results Count */}
            <div className={styles.resultCount}>
                Showing <strong>{filteredCourses.length}</strong> of {getCoursesWithDetails.length} courses
            </div>

            {/* Table */}
            <div className="table-container">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Code</th>
                            <th>Title</th>
                            <th>Credits</th>
                            <th>Lecturers</th>
                            <th>Department</th>
                            <th>Faculty</th>
                            <th style={{ width: 100 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredCourses.map((c) => (
                            <tr key={c.id}>
                                <td><span className={styles.courseCode}>{c.code}</span></td>
                                <td style={{ fontWeight: 500, color: 'var(--color-text)' }}>{c.title}</td>
                                <td><span className="badge badge-primary">{c.creditLoad}</span></td>
                                <td>
                                    <div className={styles.lecturers}>
                                        {c.lecturers.map((l, i) => (
                                            <span key={i} className={styles.lecturerTag}>{l}</span>
                                        ))}
                                    </div>
                                </td>
                                <td>{c.departmentName}</td>
                                <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{c.facultyName}</td>
                                <td>
                                    <div className={styles.actions}>
                                        <button className={styles.actionBtn} onClick={() => openEdit(c)} title="Edit">
                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                        </button>
                                        <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => setDeleteConfirm(c)} title="Delete">
                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filteredCourses.length === 0 && (
                            <tr><td colSpan={7} className={styles.empty}>No courses match your filters.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editing ? 'Edit Course' : 'Add Course'}</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Course Code</label>
                                <input className="form-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. CSC 301" autoFocus />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Course Title</label>
                                <input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Operating Systems" />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div className="form-group">
                                    <label className="form-label">Credit Load</label>
                                    <input className="form-input" type="number" min="1" max="12" value={form.creditLoad} onChange={(e) => setForm({ ...form, creditLoad: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Department</label>
                                    <select className="form-select form-input" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                                        {departments.map((d) => {
                                            const fac = faculties.find((f) => f.id === d.facultyId);
                                            return <option key={d.id} value={d.id}>{d.name} ({fac?.name})</option>;
                                        })}
                                    </select>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Lecturers (comma-separated)</label>
                                <input className="form-input" value={form.lecturers} onChange={(e) => setForm({ ...form, lecturers: e.target.value })} placeholder="e.g. Dr. Adebayo Ojo, Prof. Nwankwo" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={!form.code.trim() || !form.title.trim()}>
                                {editing ? 'Save Changes' : 'Add Course'}
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
                            <h3>Delete Course</h3>
                            <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                                Are you sure you want to delete <strong style={{ color: 'var(--color-text)' }}>{deleteConfirm.code} — {deleteConfirm.title}</strong>?
                                <br /><span style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>⚠ All schedule items for this course will also be removed.</span>
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm.id)}>Delete Course</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
