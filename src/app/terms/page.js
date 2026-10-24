'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/Toast/Toast';
import { useConfirm } from '@/components/ConfirmModal/ConfirmContext';
import { TERMS_CHANGED_EVENT, newerSessionThan, sortSessions } from '@/lib/terms';
import styles from './terms.module.css';
import { TermsSkeleton } from '@/components/Skeleton/Skeleton';

export default function TermsPage() {
    const { user, loading: authLoading, realmConfig } = useAuth();
    // Blocked-slot days and semester names are the realm's.
    const lectureDays = realmConfig.lecture_days;
    const examDays = realmConfig.exam_days;
    const allDays = [...lectureDays, ...examDays.filter(d => !lectureDays.includes(d))];
    // Exam blocks are either one date or the same weekday every week of the exams.
    const emptyBlockedForm = { name: '', applies_to: 'LECTURE_ONLY', repeat: 'once', day_of_week: lectureDays[0], date: '', start_time: '', end_time: '', whole_day: false };
    const blockedDays = (form) => form.applies_to === 'EXAM_ONLY' ? examDays : form.applies_to === 'BOTH' ? allDays : lectureDays;
    const usesDate = (form) => form.applies_to === 'EXAM_ONLY' && form.repeat === 'once';
    const router = useRouter();
    const { addToast } = useToast();
    const confirm = useConfirm();

    const [sessions, setSessions] = useState([]);
    const [semestersMap, setSemestersMap] = useState({});
    const [expandedSessions, setExpandedSessions] = useState(new Set());
    const [loading, setLoading] = useState(true);

    const [sessionName, setSessionName] = useState('');
    const [addingSemFor, setAddingSemFor] = useState(null);
    const [semName, setSemName] = useState('');

    // Blocked Slots state
    const [blockedSlots, setBlockedSlots] = useState([]);
    const [showBlockedModal, setShowBlockedModal] = useState(false);
    const [editingSlot, setEditingSlot] = useState(null);
    const [blockedForm, setBlockedForm] = useState(emptyBlockedForm);
    const [deleteBlockedConfirm, setDeleteBlockedConfirm] = useState(null);

    // Older sessions can be added for archiving past timetables.
    const FIRST_SESSION_YEAR = 2000;
    const currentYear = new Date().getFullYear();
    const sessionOptions = Array.from({ length: currentYear + 2 - FIRST_SESSION_YEAR + 1 }, (_, i) => {
        const y = currentYear + 2 - i;
        return `${y}/${y + 1}`;
    }).filter(opt => !sessions.some(s => s.name === opt));

    // Find current semester for blocked slots
    const currentSession = sessions.find(s => s.is_current);
    const currentSemester = currentSession ? (semestersMap[currentSession.id] || []).find(s => s.is_current) : null;

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const sessList = sortSessions(await apiClient.get('/calendar/sessions'));
            setSessions(sessList);
            setSemestersMap({});
            setBlockedSlots([]);
            const current = sessList.find(s => s.is_current);
            if (current) {
                setExpandedSessions(new Set([current.id]));
                const semList = await apiClient.get(`/calendar/sessions/${current.id}/semesters`);
                setSemestersMap({ [current.id]: semList });
                // Load blocked slots for current semester
                const currentSem = semList.find(s => s.is_current);
                if (currentSem) {
                    const slots = await apiClient.get(`/timetable/blocked-slots?semester_id=${currentSem.id}`);
                    setBlockedSlots(slots || []);
                }
            }
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Error', message: 'Failed to load term configuration.' });
        }
        setLoading(false);
    };

    useEffect(() => {
        if (!authLoading) {
            if (!user) { router.push('/login'); return; }
            if (user.role !== 'SUPER_ADMIN') {
                router.push('/');
                addToast({ type: 'error', title: 'Unauthorized', message: 'Only Super Admins can manage terms.' });
                return;
            }
            // eslint-disable-next-line react-hooks/set-state-in-effect
            fetchInitialData();
        }
    }, [user, authLoading]);

    const fetchSemesters = async (sessId) => {
        if (semestersMap[sessId]) return;
        try {
            const semList = await apiClient.get(`/calendar/sessions/${sessId}/semesters`);
            setSemestersMap(prev => ({ ...prev, [sessId]: semList }));
        } catch (e) {
            console.error(e);
        }
    };

    const toggleExpand = async (sessId) => {
        const next = new Set(expandedSessions);
        if (next.has(sessId)) {
            next.delete(sessId);
            setAddingSemFor(null);
        } else {
            next.add(sessId);
            await fetchSemesters(sessId);
        }
        setExpandedSessions(next);
    };

    const handleAddSession = async () => {
        if (!sessionName.trim()) return;
        try {
            const res = await apiClient.post('/calendar/sessions', { name: sessionName.trim() });
            // New sessions are inactive until set as current.
            setSessions(prev => sortSessions([...prev, res]));
            setSessionName('');
            setExpandedSessions(prev => new Set([...prev, res.id]));
            setSemestersMap(prev => ({ ...prev, [res.id]: [] }));
            addToast({ type: 'success', title: 'Created', message: `${res.name} created. Set it as current when you're ready to use it.` });
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Error', message: 'Failed to create session.' });
        }
    };

    const handleAddSemester = async (sessId) => {
        if (!semName) return;
        try {
            const res = await apiClient.post('/calendar/semesters', { name: semName, session_id: sessId });
            setSemestersMap(prev => ({
                ...prev,
                [sessId]: [...(prev[sessId] || []), res]
            }));
            setSemName('');
            setAddingSemFor(null);
            addToast({ type: 'success', title: 'Created', message: 'Semester created.' });
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Error', message: 'Failed to create semester.' });
        }
    };

    const handleSetCurrentSession = async (sess) => {
        const newest = newerSessionThan(sess, sessions);
        const ok = await confirm({
            title: `Make ${sess.name} the current session?`,
            message: newest
                ? `${sess.name} is a past session. Its timetables are final, and ${newest.name} is the latest session. Only switch to ${sess.name} to view or correct its archive, and switch back when you're done.`
                : `Everyone will see and schedule against ${sess.name}. Its newest semester becomes the current semester.`,
            confirmLabel: newest ? 'Switch to past session' : 'Set as current',
            tone: newest ? 'danger' : 'primary',
        });
        if (!ok) return;
        try {
            await apiClient.put(`/calendar/sessions/${sess.id}/current`);
            window.dispatchEvent(new Event(TERMS_CHANGED_EVENT));
            addToast({ type: newest ? 'warning' : 'success', title: 'Current session changed', message: `${sess.name} is now the current session.` });
            await fetchInitialData();
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Error', message: e.message || 'Failed to change the current session.' });
        }
    };

    const handleSetCurrentSemester = async (sess, sem) => {
        const ok = await confirm({
            title: `Make ${sem.name} the current semester?`,
            message: `Everyone will see and schedule against ${sess.name} ${sem.name}.`,
            confirmLabel: 'Set as current',
            tone: 'primary',
        });
        if (!ok) return;
        try {
            await apiClient.put(`/calendar/semesters/${sem.id}/current`);
            window.dispatchEvent(new Event(TERMS_CHANGED_EVENT));
            addToast({ type: 'success', title: 'Current semester changed', message: `${sem.name} is now the current semester.` });
            await fetchInitialData();
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Error', message: e.message || 'Failed to change the current semester.' });
        }
    };

    // Blocked Slots handlers
    const openAddBlockedSlot = () => {
        if (editingSlot) {
            setEditingSlot(null);
            setBlockedForm(emptyBlockedForm);
        }
        setShowBlockedModal(true);
    };

    const openEditBlockedSlot = (slot) => {
        const form = {
            name: slot.name,
            applies_to: slot.applies_to,
            repeat: slot.date ? 'once' : 'weekly',
            day_of_week: slot.day_of_week || '',
            date: slot.date || '',
            start_time: slot.start_time?.slice(0, 5) || '',
            end_time: slot.end_time?.slice(0, 5) || '',
            whole_day: !slot.start_time,
        };
        if (!form.day_of_week) form.day_of_week = blockedDays(form)[0];
        setEditingSlot(slot);
        setBlockedForm(form);
        setShowBlockedModal(true);
    };

    const closeBlockedModal = () => {
        setShowBlockedModal(false);
        // Keep an unsaved new slot as a draft, but not an edit.
        if (editingSlot) {
            setEditingSlot(null);
            setBlockedForm(emptyBlockedForm);
        }
    };

    const handleSaveBlockedSlot = async () => {
        if (!blockedForm.name.trim() || !currentSemester) return;
        try {
            const isDate = usesDate(blockedForm);
            const payload = {
                name: blockedForm.name.trim(),
                day_of_week: isDate ? null : blockedForm.day_of_week,
                date: isDate ? blockedForm.date : null,
                start_time: blockedForm.whole_day ? null : blockedForm.start_time,
                end_time: blockedForm.whole_day ? null : blockedForm.end_time,
                applies_to: blockedForm.applies_to,
            };
            if (editingSlot) {
                const res = await apiClient.put(`/timetable/blocked-slots/${editingSlot.id}`, payload);
                setBlockedSlots(prev => prev.map(s => s.id === res.id ? res : s));
                addToast({ type: 'success', title: 'Updated', message: `Blocked slot "${res.name}" updated.` });
            } else {
                const res = await apiClient.post('/timetable/blocked-slots', { ...payload, semester_id: currentSemester.id });
                setBlockedSlots(prev => [...prev, res]);
                addToast({ type: 'success', title: 'Created', message: `Blocked slot "${res.name}" added.` });
            }
            setShowBlockedModal(false);
            setEditingSlot(null);
            setBlockedForm(emptyBlockedForm);
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Error', message: e.message || `Failed to ${editingSlot ? 'update' : 'create'} blocked slot.` });
        }
    };

    const handleDeleteBlockedSlot = async (id) => {
        try {
            await apiClient.delete(`/timetable/blocked-slots/${id}`);
            setBlockedSlots(prev => prev.filter(s => s.id !== id));
            setDeleteBlockedConfirm(null);
            addToast({ type: 'success', title: 'Deleted', message: 'Blocked slot removed.' });
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', title: 'Error', message: 'Failed to delete blocked slot.' });
        }
    };

    if (authLoading || loading) return <TermsSkeleton />;

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div />
            </div>

            {/* Academic Sessions */}
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Academic Sessions</h3>

                <div style={{ marginBottom: '20px', display: 'flex', gap: '8px' }}>
                    <select className="form-input" value={sessionName} onChange={(e) => setSessionName(e.target.value)}>
                        <option value="">- Select Academic Session -</option>
                        {sessionOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                    <button className="btn btn-primary" onClick={handleAddSession} disabled={!sessionName}>
                        Add Session
                    </button>
                </div>

                {sessions.length === 0 && (
                    <p style={{ color: 'var(--color-text-muted)', padding: '12px 0' }}>No sessions established.</p>
                )}
                {sessions.length > 0 && !currentSemester && (
                    <p className={styles.notice}>
                        {currentSession
                            ? `No current semester. Add a semester to ${currentSession.name} and set it as current to start scheduling.`
                            : 'No current session. Open a session and set it as current to start scheduling.'}
                    </p>
                )}
                <div className={styles.accordion}>
                    {sessions.map(s => {
                        const isOpen = expandedSessions.has(s.id);
                        const sems = semestersMap[s.id] || [];
                        const availSemOpts = realmConfig.semester_names.filter(
                            opt => !sems.some(sem => sem.name === opt)
                        );

                        return (
                            <div key={s.id} className={`${styles.accordionItem} ${s.is_current ? styles.accordionItemCurrent : ''}`}>
                                <button className={styles.accordionHeader} onClick={() => toggleExpand(s.id)}>
                                    <div className={styles.accordionHeaderLeft}>
                                        <span className={styles.accordionTitle}>{s.name}</span>
                                        <span className={`badge ${s.is_current ? styles.badgeSuccess : styles.badgeNeutral}`}>
                                            {s.is_current ? 'Current' : 'Inactive'}
                                        </span>
                                    </div>
                                    <svg
                                        width="18" height="18" viewBox="0 0 24 24" fill="none"
                                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                        style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                                    >
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                </button>

                                {isOpen && (
                                    <div className={styles.accordionBody}>
                                        {sems.length === 0 && (
                                            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '12px' }}>
                                                No semesters defined for this session.
                                            </p>
                                        )}
                                        <div className={styles.semesterList}>
                                            {sems.map(sem => (
                                                <div key={sem.id} className={styles.semesterChip}>
                                                    <span className={styles.semesterChipName}>{sem.name}</span>
                                                    <span className={`badge ${sem.is_current ? styles.badgeSuccess : styles.badgeNeutral}`}>
                                                        {sem.is_current ? 'Current' : 'Inactive'}
                                                    </span>
                                                    {s.is_current && !sem.is_current && (
                                                        <button
                                                            className="btn btn-secondary"
                                                            style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                                            onClick={() => handleSetCurrentSemester(s, sem)}
                                                        >
                                                            Set as current
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        {s.is_current ? (
                                            <>
                                                {availSemOpts.length > 0 && (
                                                    addingSemFor === s.id ? (
                                                        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                                            <select className="form-input" value={semName} onChange={(e) => setSemName(e.target.value)}>
                                                                <option value="">- Select Semester -</option>
                                                                {availSemOpts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                            </select>
                                                            <button className="btn btn-primary" onClick={() => handleAddSemester(s.id)} disabled={!semName}>
                                                                Add
                                                            </button>
                                                            <button className="btn btn-secondary" onClick={() => { setAddingSemFor(null); setSemName(''); }}>
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            className="btn btn-secondary"
                                                            style={{ marginTop: '12px' }}
                                                            onClick={() => { setAddingSemFor(s.id); setSemName(''); }}
                                                        >
                                                            + Add Semester
                                                        </button>
                                                    )
                                                )}
                                                {availSemOpts.length === 0 && (
                                                    <p style={{ fontSize: '0.8rem', color: '#10b981', marginTop: '8px' }}>✓ All semesters added</p>
                                                )}
                                            </>
                                        ) : (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
                                                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: 0 }}>
                                                    🔒 View only - set this session as current to add semesters or edit its timetables.
                                                </p>
                                                <button className="btn btn-secondary" onClick={() => handleSetCurrentSession(s)}>
                                                    Set as current session
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Blocked Slots */}
            <div className={styles.section}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--color-border)' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>Blocked Slots</h3>
                    <button className="btn btn-primary" onClick={openAddBlockedSlot} disabled={!currentSemester}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        Add Blocked Slot
                    </button>
                </div>

                {!currentSemester && (
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                        Set a current session and semester to manage blocked slots.
                    </p>
                )}

                {currentSemester && blockedSlots.length === 0 && (
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>No blocked slots for the current semester.</p>
                )}

                {blockedSlots.length > 0 && (
                    <div className="table-container">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Applies To</th>
                                    <th>Day / Date</th>
                                    <th>Time</th>
                                    <th style={{ width: 140 }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {blockedSlots.map(slot => (
                                    <tr key={slot.id}>
                                        <td style={{ fontWeight: 500 }}>{slot.name}</td>
                                        <td>
                                            <span className={`badge ${slot.applies_to === 'EXAM_ONLY' ? styles.badgeHoliday : styles.badgeExtracurricular}`}>
                                                {slot.applies_to === 'LECTURE_ONLY' ? ' Lectures' : slot.applies_to === 'EXAM_ONLY' ? 'Exams' : 'Both'}
                                            </span>
                                        </td>
                                        <td>{slot.date || `Every ${slot.day_of_week}`}</td>
                                        <td style={{ color: 'var(--color-text-muted)' }}>
                                            {slot.start_time && slot.end_time ? `${slot.start_time?.slice(0, 5)} – ${slot.end_time?.slice(0, 5)}` : 'Full Day'}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                    className="btn btn-secondary"
                                                    style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                                                    onClick={() => openEditBlockedSlot(slot)}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    className="btn btn-secondary"
                                                    style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                                                    onClick={() => setDeleteBlockedConfirm(slot)}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add / Edit Blocked Slot Modal */}
            {showBlockedModal && (
                <div className="modal-overlay" onClick={closeBlockedModal}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingSlot ? 'Edit Blocked Slot' : 'Add Blocked Slot'}</h3>
                            <button className="modal-close" onClick={closeBlockedModal}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Name</label>
                                <input
                                    className="form-input"
                                    value={blockedForm.name}
                                    onChange={(e) => setBlockedForm({ ...blockedForm, name: e.target.value })}
                                    placeholder="e.g. Jum'at Prayer, Sports Hour"
                                    autoFocus
                                />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div className="form-group">
                                    <label className="form-label">Applies To</label>
                                    <select
                                        className="form-select form-input"
                                        value={blockedForm.applies_to}
                                        onChange={(e) => {
                                            const next = { ...blockedForm, applies_to: e.target.value };
                                            const days = blockedDays(next);
                                            setBlockedForm({ ...next, day_of_week: days.includes(next.day_of_week) ? next.day_of_week : days[0] });
                                        }}
                                    >
                                        <option value="LECTURE_ONLY">Lecture Timetable</option>
                                        <option value="EXAM_ONLY">Exam Timetable</option>
                                        <option value="BOTH">Both Timetables</option>
                                    </select>
                                </div>
                                {blockedForm.applies_to === 'EXAM_ONLY' && (
                                    <div className="form-group">
                                        <label className="form-label">Repeats</label>
                                        <select
                                            className="form-select form-input"
                                            value={blockedForm.repeat}
                                            onChange={(e) => setBlockedForm({ ...blockedForm, repeat: e.target.value })}
                                        >
                                            <option value="once">One date</option>
                                            <option value="weekly">Every week</option>
                                        </select>
                                    </div>
                                )}
                                <div className="form-group">
                                    {usesDate(blockedForm) ? (
                                        <>
                                            <label className="form-label">Date</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={blockedForm.date || ''}
                                                onChange={(e) => setBlockedForm({ ...blockedForm, date: e.target.value })}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <label className="form-label">{blockedForm.applies_to === 'LECTURE_ONLY' ? 'Day of Week' : 'Every'}</label>
                                            <select
                                                className="form-select form-input"
                                                value={blockedForm.day_of_week}
                                                onChange={(e) => setBlockedForm({ ...blockedForm, day_of_week: e.target.value })}
                                            >
                                                {blockedDays(blockedForm).map(d => <option key={d} value={d}>{d}</option>)}
                                            </select>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="form-group" style={{ marginBottom: '8px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={blockedForm.whole_day}
                                        onChange={(e) => setBlockedForm({ ...blockedForm, whole_day: e.target.checked, start_time: '', end_time: '' })}
                                    />
                                    Whole Day
                                </label>
                            </div>
                            {!blockedForm.whole_day && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div className="form-group">
                                        <label className="form-label">Start Time</label>
                                        <input
                                            className="form-input"
                                            type="time"
                                            value={blockedForm.start_time}
                                            onChange={(e) => setBlockedForm({ ...blockedForm, start_time: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">End Time</label>
                                        <input
                                            className="form-input"
                                            type="time"
                                            value={blockedForm.end_time}
                                            onChange={(e) => setBlockedForm({ ...blockedForm, end_time: e.target.value })}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeBlockedModal}>Cancel</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSaveBlockedSlot}
                                disabled={!blockedForm.name.trim() || (!blockedForm.whole_day && (!blockedForm.start_time || !blockedForm.end_time)) || (usesDate(blockedForm) ? !blockedForm.date : !blockedForm.day_of_week)}
                            >
                                {editingSlot ? 'Save Changes' : 'Add Blocked Slot'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Blocked Slot Confirmation */}
            {deleteBlockedConfirm && (
                <div className="modal-overlay" onClick={() => setDeleteBlockedConfirm(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Delete Blocked Slot</h3>
                            <button className="modal-close" onClick={() => setDeleteBlockedConfirm(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                                Remove <strong style={{ color: 'var(--color-text)' }}>{deleteBlockedConfirm.name}</strong> ({deleteBlockedConfirm.type === 'HOLIDAY' ? deleteBlockedConfirm.date : deleteBlockedConfirm.day_of_week})?
                                <br /><span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Users will be able to schedule during this time again.</span>
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteBlockedConfirm(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => handleDeleteBlockedSlot(deleteBlockedConfirm.id)}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
