'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { detectAllConflicts } from '@/lib/conflicts';
import { exportTimetablePDF } from '@/lib/pdfExport';
import { exportTimetableCSV } from '@/lib/csvExport';
import TimetableGrid from '@/components/TimetableGrid/TimetableGrid';
import { useToast } from '@/components/Toast/Toast';
import ExportModal from '@/components/ExportModal/ExportModal';
import TimetableStatusBadge from '@/components/TimetableStatusBadge/TimetableStatusBadge';
import RequestEditModal from '@/components/RequestEditModal/RequestEditModal';
import { isViewerRole } from '@/lib/roles';
import { useConfirm } from '@/components/ConfirmModal/ConfirmContext';
import { TimetableSkeleton } from '@/components/Skeleton/Skeleton';
import styles from './lectures.module.css';

export default function LectureTimetablePage() {
    const { getSchedulesWithDetails, state, dispatch } = useApp();
    const { user } = useAuth();
    const { addToast } = useToast();
    const confirm = useConfirm();

    const [sessions, setSessions] = useState([]);
    const [semesters, setSemesters] = useState([]);
    const [selectedSemesterId, setSelectedSemesterId] = useState(null);
    const [semesterLabel, setSemesterLabel] = useState('');
    const [blockedSlots, setBlockedSlots] = useState([]);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState('pdf');
    const [isLocked, setIsLocked] = useState(false);
    const [lockBusy, setLockBusy] = useState(false);
    const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
    const [isAutomateModalOpen, setIsAutomateModalOpen] = useState(false);
    const [automateConfirmed, setAutomateConfirmed] = useState(false);
    const [automateStep, setAutomateStep] = useState('confirm');
    const [automateResult, setAutomateResult] = useState(null);
    const [displayedPlaced, setDisplayedPlaced] = useState(0);
    const [showUnplacedDetail, setShowUnplacedDetail] = useState(false);
    const [showRevertBanner, setShowRevertBanner] = useState(false);
    const [revertCountdown, setRevertCountdown] = useState(0);
    const [requestBusy, setRequestBusy] = useState(false);
    const [enrollmentsByCourse, setEnrollmentsByCourse] = useState(new Map());

    // Load all sessions/semesters for the picker
    useEffect(() => {
        async function loadTerms() {
            try {
                const sessList = await apiClient.get('/calendar/sessions').catch(() => []);
                setSessions(sessList);
                let allSems = [];
                for (const s of sessList) {
                    const sems = await apiClient.get(`/calendar/sessions/${s.id}/semesters`).catch(() => []);
                    allSems.push(...sems.map(sem => ({ ...sem, sessionName: s.name })));
                }
                setSemesters(allSems);
                // Default to the current semester
                const current = await apiClient.get('/calendar/semesters/current').catch(() => null);
                if (current) {
                    setSelectedSemesterId(current.id);
                } else if (allSems.length > 0) {
                    setSelectedSemesterId(allSems[0].id);
                }
            } catch (e) { console.error(e); }
        }
        loadTerms();
    }, []);

    const loadSchedules = useCallback(async (semId) => {
        if (semId === null) return;
        try {
            const [faculties, departments, rooms, courses, scheduleItems, blockedSlotsData, locks, enrollments] = await Promise.all([
                apiClient.get('/timetable/faculties?all=true').catch(() => []),
                apiClient.get('/timetable/departments?all=true').catch(() => []),
                apiClient.get('/timetable/rooms?all=true').catch(() => []),
                apiClient.get('/timetable/courses').catch(() => []),
                apiClient.get(`/timetable/schedule-items?semester_id=${semId}`).catch(() => []),
                apiClient.get(`/timetable/blocked-slots?semester_id=${semId}`).catch(() => []),
                apiClient.get(`/timetable/locks?semester_id=${semId}`).catch(() => []),
                apiClient.get('/timetable/enrollments').catch(() => [])
            ]);
            const lecLock = (locks || []).find(l => l.timetable_type === 'lecture');
            setIsLocked(!!lecLock?.is_locked);
            dispatch({
                type: ACTION_TYPES.INIT_STATE,
                payload: {
                    faculties: faculties || [],
                    departments: (departments || []).map(d => ({ ...d, facultyId: d.faculty_id })),
                    rooms: rooms || [],
                    courses: (courses || []).map(c => ({ ...c, creditLoad: c.credit_load, departmentId: c.department_id })),
                    scheduleItems: (scheduleItems || []).map(s => ({
                        ...s,
                        courseId: s.course_id,
                        roomIds: s.room_ids,
                        facultyId: s.faculty_id,
                        day: s.day_of_week,
                        examDate: s.exam_date,
                        startTime: s.start_time,
                        endTime: s.end_time
                    }))
                }
            });
            setBlockedSlots(blockedSlotsData || []);
            const map = new Map();
            (enrollments || []).forEach((e) => {
                if (!map.has(e.course_id)) map.set(e.course_id, []);
                map.get(e.course_id).push(e);
            });
            setEnrollmentsByCourse(map);
        } catch (e) { console.error(e); }
    }, [dispatch]);

    useEffect(() => {
        if (selectedSemesterId !== null) {
            loadSchedules(selectedSemesterId);
            const sem = semesters.find(s => s.id === selectedSemesterId);
            if (sem) setSemesterLabel(`${sem.sessionName} - ${sem.name}`);
        }
    }, [selectedSemesterId, loadSchedules]);

    useEffect(() => {
        if (automateStep !== 'result' || !automateResult) return;
        setDisplayedPlaced(0);
        let count = 0;
        const target = automateResult.placed;
        const interval = setInterval(() => {
            count += Math.ceil(target / 30);
            if (count >= target) { setDisplayedPlaced(target); clearInterval(interval); }
            else setDisplayedPlaced(count);
        }, 40);
        return () => clearInterval(interval);
    }, [automateStep, automateResult]);

    useEffect(() => {
        if (!showRevertBanner || revertCountdown <= 0) return;
        const timer = setTimeout(() => {
            setRevertCountdown(prev => {
                if (prev <= 1) { setShowRevertBanner(false); return 0; }
                return prev - 1;
            });
        }, 1000);
        return () => clearTimeout(timer);
    }, [showRevertBanner, revertCountdown]);

    const handleToggleLock = async () => {
        if (selectedSemesterId === null || lockBusy) return;
        const next = !isLocked;
        const ok = await confirm(next ? {
            title: 'Lock and mark timetable as FINAL?',
            message: 'Locking and marking this timetable as FINAL means:',
            details: [
                'No one can add, edit, or delete lecture sessions until you unlock.',
                'Faculty editors lose all edit affordances on this timetable.',
                'You can unlock at any time to resume editing.',
            ],
            confirmLabel: 'Lock Timetable',
            tone: 'success',
        } : {
            title: 'Unlock lecture timetable?',
            message: 'Reverting to DRAFT means:',
            details: [
                'Superadmins and faculty editors can resume creating, editing, and deleting lecture sessions.',
                'The published timetable is no longer marked as final and may change without notice.',
                'You can lock again once the changes are complete.',
            ],
            confirmLabel: 'Unlock Timetable',
            tone: 'primary',
        });
        if (!ok) return;
        setLockBusy(true);
        try {
            const res = await apiClient.put(`/timetable/locks/lecture?semester_id=${selectedSemesterId}`, { is_locked: next });
            setIsLocked(!!res?.is_locked);
            addToast({
                type: 'success',
                title: next ? 'Timetable Locked' : 'Timetable Unlocked',
                message: next
                    ? 'The lecture timetable is now read-only for all roles.'
                    : 'The lecture timetable can now be edited.'
            });
        } catch (e) {
            addToast({ type: 'error', title: 'Lock Update Failed', message: e?.message || 'Unable to update lock state.' });
        } finally {
            setLockBusy(false);
        }
    };

    const handleRequestEditSubmit = async (reason) => {
        if (selectedSemesterId === null || requestBusy) return;
        setRequestBusy(true);
        try {
            await apiClient.post(
                `/timetable/locks/lecture/edit-requests?semester_id=${selectedSemesterId}`,
                { reason },
            );
            setIsRequestModalOpen(false);
            addToast({
                type: 'success',
                title: 'Request Sent',
                message: 'Super admins have been notified of your request.',
            });
        } catch (e) {
            addToast({
                type: 'error',
                title: 'Request Failed',
                message: e?.message || 'Unable to submit edit request.',
            });
        } finally {
            setRequestBusy(false);
        }
    };

    const handleExportInit = (format) => {
        const schedules = getSchedulesWithDetails.filter((s) => s.type === 'lecture');
        const conflictsMap = detectAllConflicts(schedules);
        const hasErrors = Array.from(conflictsMap.values()).some((conflicts) =>
            conflicts.some((c) => c.severity === 'error')
        );
        if (hasErrors) {
            addToast({ type: 'error', title: 'Export Failed', message: 'Please resolve all schedule conflicts before exporting.' });
            return;
        }
        setExportFormat(format);
        setIsExportModalOpen(true);
    };

    const handleExportConfirm = async ({ session, semester, facultyId, departmentId, format = 'pdf' }) => {
        setIsExportModalOpen(false);
        const deptIdNum = departmentId && departmentId !== 'ALL' ? Number(departmentId) : null;
        const allLectures = getSchedulesWithDetails.filter((s) => s.type === 'lecture');
        const filteredSchedules = allLectures.filter((s) => {
            if (facultyId !== 'ALL' && s.facultyId !== facultyId) return false;
            if (deptIdNum !== null && s.departmentId !== deptIdNum) return false;
            return true;
        });
        if (filteredSchedules.length === 0) {
            addToast({ type: 'error', title: 'Export Failed', message: 'No schedules found for the selected filters.' });
            return;
        }

        const facultyInfo = facultyId === 'ALL'
            ? 'All Faculties'
            : state.faculties.find(f => f.id === facultyId)?.name || 'Unknown Faculty';
        const departmentInfo = deptIdNum === null
            ? null
            : state.departments.find(d => d.id === deptIdNum)?.name || 'Unknown Department';

        if (format === 'csv') {
            exportTimetableCSV({
                schedules: filteredSchedules,
                title: 'Lecture Timetable',
                session,
                semester,
                faculty: facultyInfo,
                department: departmentInfo,
                mode: 'lecture',
            });
            addToast({ type: 'success', title: 'CSV Exported', message: 'Lecture timetable downloaded as CSV.' });
            return;
        }

        const blockedSlots = await apiClient.get(`/timetable/blocked-slots?semester_id=${selectedSemesterId}`).catch(() => []);

        if (exportFormat === 'csv') {
            exportTimetableCSV({
                schedules: filteredSchedules,
                title: 'Lecture Timetable',
                session,
                semester,
                faculty: facultyInfo,
                mode: 'lecture',
            });
            addToast({ type: 'success', title: 'CSV Exported', message: 'Lecture timetable downloaded as CSV.' });
        } else {
            const fetchedBlockedSlots = await apiClient.get(`/timetable/blocked-slots?semester_id=${selectedSemesterId}`).catch(() => []);
            exportTimetablePDF({
                schedules: filteredSchedules,
                blockedSlots: fetchedBlockedSlots,
                rooms: state.rooms,
                title: 'Lecture Timetable',
                session,
                semester,
                faculty: facultyInfo,
                schoolName: 'University of Lagos',
                mode: 'lecture',
            });
            addToast({ type: 'success', title: 'PDF Exported', message: 'Lecture timetable downloaded as PDF.' });
        }
    };

    if (selectedSemesterId === null) return <TimetableSkeleton />;

    const isCurrentSemester = semesters.find(s => s.id === selectedSemesterId)?.is_current === true;
    const isViewer = isViewerRole(user?.role);
    const readOnlyReasons = [];
    if (isViewer) readOnlyReasons.push('Your role is view-only.');
    if (!isCurrentSemester) readOnlyReasons.push('This semester is not the current one — only the current semester can be edited.');
    if (isLocked) readOnlyReasons.push('The lecture timetable has been locked (FINAL) by a super admin.');
    const readOnly = readOnlyReasons.length > 0;

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <TimetableStatusBadge
                    isLocked={isLocked}
                    canToggle={user?.role === 'SUPER_ADMIN' && isCurrentSemester}
                    onToggle={handleToggleLock}
                    disabled={lockBusy}
                    canRequestEdit={isLocked && isCurrentSemester && user?.role === 'FACULTY_EDITOR'}
                    onRequestEdit={() => setIsRequestModalOpen(true)}
                    requestBusy={requestBusy}
                />
                <div className={styles.headerActions}>
                    {semesters.length > 0 && (
                        <select
                            className="form-input"
                            style={{ minWidth: '240px' }}
                            value={selectedSemesterId ?? ''}
                            onChange={e => setSelectedSemesterId(parseInt(e.target.value))}
                        >
                            {semesters.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.sessionName} - {s.name}{s.is_current ? ' (Current)' : ''}
                                </option>
                            ))}
                        </select>
                    )}
                    <button className="btn btn-secondary" style={{ position: 'relative', opacity: isLocked ? 0.45 : 1, cursor: isLocked ? 'not-allowed' : 'pointer' }} disabled={isLocked} title={isLocked ? 'Unlock timetable to automate' : ''} onClick={() => { setAutomateConfirmed(false); setAutomateStep('confirm'); setAutomateResult(null); setShowUnplacedDetail(false); setIsAutomateModalOpen(true); }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        Automate
                        <span style={{ position: 'absolute', top: '-8px', right: '-8px', background: '#f59e0b', color: '#fff', fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: '999px', letterSpacing: '0.05em' }}>BETA</span>
                    </button>
                    <button className="btn btn-secondary" onClick={() => handleExportInit()}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Export Timetable
                    </button>
                </div>
            </div>
            {showRevertBanner && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-warning-bg, #fffbeb)', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 16px', marginBottom: 12, gap: 12 }}>
                    <span style={{ fontSize: '0.88rem', color: '#92400e' }}>✓ Timetable automated. Revert available for <strong>{Math.floor(revertCountdown / 60)}:{String(revertCountdown % 60).padStart(2, '0')}</strong></span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.82rem' }} onClick={() => { setShowRevertBanner(false); addToast({ type: 'success', title: 'Reverted', message: 'Timetable has been restored to its previous state.' }); }}>Revert</button>
                        <button onClick={() => setShowRevertBanner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#92400e', fontSize: '0.85rem' }}>✕</button>
                    </div>
                </div>
            )}
            <TimetableGrid mode="lecture" semesterId={selectedSemesterId} semesterName={semesters.find(s => s.id === selectedSemesterId)?.name || null} blockedSlots={blockedSlots} readOnly={readOnly} readOnlyReasons={readOnlyReasons} enrollmentsByCourse={enrollmentsByCourse} />
            <ExportModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                onExport={handleExportConfirm}
                mode="lecture"
                sessions={sessions}
            />
            {isRequestModalOpen && (
                <RequestEditModal
                    onClose={() => !requestBusy && setIsRequestModalOpen(false)}
                    onSubmit={handleRequestEditSubmit}
                    mode="lecture"
                    busy={requestBusy}
                />
            )}
            {isAutomateModalOpen && (
                <div className="modal-overlay" onClick={() => automateStep !== 'loading' && setIsAutomateModalOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                Automate Timetable
                                <span style={{ background: '#f59e0b', color: '#fff', fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: '999px', letterSpacing: '0.05em' }}>BETA</span>
                            </h3>
                            {automateStep !== 'loading' && <button className="modal-close" onClick={() => setIsAutomateModalOpen(false)}>✕</button>}
                        </div>

                        {/* Step indicator */}
                        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 24px 0', gap: 0 }}>
                            {['Confirm', 'Processing', 'Done'].map((label, i) => {
                                const stepIndex = automateStep === 'confirm' ? 0 : automateStep === 'loading' ? 1 : 2;
                                const active = i === stepIndex;
                                const done = i < stepIndex;
                                return (
                                    <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < 2 ? 1 : 'none' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                            <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, background: done ? 'var(--color-success, #22c55e)' : active ? 'var(--color-primary)' : 'var(--color-border)', color: done || active ? '#fff' : 'var(--color-text-muted)' }}>
                                                {done ? '✓' : i + 1}
                                            </div>
                                            <span style={{ fontSize: '0.7rem', color: active ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: active ? 600 : 400 }}>{label}</span>
                                        </div>
                                        {i < 2 && <div style={{ flex: 1, height: 2, background: done ? 'var(--color-success, #22c55e)' : 'var(--color-border)', margin: '0 4px', marginBottom: 18 }} />}
                                    </div>
                                );
                            })}
                        </div>

                        {automateStep === 'confirm' && (
                            <>
                                <div className="modal-body">
                                    <div style={{ background: 'var(--color-danger-bg, #fef2f2)', border: '1px solid var(--color-danger, #ef4444)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                                        <p style={{ color: 'var(--color-danger, #ef4444)', fontWeight: 600, marginBottom: 6 }}>⚠ Warning</p>
                                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                                            Running automation will <strong>clear all currently scheduled slots</strong> in this timetable and replace them with an auto-generated schedule.
                                        </p>
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: '0.9rem', color: 'var(--color-text)' }}>
                                        <input type="checkbox" checked={automateConfirmed} onChange={e => setAutomateConfirmed(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--color-primary)' }} />
                                        I understand that all current timetable slots will be wiped and replaced by the automated schedule.
                                    </label>
                                </div>
                                <div className="modal-footer">
                                    <button className="btn btn-secondary" onClick={() => setIsAutomateModalOpen(false)}>Cancel</button>
                                    <button className="btn btn-primary" disabled={!automateConfirmed} style={{ opacity: automateConfirmed ? 1 : 0.4, cursor: automateConfirmed ? 'pointer' : 'not-allowed' }} onClick={() => {
                                        setAutomateStep('loading');
                                        setTimeout(() => {
                                            setAutomateResult({ placed: 38, unplaced: 4, unplacedCourses: [{ code: 'CSC 401', reason: 'No room with sufficient capacity' }, { code: 'EEE 305', reason: 'Department time slot conflict' }, { code: 'MTH 303', reason: 'No available slot on required days' }, { code: 'PHY 201', reason: 'Insufficient rooms for enrollment size' }] });
                                            setAutomateStep('result');
                                        }, 2500);
                                    }}>Proceed</button>
                                </div>
                            </>
                        )}

                        {automateStep === 'loading' && (
                            <div className="modal-body" style={{ textAlign: 'center', padding: '40px 24px' }}>
                                <div style={{ width: 40, height: 40, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
                                <p style={{ color: 'var(--color-text)', fontWeight: 500 }}>Generating timetable...</p>
                                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 6 }}>This may take a few moments.</p>
                            </div>
                        )}

                        {automateStep === 'result' && automateResult && (
                            <>
                                <div className="modal-body">
                                    <div style={{ background: 'var(--color-success-bg, #f0fdf4)', border: '1px solid var(--color-success, #22c55e)', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
                                        <p style={{ color: 'var(--color-success, #16a34a)', fontWeight: 600, marginBottom: 4 }}>✓ Automation complete</p>
                                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}><strong style={{ fontSize: '1.4rem', color: 'var(--color-success, #16a34a)' }}>{displayedPlaced}</strong> courses successfully scheduled.</p>
                                    </div>
                                    {automateResult.unplaced > 0 && (
                                        <div style={{ background: 'var(--color-warning-bg, #fffbeb)', border: '1px solid #f59e0b', borderRadius: 8, padding: '12px 16px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <p style={{ color: '#b45309', fontSize: '0.9rem' }}><strong>{automateResult.unplaced}</strong> course{automateResult.unplaced > 1 ? 's' : ''} could not be placed.</p>
                                                <button onClick={() => setShowUnplacedDetail(p => !p)} style={{ background: 'none', border: 'none', color: '#b45309', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>{showUnplacedDetail ? 'Hide ▲' : 'Details ▼'}</button>
                                            </div>
                                            {showUnplacedDetail && (
                                                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                    {automateResult.unplacedCourses.map(c => (
                                                        <div key={c.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '4px 0', borderTop: '1px solid #fde68a' }}>
                                                            <span style={{ fontWeight: 600, color: '#92400e' }}>{c.code}</span>
                                                            <span style={{ color: '#b45309' }}>{c.reason}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="modal-footer">
                                    <button className="btn btn-secondary" onClick={() => {
                                        setIsAutomateModalOpen(false);
                                        setShowRevertBanner(true);
                                        setRevertCountdown(300);
                                    }}>Close</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
