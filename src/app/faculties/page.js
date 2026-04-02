'use client';

import { useState } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import styles from './faculties.module.css';

export default function FacultiesPage() {
    const { state, dispatch, getDepartmentsWithFaculty } = useApp();
    const { faculties } = state;

    // Modal state
    const [showFacultyModal, setShowFacultyModal] = useState(false);
    const [showDeptModal, setShowDeptModal] = useState(false);
    const [editingFaculty, setEditingFaculty] = useState(null);
    const [editingDept, setEditingDept] = useState(null);

    // Form state
    const [facultyName, setFacultyName] = useState('');
    const [deptName, setDeptName] = useState('');
    const [deptFacultyId, setDeptFacultyId] = useState('');

    // Delete confirmation
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    // ---- Faculty CRUD ----
    const openAddFaculty = () => {
        setEditingFaculty(null);
        setFacultyName('');
        setShowFacultyModal(true);
    };

    const openEditFaculty = (fac) => {
        setEditingFaculty(fac);
        setFacultyName(fac.name);
        setShowFacultyModal(true);
    };

    const handleSaveFaculty = () => {
        if (!facultyName.trim()) return;
        if (editingFaculty) {
            dispatch({ type: ACTION_TYPES.UPDATE_FACULTY, payload: { id: editingFaculty.id, name: facultyName.trim() } });
        } else {
            dispatch({ type: ACTION_TYPES.ADD_FACULTY, payload: { name: facultyName.trim() } });
        }
        setShowFacultyModal(false);
    };

    const handleDeleteFaculty = (id) => {
        dispatch({ type: ACTION_TYPES.DELETE_FACULTY, payload: id });
        setDeleteConfirm(null);
    };

    // ---- Department CRUD ----
    const openAddDept = () => {
        setEditingDept(null);
        setDeptName('');
        setDeptFacultyId(faculties[0]?.id || '');
        setShowDeptModal(true);
    };

    const openEditDept = (dept) => {
        setEditingDept(dept);
        setDeptName(dept.name);
        setDeptFacultyId(dept.facultyId);
        setShowDeptModal(true);
    };

    const handleSaveDept = () => {
        if (!deptName.trim() || !deptFacultyId) return;
        if (editingDept) {
            dispatch({ type: ACTION_TYPES.UPDATE_DEPARTMENT, payload: { id: editingDept.id, name: deptName.trim(), facultyId: deptFacultyId } });
        } else {
            dispatch({ type: ACTION_TYPES.ADD_DEPARTMENT, payload: { name: deptName.trim(), facultyId: deptFacultyId } });
        }
        setShowDeptModal(false);
    };

    const handleDeleteDept = (id) => {
        dispatch({ type: ACTION_TYPES.DELETE_DEPARTMENT, payload: id });
        setDeleteConfirm(null);
    };

    // Count departments per faculty
    const deptCount = (facId) => state.departments.filter((d) => d.facultyId === facId).length;

    return (
        <div className={styles.page}>
            {/* Header */}
            <div className={styles.pageHeader}>
                <div>
                    <h2 className={styles.pageTitle}>Faculties & Departments</h2>
                    <p className={styles.pageSub}>Manage faculties and their associated departments.</p>
                </div>
                <div className={styles.headerActions}>
                    <button className="btn btn-secondary" onClick={openAddDept}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        Add Department
                    </button>
                    <button className="btn btn-primary" onClick={openAddFaculty}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        Add Faculty
                    </button>
                </div>
            </div>

            {/* Stats Bar */}
            <div className={styles.statsBar}>
                <div className={styles.stat}>
                    <span className={styles.statValue}>{faculties.length}</span>
                    <span className={styles.statLabel}>Faculties</span>
                </div>
                <div className={styles.stat}>
                    <span className={styles.statValue}>{getDepartmentsWithFaculty.length}</span>
                    <span className={styles.statLabel}>Departments</span>
                </div>
            </div>

            {/* Faculties Table */}
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Faculties</h3>
                <div className="table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Faculty Name</th>
                                <th>Departments</th>
                                <th style={{ width: 140 }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {faculties.map((fac) => (
                                <tr key={fac.id}>
                                    <td style={{ fontWeight: 500, color: 'var(--color-text)' }}>{fac.name}</td>
                                    <td>
                                        <span className="badge badge-primary">{deptCount(fac.id)} dept{deptCount(fac.id) !== 1 ? 's' : ''}</span>
                                    </td>
                                    <td>
                                        <div className={styles.actions}>
                                            <button className={styles.actionBtn} onClick={() => openEditFaculty(fac)} title="Edit">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                            </button>
                                            <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => setDeleteConfirm({ type: 'faculty', id: fac.id, name: fac.name })} title="Delete">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {faculties.length === 0 && (
                                <tr><td colSpan={3} className={styles.empty}>No faculties added yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Departments Table */}
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Departments</h3>
                <div className="table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Department Name</th>
                                <th>Faculty</th>
                                <th style={{ width: 140 }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {getDepartmentsWithFaculty.map((dept) => (
                                <tr key={dept.id}>
                                    <td style={{ fontWeight: 500, color: 'var(--color-text)' }}>{dept.name}</td>
                                    <td>{dept.facultyName}</td>
                                    <td>
                                        <div className={styles.actions}>
                                            <button className={styles.actionBtn} onClick={() => openEditDept(dept)} title="Edit">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                            </button>
                                            <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => setDeleteConfirm({ type: 'dept', id: dept.id, name: dept.name })} title="Delete">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {getDepartmentsWithFaculty.length === 0 && (
                                <tr><td colSpan={3} className={styles.empty}>No departments added yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Faculty Modal */}
            {showFacultyModal && (
                <div className="modal-overlay" onClick={() => setShowFacultyModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingFaculty ? 'Edit Faculty' : 'Add Faculty'}</h3>
                            <button className="modal-close" onClick={() => setShowFacultyModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Faculty Name</label>
                                <input className="form-input" value={facultyName} onChange={(e) => setFacultyName(e.target.value)} placeholder="e.g. Faculty of Science" autoFocus />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowFacultyModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSaveFaculty} disabled={!facultyName.trim()}>
                                {editingFaculty ? 'Save Changes' : 'Add Faculty'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Department Modal */}
            {showDeptModal && (
                <div className="modal-overlay" onClick={() => setShowDeptModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingDept ? 'Edit Department' : 'Add Department'}</h3>
                            <button className="modal-close" onClick={() => setShowDeptModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Department Name</label>
                                <input className="form-input" value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="e.g. Computer Science" autoFocus />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Parent Faculty</label>
                                <select className="form-select form-input" value={deptFacultyId} onChange={(e) => setDeptFacultyId(e.target.value)}>
                                    {faculties.map((f) => (
                                        <option key={f.id} value={f.id}>{f.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowDeptModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSaveDept} disabled={!deptName.trim() || !deptFacultyId}>
                                {editingDept ? 'Save Changes' : 'Add Department'}
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
                            <h3>Confirm Delete</h3>
                            <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                                Are you sure you want to delete <strong style={{ color: 'var(--color-text)' }}>{deleteConfirm.name}</strong>?
                                {deleteConfirm.type === 'faculty' && (
                                    <><br /><span style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>⚠ This will also remove all departments, courses, and schedules under this faculty.</span></>
                                )}
                                {deleteConfirm.type === 'dept' && (
                                    <><br /><span style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>⚠ This will also remove all courses and schedules in this department.</span></>
                                )}
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => deleteConfirm.type === 'faculty' ? handleDeleteFaculty(deleteConfirm.id) : handleDeleteDept(deleteConfirm.id)}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
