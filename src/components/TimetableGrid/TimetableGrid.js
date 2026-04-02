'use client';

import { useState, useMemo } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import { DAYS } from '@/lib/utils';
import { detectConflicts, detectAllConflicts } from '@/lib/conflicts';
import { useToast } from '@/components/Toast/Toast';
import styles from './TimetableGrid.module.css';

const HOURS = Array.from({ length: 10 }, (_, i) => i + 8); // 8..17

// Color palette for course blocks (light mode)
const COLORS = [
    { bg: 'rgba(99, 102, 241, 0.1)', border: '#6366f1', text: '#4f46e5' },
    { bg: 'rgba(8, 145, 178, 0.1)', border: '#0891b2', text: '#0e7490' },
    { bg: 'rgba(5, 150, 105, 0.1)', border: '#059669', text: '#047857' },
    { bg: 'rgba(217, 119, 6, 0.1)', border: '#d97706', text: '#b45309' },
    { bg: 'rgba(139, 92, 246, 0.1)', border: '#8b5cf6', text: '#7c3aed' },
    { bg: 'rgba(219, 39, 119, 0.1)', border: '#db2777', text: '#be185d' },
    { bg: 'rgba(37, 99, 235, 0.1)', border: '#2563eb', text: '#1d4ed8' },
    { bg: 'rgba(22, 163, 74, 0.1)', border: '#16a34a', text: '#15803d' },
    { bg: 'rgba(234, 88, 12, 0.1)', border: '#ea580c', text: '#c2410c' },
    { bg: 'rgba(220, 38, 38, 0.1)', border: '#dc2626', text: '#b91c1c' },
];

function getColor(index) {
    return COLORS[index % COLORS.length];
}

function timeToRow(time) {
    const [h, m] = time.split(':').map(Number);
    return (h - 8) * 2 + (m >= 30 ? 1 : 0);
}

export default function TimetableGrid({ mode = 'lecture' }) {
    const { state, dispatch, getSchedulesWithDetails } = useApp();
    const { faculties, departments, courses, rooms } = state;
    const { addToast } = useToast();

    // Filters
    const [filterFaculty, setFilterFaculty] = useState('');
    const [filterDept, setFilterDept] = useState('');

    // Schedule modal
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [modalForm, setModalForm] = useState({
        courseId: '',
        roomId: '',
        day: 'Monday',
        startTime: '08:00',
        endTime: '10:00',
    });

    // Validation state
    const [modalConflicts, setModalConflicts] = useState([]);

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState(null);

    // Filtered departments based on faculty
    const filteredDepts = filterFaculty
        ? departments.filter((d) => d.facultyId === filterFaculty)
        : departments;

    // Get schedules for current mode, filtered by faculty/dept
    const schedules = useMemo(() => {
        return getSchedulesWithDetails.filter((s) => {
            if (s.type !== mode) return false;
            if (filterFaculty && s.facultyId !== filterFaculty) return false;
            if (filterDept && s.departmentId !== filterDept) return false;
            return true;
        });
    }, [getSchedulesWithDetails, mode, filterFaculty, filterDept]);

    // ALL schedules of this mode (unfiltered, for conflict detection)
    const allModeSchedules = useMemo(() => {
        return getSchedulesWithDetails.filter((s) => s.type === mode);
    }, [getSchedulesWithDetails, mode]);

    // Detect all conflicts across the grid
    const conflictMap = useMemo(() => {
        return detectAllConflicts(allModeSchedules);
    }, [allModeSchedules]);

    // Assign colors by course
    const courseColorMap = useMemo(() => {
        const map = {};
        let idx = 0;
        schedules.forEach((s) => {
            if (!map[s.courseId]) {
                map[s.courseId] = getColor(idx++);
            }
        });
        return map;
    }, [schedules]);

    // Filtered courses for modal dropdown
    const modalCourses = useMemo(() => {
        if (filterDept) return courses.filter((c) => c.departmentId === filterDept);
        if (filterFaculty) {
            const deptIds = departments.filter((d) => d.facultyId === filterFaculty).map((d) => d.id);
            return courses.filter((c) => deptIds.includes(c.departmentId));
        }
        return courses;
    }, [courses, departments, filterFaculty, filterDept]);

    // Click on empty cell
    const handleCellClick = (day, hour) => {
        const startTime = `${hour.toString().padStart(2, '0')}:00`;
        const endH = Math.min(hour + 2, 18);
        const endTime = `${endH.toString().padStart(2, '0')}:00`;
        setEditing(null);
        setModalConflicts([]);
        setModalForm({
            courseId: modalCourses[0]?.id || '',
            roomId: rooms[0]?.id || '',
            day,
            startTime,
            endTime,
        });
        setShowModal(true);
    };

    // Click on existing schedule
    const handleEventClick = (schedule, e) => {
        e.stopPropagation();
        setEditing(schedule);
        setModalConflicts([]);
        setModalForm({
            courseId: schedule.courseId,
            roomId: schedule.roomId,
            day: schedule.day,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
        });
        setShowModal(true);
    };

    // Live validation when modal form changes
    const validateForm = (formData) => {
        if (!formData.courseId || !formData.roomId) return;
        const result = detectConflicts(
            { ...formData, type: mode },
            allModeSchedules,
            editing?.id || null
        );
        setModalConflicts(result.conflicts);
    };

    const updateForm = (updates) => {
        const newForm = { ...modalForm, ...updates };
        setModalForm(newForm);
        validateForm(newForm);
    };

    // Save schedule
    const handleSave = () => {
        if (!modalForm.courseId || !modalForm.roomId) return;

        // Run final conflict check
        const result = detectConflicts(
            { ...modalForm, type: mode },
            allModeSchedules,
            editing?.id || null
        );

        // Block if there are errors (room/course conflicts)
        if (result.hasConflict) {
            result.conflicts.filter((c) => c.severity === 'error').forEach((c) => {
                addToast({
                    type: 'error',
                    title: 'Conflict Detected',
                    message: c.message,
                    duration: 8000,
                });
            });
            return; // Block submission
        }

        // Show warnings but allow submission
        if (result.hasWarning) {
            result.conflicts.filter((c) => c.severity === 'warning').forEach((c) => {
                addToast({
                    type: 'warning',
                    title: 'Schedule Warning',
                    message: c.message,
                    duration: 6000,
                });
            });
        }

        const payload = { ...modalForm, type: mode };
        if (editing) {
            dispatch({ type: ACTION_TYPES.UPDATE_SCHEDULE, payload: { id: editing.id, ...payload } });
            addToast({ type: 'success', title: 'Schedule Updated', message: `${courses.find(c => c.id === modalForm.courseId)?.code || 'Course'} updated successfully.` });
        } else {
            dispatch({ type: ACTION_TYPES.ADD_SCHEDULE, payload });
            addToast({ type: 'success', title: 'Course Scheduled', message: `${courses.find(c => c.id === modalForm.courseId)?.code || 'Course'} added to ${modalForm.day} timetable.` });
        }
        setShowModal(false);
    };

    // Delete schedule
    const handleDelete = () => {
        if (deleteTarget) {
            dispatch({ type: ACTION_TYPES.DELETE_SCHEDULE, payload: deleteTarget.id });
            addToast({ type: 'info', title: 'Schedule Removed', message: `${deleteTarget.courseCode} removed from ${deleteTarget.day} ${deleteTarget.startTime}–${deleteTarget.endTime}.` });
            setDeleteTarget(null);
        }
    };

    // Time options
    const timeOptions = [];
    for (let h = 8; h <= 18; h++) {
        timeOptions.push(`${h.toString().padStart(2, '0')}:00`);
        if (h < 18) timeOptions.push(`${h.toString().padStart(2, '0')}:30`);
    }

    // Count conflicts in the visible grid
    const visibleConflictCount = schedules.filter((s) => conflictMap.has(s.id)).length;

    return (
        <div className={styles.container}>
            {/* Filter Bar */}
            <div className={styles.filterBar}>
                <div className={styles.filterLeft}>
                    <div className={styles.filterItem}>
                        <label className={styles.filterLabel}>Faculty</label>
                        <select
                            className={styles.filterSelect}
                            value={filterFaculty}
                            onChange={(e) => { setFilterFaculty(e.target.value); setFilterDept(''); }}
                        >
                            <option value="">All Faculties</option>
                            {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                    </div>
                    <div className={styles.filterItem}>
                        <label className={styles.filterLabel}>Department</label>
                        <select
                            className={styles.filterSelect}
                            value={filterDept}
                            onChange={(e) => setFilterDept(e.target.value)}
                        >
                            <option value="">All Departments</option>
                            {filteredDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                    </div>
                </div>
                <div className={styles.filterRight}>
                    <span className={styles.scheduleCount}>
                        {schedules.length} {mode === 'lecture' ? 'lecture' : 'exam'}{schedules.length !== 1 ? 's' : ''}
                        {visibleConflictCount > 0 && (
                            <span className={styles.conflictBadge}>
                                ⚠ {visibleConflictCount} conflict{visibleConflictCount !== 1 ? 's' : ''}
                            </span>
                        )}
                    </span>
                </div>
            </div>

            {/* Grid */}
            <div className={styles.gridWrapper} id="timetable-grid">
                <div className={styles.grid}>
                    {/* Header row */}
                    <div className={styles.cornerCell}>
                        <span className={styles.cornerLabel}>Time</span>
                    </div>
                    {DAYS.map((day) => (
                        <div key={day} className={styles.dayHeader}>
                            <span className={styles.dayName}>{day}</span>
                            <span className={styles.dayCount}>
                                {schedules.filter((s) => s.day === day).length} slots
                            </span>
                        </div>
                    ))}

                    {/* Time rows */}
                    {HOURS.map((hour) => (
                        <div key={hour} className={styles.timeRow}>
                            {/* Time label */}
                            <div className={styles.timeLabel}>
                                <span className={styles.timePrimary}>
                                    {hour.toString().padStart(2, '0')}:00
                                </span>
                            </div>

                            {/* Day cells */}
                            {DAYS.map((day) => {
                                const cellSchedules = schedules.filter(
                                    (s) => s.day === day
                                );

                                return (
                                    <div
                                        key={`${day}-${hour}`}
                                        className={styles.cell}
                                        onClick={() => handleCellClick(day, hour)}
                                    >
                                        {/* Schedule blocks */}
                                        {cellSchedules.map((s) => {
                                            const startRow = timeToRow(s.startTime);
                                            const endRow = timeToRow(s.endTime);
                                            const cellStart = (hour - 8) * 2;
                                            const cellEnd = cellStart + 2;

                                            // Only render if this block starts in this cell
                                            if (startRow < cellStart || startRow >= cellEnd) return null;

                                            const span = endRow - startRow;
                                            const color = courseColorMap[s.courseId] || COLORS[0];
                                            const hasConflict = conflictMap.has(s.id);
                                            const itemConflicts = conflictMap.get(s.id) || [];
                                            const hasError = itemConflicts.some((c) => c.severity === 'error');

                                            return (
                                                <div
                                                    key={s.id}
                                                    className={`${styles.event} ${hasError ? styles.eventConflict : ''}`}
                                                    style={{
                                                        top: `${((startRow - cellStart) / 2) * 100}%`,
                                                        height: `${(span / 2) * 100}%`,
                                                        background: hasError ? 'rgba(239, 68, 68, 0.15)' : color.bg,
                                                        borderLeftColor: hasError ? '#ef4444' : color.border,
                                                    }}
                                                    onClick={(e) => handleEventClick(s, e)}
                                                    title={hasConflict ? itemConflicts.map((c) => c.message).join('\n') : `${s.courseCode} — ${s.roomName}`}
                                                >
                                                    <span className={styles.eventCode} style={{ color: hasError ? '#f87171' : color.border }}>
                                                        {hasError && '⚠ '}{s.courseCode}
                                                    </span>
                                                    <span className={styles.eventRoom}>{s.roomName}</span>
                                                    <span className={styles.eventTime}>{s.startTime}–{s.endTime}</span>
                                                </div>
                                            );
                                        })}

                                        {/* Click hint on hover */}
                                        <div className={styles.cellHint}>+ Add</div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            {/* Schedule Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editing ? 'Edit Schedule' : 'Schedule Course'}</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {/* Inline conflict warnings */}
                            {modalConflicts.length > 0 && (
                                <div className={styles.conflictAlerts}>
                                    {modalConflicts.map((c, i) => (
                                        <div key={i} className={`${styles.conflictAlert} ${styles[`alert_${c.severity}`]}`}>
                                            <span className={styles.alertIcon}>
                                                {c.severity === 'error' ? '✕' : '⚠'}
                                            </span>
                                            <span className={styles.alertText}>{c.message}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="form-group">
                                <label className="form-label">Course</label>
                                <select
                                    className="form-select form-input"
                                    value={modalForm.courseId}
                                    onChange={(e) => updateForm({ courseId: e.target.value })}
                                >
                                    <option value="">Select a course...</option>
                                    {modalCourses.map((c) => (
                                        <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Room</label>
                                <select
                                    className="form-select form-input"
                                    value={modalForm.roomId}
                                    onChange={(e) => updateForm({ roomId: e.target.value })}
                                >
                                    <option value="">Select a room...</option>
                                    {rooms.map((r) => (
                                        <option key={r.id} value={r.id}>{r.name} (Cap: {r.capacity})</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Day</label>
                                <select
                                    className="form-select form-input"
                                    value={modalForm.day}
                                    onChange={(e) => updateForm({ day: e.target.value })}
                                >
                                    {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div className="form-group">
                                    <label className="form-label">Start Time</label>
                                    <select
                                        className="form-select form-input"
                                        value={modalForm.startTime}
                                        onChange={(e) => updateForm({ startTime: e.target.value })}
                                    >
                                        {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">End Time</label>
                                    <select
                                        className="form-select form-input"
                                        value={modalForm.endTime}
                                        onChange={(e) => updateForm({ endTime: e.target.value })}
                                    >
                                        {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            {editing && (
                                <button
                                    className="btn btn-danger"
                                    style={{ marginRight: 'auto' }}
                                    onClick={() => { setShowModal(false); setDeleteTarget(editing); }}
                                >
                                    Delete
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSave}
                                disabled={!modalForm.courseId || !modalForm.roomId}
                            >
                                {editing ? 'Save Changes' : 'Add to Timetable'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Remove Schedule</h3>
                            <button className="modal-close" onClick={() => setDeleteTarget(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                                Remove <strong style={{ color: 'var(--color-text)' }}>{deleteTarget.courseCode}</strong> from{' '}
                                <strong style={{ color: 'var(--color-text)' }}>{deleteTarget.day} {deleteTarget.startTime}–{deleteTarget.endTime}</strong>?
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={handleDelete}>Remove</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
