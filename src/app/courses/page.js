'use client';

import { useState, useEffect } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import { useAuth } from '@/context/AuthContext';
import { TablePageSkeleton } from '@/components/Skeleton/Skeleton';
import { isViewerRole, isGsAdmin } from '@/lib/roles';
import CourseEnrollmentModal from '@/components/CourseEnrollmentModal/CourseEnrollmentModal';
import styles from './courses.module.css';

const LEVELS = [100, 200, 300, 400, 500, 600, 700];

const SCOPES = {
    DEPARTMENTAL: 'DEPARTMENTAL',
    INTERFACULTY: 'INTERFACULTY',
    UNIVERSITY_WIDE: 'UNIVERSITY_WIDE',
};

export default function CoursesPage() {
    const { state, dispatch, getCoursesWithDetails } = useApp();
    const { faculties, departments } = state;
    const { addToast } = useToast();
    const { user } = useAuth();
    const role = user?.role;

    // Filters
    const [filterFaculty, setFilterFaculty] = useState('');
    const [filterDept, setFilterDept] = useState('');
    const [filterScope, setFilterScope] = useState('');
    const [search, setSearch] = useState('');

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    // Form state
    const [form, setForm] = useState({ code: '', title: '', creditLoad: 3, lecturers: '', departmentId: '', scope: SCOPES.DEPARTMENTAL, level: 100 });
    const [loading, setLoading] = useState(true);
    // course_id -> [{ id, course_id, department_id, level }]
    const [enrollmentsByCourse, setEnrollmentsByCourse] = useState(new Map());
    const [manageCourse, setManageCourse] = useState(null);

    useEffect(() => {
        let mounted = true;
        async function loadCourses() {
            try {
                const [courses, faculties, departments, enrollments] = await Promise.all([
                    apiClient.get('/timetable/courses').catch(() => []),
                    apiClient.get('/timetable/faculties?all=true').catch(() => []),
                    apiClient.get('/timetable/departments?all=true').catch(() => []),
                    apiClient.get('/timetable/enrollments').catch(() => [])
                ]);
                if (mounted) {
                    dispatch({
                        type: ACTION_TYPES.INIT_STATE,
                        payload: {
                            courses: (courses || []).map(c => ({
                                ...c,
                                creditLoad: c.credit_load,
                                departmentId: c.department_id,
                                scope: c.scope || SCOPES.DEPARTMENTAL,
                            })),
                            faculties: faculties || [],
                            departments: (departments || []).map(d => ({ ...d, facultyId: d.faculty_id }))
                        }
                    });
                    const map = new Map();
                    (enrollments || []).forEach((e) => {
                        if (!map.has(e.course_id)) map.set(e.course_id, []);
                        map.get(e.course_id).push(e);
                    });
                    setEnrollmentsByCourse(map);
                    setLoading(false);
                }
            } catch (e) {
                console.error('Failed to JIT load courses', e);
            }
        }
        loadCourses();
        return () => { mounted = false; };
    }, [dispatch]);

    const filteredDepts = filterFaculty
        ? departments.filter((d) => d.facultyId === filterFaculty)
        : departments;

    const filteredCourses = getCoursesWithDetails.filter((c) => {
        if (filterScope && c.scope !== filterScope) return false;
        if (filterFaculty && c.scope === SCOPES.DEPARTMENTAL) {
            const dept = departments.find((d) => d.id === c.departmentId);
            if (!dept || dept.facultyId !== filterFaculty) return false;
        }
        if (filterDept && c.scope === SCOPES.DEPARTMENTAL && c.departmentId !== parseInt(filterDept)) return false;
        if (search) {
            const q = search.toLowerCase();
            return c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || c.lecturers.some((l) => l.toLowerCase().includes(q));
        }
        return true;
    });

    const openAdd = () => {
        setEditing(null);
        setForm({
            code: '', title: '', creditLoad: 3, lecturers: '',
            departmentId: departments[0]?.id || '',
            scope: isGsAdmin(role) ? SCOPES.UNIVERSITY_WIDE : SCOPES.DEPARTMENTAL,
            level: isGsAdmin(role) ? null : 100,
        });
        setShowModal(true);
    };

    const openEdit = (course) => {
        setEditing(course);
        setForm({
            code: course.code,
            title: course.title,
            creditLoad: course.creditLoad,
            lecturers: course.lecturers.join(', '),
            departmentId: course.departmentId || departments[0]?.id || '',
            scope: course.scope || SCOPES.DEPARTMENTAL,
            level: course.level ?? 100,
        });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!form.code.trim() || !form.title.trim()) return;
        // Department required for non-university-wide courses
        if (form.scope !== SCOPES.UNIVERSITY_WIDE && !form.departmentId) return;
        // Level required for departmental and interfaculty
        if (form.scope !== SCOPES.UNIVERSITY_WIDE && (form.level === null || form.level === '' || form.level === undefined)) {
            addToast({ type: 'warning', title: 'Validation', message: 'Level is required for departmental and interfaculty courses.' });
            return;
        }

        try {
            const payload = {
                code: form.code.trim(),
                title: form.title.trim(),
                credit_load: parseInt(form.creditLoad) || 3,
                lecturers: form.lecturers.split(',').map((l) => l.trim()).filter(Boolean),
                department_id: form.scope === SCOPES.UNIVERSITY_WIDE ? null : (typeof form.departmentId === 'string' ? parseInt(form.departmentId) : form.departmentId),
                scope: form.scope,
                level: form.scope === SCOPES.UNIVERSITY_WIDE ? (form.level || null) : parseInt(form.level, 10),
            };

            if (editing) {
                await apiClient.put(`/timetable/courses/${editing.id}`, payload);
                dispatch({
                    type: ACTION_TYPES.UPDATE_COURSE,
                    payload: { id: editing.id, code: payload.code, title: payload.title, creditLoad: payload.credit_load, lecturers: payload.lecturers, departmentId: payload.department_id, scope: payload.scope, level: payload.level }
                });
            } else {
                const res = await apiClient.post('/timetable/courses', payload);
                dispatch({
                    type: ACTION_TYPES.ADD_COURSE,
                    payload: { id: res.id, code: res.code, title: res.title, creditLoad: res.credit_load, lecturers: res.lecturers, departmentId: res.department_id, scope: res.scope, level: res.level }
                });
            }
        } catch (e) {
            console.error('Failed to save course', e);
            addToast({ type: 'error', title: 'Error', message: e.message || 'Failed to save course.' });
        }
        setShowModal(false);
    };

    const handleDelete = async (id) => {
        try {
            await apiClient.delete(`/timetable/courses/${id}`);
            dispatch({ type: ACTION_TYPES.DELETE_COURSE, payload: id });
            setDeleteConfirm(null);
            addToast({ type: 'success', title: 'Course Deleted', message: 'The course was successfully deleted.' });
        } catch (e) {
            console.error('Failed to delete course', e);
            addToast({ type: 'error', title: 'Deletion Failed', message: e.message || 'An error occurred while deleting the course.' });
        }
    };

    // Departments offered to the Manage modal — own faculty for editor, all for admin.
    const manageableDepartments = role === 'SUPER_ADMIN'
        ? departments
        : (user?.faculty_id ? departments.filter((d) => d.facultyId === user.faculty_id) : []);

    const handleEnrollmentSaved = (courseId, fresh) => {
        setEnrollmentsByCourse((prev) => {
            const next = new Map(prev);
            if (fresh.length === 0) next.delete(courseId);
            else next.set(courseId, fresh);
            return next;
        });
    };

    // Scope badge renderer
    const ScopeBadge = ({ scope }) => {
        if (scope === SCOPES.UNIVERSITY_WIDE) return <span className={styles.generalBadge}>General</span>;
        if (scope === SCOPES.INTERFACULTY) return <span className={styles.interfacultyBadge}>Interfaculty</span>;
        return null;
    };

    // Placeholder text based on scope
    const getPlaceholder = (field) => {
        if (form.scope === SCOPES.UNIVERSITY_WIDE) return field === 'code' ? 'e.g. GST 111' : 'e.g. Use of English';
        if (form.scope === SCOPES.INTERFACULTY) return field === 'code' ? 'e.g. MTH 201' : 'e.g. Mathematical Methods';
        return field === 'code' ? 'e.g. CSC 301' : 'e.g. Operating Systems';
    };

    // Determine which scope options this user can see
    const canSetScope = role === 'SUPER_ADMIN' || role === 'FACULTY_EDITOR';
    const scopeOptions = role === 'SUPER_ADMIN'
        ? [SCOPES.DEPARTMENTAL, SCOPES.INTERFACULTY, SCOPES.UNIVERSITY_WIDE]
        : [SCOPES.DEPARTMENTAL, SCOPES.INTERFACULTY];
    const canAddCourse = !isViewerRole(role) && (isGsAdmin(role) || role === 'SUPER_ADMIN' || role === 'FACULTY_EDITOR');

    if (loading) return <TablePageSkeleton columns={5} rows={6} />;

    return (
        <div className={styles.page}>
            {/* Header */}
            <div className={styles.pageHeader}>
                <div />
                {canAddCourse && (
                    <button className="btn btn-primary" onClick={openAdd}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        Add Course
                    </button>
                )}
            </div>

            {/* Filters */}
            <div className={styles.filters}>
                {role === 'SUPER_ADMIN' && (
                    <div className={styles.filterGroup}>
                        <label className="form-label">Faculty</label>
                        <select className="form-select form-input" value={filterFaculty} onChange={(e) => { setFilterFaculty(e.target.value); setFilterDept(''); }}>
                            <option value="">All Faculties</option>
                            {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                    </div>
                )}
                <div className={styles.filterGroup}>
                    <label className="form-label">Department</label>
                    <select className="form-select form-input" value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                        <option value="">All Departments</option>
                        {filteredDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                </div>
                <div className={styles.filterGroup}>
                    <label className="form-label">Search</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input className="form-input" style={{ flex: 1 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by code, title, or lecturer..." />
                        <select
                            className="form-select form-input"
                            style={{ width: 'auto', minWidth: 130 }}
                            value={filterScope}
                            onChange={(e) => setFilterScope(e.target.value)}
                        >
                            <option value="">All Types</option>
                            <option value={SCOPES.DEPARTMENTAL}>Departmental</option>
                            <option value={SCOPES.INTERFACULTY}>Interfaculty</option>
                            <option value={SCOPES.UNIVERSITY_WIDE}>University-Wide</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Results Count */}
            <div className={styles.resultCount}>
                Showing <strong>{filteredCourses.length}</strong> of {getCoursesWithDetails.length} courses
                {filterScope && <span style={{ marginLeft: 6, color: filterScope === SCOPES.UNIVERSITY_WIDE ? '#eab308' : filterScope === SCOPES.INTERFACULTY ? '#6366f1' : 'var(--color-text-muted)' }}>• {filterScope === SCOPES.UNIVERSITY_WIDE ? 'University-Wide' : filterScope === SCOPES.INTERFACULTY ? 'Interfaculty' : 'Departmental'} courses</span>}
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
                                <td>
                                    <span className={styles.courseCode}>{c.code}</span>
                                    {c.level && <span className={styles.levelBadge}>{c.level}L</span>}
                                    <ScopeBadge scope={c.scope} />
                                </td>
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
                                    {(() => {
                                        const isOwnCourse = role === 'SUPER_ADMIN'
                                            || (isGsAdmin(role) && c.scope === SCOPES.UNIVERSITY_WIDE)
                                            || (user?.faculty_id && c.facultyId === user.faculty_id);
                                        const isCrossEnrollable = (c.scope === SCOPES.INTERFACULTY || c.scope === SCOPES.UNIVERSITY_WIDE) && !isOwnCourse;
                                        const enrollments = enrollmentsByCourse.get(c.id) || [];
                                        const myEnrollments = role === 'SUPER_ADMIN'
                                            ? enrollments
                                            : enrollments.filter((e) => {
                                                const dept = departments.find((d) => d.id === e.department_id);
                                                return dept && dept.facultyId === user?.faculty_id;
                                            });

                                        if (isOwnCourse && !isViewerRole(role)) {
                                            return (
                                                <div className={styles.actions}>
                                                    <button className={styles.actionBtn} onClick={() => openEdit(c)} title="Edit">
                                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                    </button>
                                                    <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => setDeleteConfirm(c)} title="Delete">
                                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                                    </button>
                                                </div>
                                            );
                                        }
                                        if (isCrossEnrollable && (role === 'FACULTY_EDITOR' || role === 'SUPER_ADMIN')) {
                                            return (
                                                <button
                                                    className={`btn ${myEnrollments.length > 0 ? 'btn-secondary' : 'btn-primary'}`}
                                                    style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                                                    onClick={() => setManageCourse(c)}
                                                >
                                                    {myEnrollments.length > 0 ? `Manage (${myEnrollments.length})` : 'Take'}
                                                </button>
                                            );
                                        }
                                        if (isCrossEnrollable && myEnrollments.length > 0) {
                                            return <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 500 }}>Taken ({myEnrollments.length})</span>;
                                        }
                                        return <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>—</span>;
                                    })()}
                                </td>
                            </tr>
                        ))}
                        {filteredCourses.length === 0 && (
                            <tr><td colSpan={8} className={styles.empty}>No courses match your filters.</td></tr>
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
                            {/* Course Type Selector */}
                            {canSetScope && (
                                <div className="form-group">
                                    <label className="form-label">Course Type</label>
                                    <div className={styles.segmentedControl} style={{ gridTemplateColumns: `repeat(${scopeOptions.length}, 1fr)` }}>
                                        <button
                                            type="button"
                                            className={`${styles.segment} ${form.scope === SCOPES.DEPARTMENTAL ? styles.segmentActive : ''}`}
                                            onClick={() => setForm({ ...form, scope: SCOPES.DEPARTMENTAL, departmentId: form.departmentId || departments[0]?.id || '' })}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
                                            Departmental
                                        </button>
                                        <button
                                            type="button"
                                            className={`${styles.segment} ${form.scope === SCOPES.INTERFACULTY ? styles.segmentActive : ''}`}
                                            onClick={() => setForm({ ...form, scope: SCOPES.INTERFACULTY, departmentId: form.departmentId || departments[0]?.id || '' })}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                                            Interfaculty
                                        </button>
                                        {role === 'SUPER_ADMIN' && (
                                            <button
                                                type="button"
                                                className={`${styles.segment} ${form.scope === SCOPES.UNIVERSITY_WIDE ? styles.segmentActive : ''}`}
                                                onClick={() => setForm({ ...form, scope: SCOPES.UNIVERSITY_WIDE })}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                                                University-Wide
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Info notes per scope */}
                            {form.scope === SCOPES.INTERFACULTY && (
                                <div className={styles.infoNote} style={{ background: 'rgba(99, 102, 241, 0.08)', borderColor: 'rgba(99, 102, 241, 0.18)', color: '#818cf8' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                                    This course belongs to the selected department but will be visible to all faculties.
                                </div>
                            )}


                            {form.scope === SCOPES.UNIVERSITY_WIDE && (
                                <div className={styles.infoNote}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                                    This is a central university course - no department required. Visible to all faculties.
                                </div>
                            )}

                            <div className="form-group">
                                <label className="form-label">Course Code</label>
                                <input className="form-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={getPlaceholder('code')} autoFocus />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Course Title</label>
                                <input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={getPlaceholder('title')} />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: form.scope === SCOPES.UNIVERSITY_WIDE ? '1fr' : '1fr 1fr', gap: '16px' }}>
                                <div className="form-group">
                                    <label className="form-label">Credit Load</label>
                                    <input className="form-input" type="number" min="1" max="12" value={form.creditLoad} onChange={(e) => setForm({ ...form, creditLoad: e.target.value })} />
                                </div>
                                {form.scope !== SCOPES.UNIVERSITY_WIDE && (
                                    <div className="form-group">
                                        <label className="form-label">Department</label>
                                        <select className="form-select form-input" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                                            {departments.map((d) => {
                                                const fac = faculties.find((f) => f.id === d.facultyId);
                                                return <option key={d.id} value={d.id}>{d.name} ({fac?.name})</option>;
                                            })}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    Level {form.scope !== SCOPES.UNIVERSITY_WIDE && <span style={{ color: 'var(--color-danger)' }}>*</span>}
                                </label>
                                <select
                                    className="form-select form-input"
                                    value={form.level ?? ''}
                                    onChange={(e) => setForm({ ...form, level: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
                                >
                                    {form.scope === SCOPES.UNIVERSITY_WIDE && <option value="">All levels</option>}
                                    {LEVELS.map((l) => (
                                        <option key={l} value={l}>{l} Level</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Lecturers (comma-separated)</label>
                                <input className="form-input" value={form.lecturers} onChange={(e) => setForm({ ...form, lecturers: e.target.value })} placeholder="e.g. Dr. Adebayo Ojo, Prof. Nwankwo" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSave}
                                disabled={
                                    !form.code.trim() ||
                                    !form.title.trim() ||
                                    (form.scope !== SCOPES.UNIVERSITY_WIDE && (form.level === null || form.level === ''))
                                }
                            >
                                {editing ? 'Save Changes' : 'Add Course'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {manageCourse && (
                <CourseEnrollmentModal
                    course={manageCourse}
                    departments={manageableDepartments}
                    faculties={faculties}
                    currentEnrollments={(enrollmentsByCourse.get(manageCourse.id) || []).filter((e) => {
                        if (role === 'SUPER_ADMIN') return true;
                        const dept = departments.find((d) => d.id === e.department_id);
                        return dept && dept.facultyId === user?.faculty_id;
                    })}
                    isSuperAdmin={role === 'SUPER_ADMIN'}
                    onClose={() => setManageCourse(null)}
                    onSaved={(fresh) => handleEnrollmentSaved(manageCourse.id, fresh)}
                />
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
                                Are you sure you want to delete <strong style={{ color: 'var(--color-text)' }}>{deleteConfirm.code} - {deleteConfirm.title}</strong>?
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
