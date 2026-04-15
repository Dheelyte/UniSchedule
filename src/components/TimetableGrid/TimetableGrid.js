'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import { DAYS, EXAM_DAYS, timeToMinutes } from '@/lib/utils';
import { detectConflicts, detectAllConflicts } from '@/lib/conflicts';
import { useToast } from '@/components/Toast/Toast';
import { apiClient } from '@/lib/apiClient';
import styles from './TimetableGrid.module.css';

const HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 8, 9, 10...18

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

function timeToCol(time) {
    const [h, m] = time.split(':').map(Number);
    return (h - 8) * 2 + (m >= 30 ? 1 : 0);
}

/**
 * Compute vertical stacking layout for overlapping events in the SAME ROOM.
 */
function computeVerticalOverlapLayout(events) {
    if (events.length <= 1) {
        const map = new Map();
        if (events.length === 1) map.set(events[0].id, { offset: 0, total: 1 });
        return map;
    }

    const sorted = [...events].sort((a, b) => {
        const diff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
        return diff !== 0 ? diff : timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
    });

    const lanes = [];
    const assignments = new Map();

    sorted.forEach((ev) => {
        const start = timeToMinutes(ev.startTime);
        let placed = false;
        for (let l = 0; l < lanes.length; l++) {
            if (lanes[l] <= start) {
                lanes[l] = timeToMinutes(ev.endTime);
                assignments.set(ev.id, { offset: l, total: 0 });
                placed = true;
                break;
            }
        }
        if (!placed) {
            assignments.set(ev.id, { offset: lanes.length, total: 0 });
            lanes.push(timeToMinutes(ev.endTime));
        }
    });

    const groups = [];
    const visited = new Set();

    sorted.forEach((ev) => {
        if (visited.has(ev.id)) return;
        const group = [];
        const queue = [ev];
        visited.add(ev.id);
        while (queue.length > 0) {
            const curr = queue.shift();
            group.push(curr);
            sorted.forEach((other) => {
                if (visited.has(other.id)) return;
                const overlaps = group.some((g) => {
                    const gStart = timeToMinutes(g.startTime);
                    const gEnd = timeToMinutes(g.endTime);
                    const oStart = timeToMinutes(other.startTime);
                    const oEnd = timeToMinutes(other.endTime);
                    return gStart < oEnd && oStart < gEnd;
                });
                if (overlaps) {
                    visited.add(other.id);
                    queue.push(other);
                }
            });
        }
        groups.push(group);
    });

    groups.forEach((group) => {
        const maxOffset = Math.max(...group.map((e) => assignments.get(e.id).offset)) + 1;
        group.forEach((e) => {
            assignments.get(e.id).total = maxOffset;
        });
    });

    return assignments;
}

export default function TimetableGrid({ mode = 'lecture', semesterId = null, readOnly = false }) {
    const { state, dispatch, getSchedulesWithDetails } = useApp();
    const { faculties, departments, courses, rooms } = state;
    const { addToast } = useToast();

    const activeDays = mode === 'exam' ? EXAM_DAYS : DAYS;

    // Filters
    const [filterFaculty, setFilterFaculty] = useState('');
    const [filterDept, setFilterDept] = useState('');

    // State for selected day
    const [currentDay, setCurrentDay] = useState(activeDays[0]);

    useEffect(() => {
        if (!activeDays.includes(currentDay)) {
            setCurrentDay(activeDays[0]);
        }
    }, [activeDays, currentDay]);

    // Schedule modal
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [modalForm, setModalForm] = useState({
        courseId: '',
        roomIds: [''],
        day: 'Monday',
        startTime: '08:00',
        endTime: '10:00',
    });

    const [modalConflicts, setModalConflicts] = useState([]);
    const [deleteTarget, setDeleteTarget] = useState(null);

    // Drag & drop state
    const [dragItem, setDragItem] = useState(null);
    const [dragOverCell, setDragOverCell] = useState(null);

    // Week state (exam mode only)
    const [currentWeek, setCurrentWeek] = useState(1);
    const [totalWeeks, setTotalWeeks] = useState(() => {
        const maxWeek = getSchedulesWithDetails
            .filter((s) => s.type === 'exam' && s.week)
            .reduce((max, s) => Math.max(max, s.week), 1);
        return Math.max(maxWeek, 1);
    });

    const filteredDepts = filterFaculty
        ? departments.filter((d) => d.facultyId === filterFaculty)
        : departments;

    // ALL schedules of this mode (for conflicts across days/weeks)
    const allModeSchedules = useMemo(() => {
        return getSchedulesWithDetails.filter((s) => s.type === mode);
    }, [getSchedulesWithDetails, mode]);

    const conflictMap = useMemo(() => {
        return detectAllConflicts(allModeSchedules);
    }, [allModeSchedules]);

    // Filtered mode schedules (respecting faculty, dept, week) but independent of day
    const filteredModeSchedules = useMemo(() => {
        return allModeSchedules.filter((s) => {
            if (filterFaculty && s.facultyId !== filterFaculty) return false;
            if (filterDept && s.departmentId !== filterDept) return false;
            if (mode === 'exam' && s.week && s.week !== currentWeek) return false;
            return true;
        });
    }, [allModeSchedules, mode, filterFaculty, filterDept, currentWeek]);

    // Schedules for ONLY the current day
    const daySchedules = useMemo(() => {
        return filteredModeSchedules.filter(s => s.day === currentDay);
    }, [filteredModeSchedules, currentDay]);

    const courseColorMap = useMemo(() => {
        const map = {};
        let idx = 0;
        daySchedules.forEach((s) => {
            if (!map[s.courseId]) {
                map[s.courseId] = getColor(idx++);
            }
        });
        return map;
    }, [daySchedules]);

    // Pre-compute overlapping per room for the current day
    const overlapLayoutMap = useMemo(() => {
        const roomMap = {};
        rooms.forEach((room) => {
            const roomSchedules = daySchedules.filter((s) =>
                s.roomIds?.includes(room.id) || s.roomId === room.id
            );
            roomMap[room.id] = computeVerticalOverlapLayout(roomSchedules);
        });
        return roomMap;
    }, [daySchedules, rooms]);

    const modalCourses = useMemo(() => {
        if (filterDept) return courses.filter((c) => c.departmentId === filterDept);
        if (filterFaculty) {
            const deptIds = departments.filter((d) => d.facultyId === filterFaculty).map((d) => d.id);
            return courses.filter((c) => deptIds.includes(c.departmentId));
        }
        return courses;
    }, [courses, departments, filterFaculty, filterDept]);

    const handleCellClick = (roomId, hour) => {
        if (readOnly) return;
        const startTime = `${hour.toString().padStart(2, '0')}:00`;
        const endH = Math.min(hour + 2, 18);
        const endTime = `${endH.toString().padStart(2, '0')}:00`;
        setEditing(null);
        setModalConflicts([]);
        setModalForm({
            courseId: modalCourses[0]?.id || '',
            roomIds: [roomId || rooms[0]?.id || ''],
            day: currentDay,
            startTime,
            endTime,
            ...(mode === 'exam' ? { week: currentWeek } : {}),
        });
        setShowModal(true);
    };

    const handleEventClick = (schedule, e) => {
        e.stopPropagation();
        if (readOnly) return; // viewing historical semester — no edits
        setEditing(schedule);
        setModalConflicts([]);
        setModalForm({
            courseId: schedule.courseId,
            roomIds: schedule.roomIds || (schedule.roomId ? [schedule.roomId] : ['']),
            day: schedule.day,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            ...(mode === 'exam' ? { week: schedule.week || currentWeek } : {}),
        });
        setShowModal(true);
    };

    const validateForm = (formData) => {
        if (!formData.courseId || !formData.roomIds?.some((r) => r)) return;
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

    const addRoom = () => {
        updateForm({ roomIds: [...modalForm.roomIds, ''] });
    };

    const removeRoom = (index) => {
        if (modalForm.roomIds.length <= 1) return;
        const newRoomIds = modalForm.roomIds.filter((_, i) => i !== index);
        updateForm({ roomIds: newRoomIds });
    };

    const updateRoom = (index, value) => {
        const newRoomIds = [...modalForm.roomIds];
        newRoomIds[index] = value;
        updateForm({ roomIds: newRoomIds });
    };

    const handleSave = async () => {
        const validRoomIds = modalForm.roomIds.filter((r) => r);
        if (!modalForm.courseId || validRoomIds.length === 0) return;

        const formWithCleanRooms = { ...modalForm, roomIds: validRoomIds };

        const result = detectConflicts(
            { ...formWithCleanRooms, type: mode },
            allModeSchedules,
            editing?.id || null
        );

        if (result.hasConflict) {
            result.conflicts.filter((c) => c.severity === 'error').forEach((c) => {
                addToast({
                    type: 'error',
                    title: 'Conflict Detected',
                    message: c.message,
                    duration: 8000,
                });
            });
            return;
        }

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

        const payload = { ...formWithCleanRooms, type: mode, ...(mode === 'exam' ? { week: formWithCleanRooms.week || currentWeek } : {}) };

        try {
            if (editing) {
                const apiPayload = {
                    room_ids: validRoomIds,
                    day_of_week: payload.day,
                    start_time: payload.startTime,
                    end_time: payload.endTime
                };
                await apiClient.put(`/timetable/schedule-items/${editing.id}`, apiPayload);
                dispatch({ type: ACTION_TYPES.UPDATE_SCHEDULE, payload: { id: editing.id, ...payload } });
                addToast({ type: 'success', title: 'Schedule Updated', message: `${courses.find(c => c.id === modalForm.courseId)?.code || 'Course'} updated successfully.` });
            } else {
                const course = courses.find(c => c.id === modalForm.courseId);
                const dept = departments.find(d => d.id === course?.departmentId);
                const apiPayload = {
                    course_id: payload.courseId,
                    faculty_id: dept?.facultyId || faculties[0]?.id || '',
                    room_ids: validRoomIds,
                    day_of_week: payload.day,
                    start_time: payload.startTime,
                    end_time: payload.endTime,
                    type: payload.type,
                    week: payload.week || null
                };
                const res = await apiClient.post('/timetable/schedule-items', { ...apiPayload, semester_id: semesterId });
                dispatch({
                    type: ACTION_TYPES.ADD_SCHEDULE, payload: {
                        id: res.id,
                        courseId: parseInt(payload.courseId),
                        roomIds: (payload.roomIds || []).map(r => parseInt(r)),
                        facultyId: dept?.facultyId || faculties[0]?.id || '',
                        day: payload.day,
                        startTime: payload.startTime,
                        endTime: payload.endTime,
                        type: payload.type,
                        week: payload.week || null,
                        semester_id: semesterId,
                    }
                });
                addToast({ type: 'success', title: 'Course Scheduled', message: `${courses.find(c => c.id === modalForm.courseId)?.code || 'Course'} added to timetable.` });
            }
        } catch (e) {
            console.error('Failed to sync schedule', e);
            addToast({ type: 'error', title: 'API Sync Error', message: 'Failed to synchronize with server.' });
        }
        setShowModal(false);
    };

    const handleDelete = async () => {
        if (deleteTarget) {
            try {
                await apiClient.delete(`/timetable/schedule-items/${deleteTarget.id}`);
                dispatch({ type: ACTION_TYPES.DELETE_SCHEDULE, payload: deleteTarget.id });
                addToast({ type: 'info', title: 'Schedule Removed', message: `${deleteTarget.courseCode || 'Course'} removed.` });
                setDeleteTarget(null);
            } catch (e) {
                console.error('Failed to delete schedule', e);
            }
        }
    };

    const handleDragStart = useCallback((schedule, e) => {
        setDragItem(schedule);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', schedule.id);
    }, []);

    const handleDragEnd = useCallback(() => {
        setDragItem(null);
        setDragOverCell(null);
    }, []);

    const handleCellDragOver = useCallback((e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);

    const handleCellDragEnter = useCallback((roomId, hour) => {
        setDragOverCell(`${roomId}-${hour}`);
    }, []);

    const handleCellDragLeave = useCallback(() => {
        setDragOverCell(null);
    }, []);

    const handleDrop = useCallback(async (roomId, hour, e) => {
        e.preventDefault();
        setDragOverCell(null);
        if (!dragItem) return;

        const oldStart = timeToMinutes(dragItem.startTime);
        const oldEnd = timeToMinutes(dragItem.endTime);
        const duration = oldEnd - oldStart;

        const newStartMin = hour * 60;
        const newEndMin = newStartMin + duration;

        if (newEndMin > 18 * 60) {
            addToast({ type: 'warning', title: 'Cannot Drop', message: 'The course would extend past 6:00 PM.' });
            setDragItem(null);
            return;
        }

        const newStartTime = `${Math.floor(newStartMin / 60).toString().padStart(2, '0')}:${(newStartMin % 60).toString().padStart(2, '0')}`;
        const newEndTime = `${Math.floor(newEndMin / 60).toString().padStart(2, '0')}:${(newEndMin % 60).toString().padStart(2, '0')}`;

        if (currentDay === dragItem.day && newStartTime === dragItem.startTime && dragItem.roomIds?.includes(roomId) && dragItem.roomIds.length === 1) {
            setDragItem(null);
            return;
        }

        const candidate = {
            courseId: dragItem.courseId,
            roomIds: [roomId],
            day: currentDay,
            startTime: newStartTime,
            endTime: newEndTime,
            type: mode,
            ...(mode === 'exam' && dragItem.week != null ? { week: dragItem.week } : {}),
        };

        const result = detectConflicts(candidate, allModeSchedules, dragItem.id);

        if (result.hasConflict) {
            result.conflicts.filter((c) => c.severity === 'error').forEach((c) => {
                addToast({ type: 'error', title: 'Conflict Detected', message: c.message, duration: 8000 });
            });
            setDragItem(null);
            return;
        }

        if (result.hasWarning) {
            result.conflicts.filter((c) => c.severity === 'warning').forEach((c) => {
                addToast({ type: 'warning', title: 'Schedule Warning', message: c.message, duration: 6000 });
            });
        }

        try {
            const apiPayload = {
                room_ids: [roomId],
                day_of_week: currentDay,
                start_time: newStartTime,
                end_time: newEndTime
            };
            await apiClient.put(`/timetable/schedule-items/${dragItem.id}`, apiPayload);

            dispatch({
                type: ACTION_TYPES.UPDATE_SCHEDULE,
                payload: { id: dragItem.id, day: currentDay, startTime: newStartTime, endTime: newEndTime, roomIds: [roomId] },
            });
            addToast({
                type: 'success',
                title: 'Course Moved',
                message: `${dragItem.courseCode || 'Course'} moved to ${currentDay} ${newStartTime}–${newEndTime}.`,
            });
        } catch (err) {
            console.error('Drop error', err);
            addToast({ type: 'error', title: 'API Sync Error', message: 'Failed to synchronize movement with server.' });
        }

        setDragItem(null);
    }, [dragItem, allModeSchedules, mode, dispatch, addToast, currentDay]);

    const timeOptions = [];
    for (let h = 8; h <= 18; h++) {
        timeOptions.push(`${h.toString().padStart(2, '0')}:00`);
        if (h < 18) timeOptions.push(`${h.toString().padStart(2, '0')}:30`);
    }

    const visibleConflictCount = daySchedules.filter((s) => conflictMap.has(s.id)).length;

    const getAvailableRooms = (currentIndex) => {
        const selectedIds = modalForm.roomIds.filter((_, i) => i !== currentIndex);
        return rooms.filter((r) => !selectedIds.includes(r.id));
    };

    return (
        <div className={styles.container}>
            {readOnly && (
                <div style={{
                    background: '#fef9c3', border: '1px solid #fcd34d', borderRadius: '8px',
                    padding: '10px 16px', marginBottom: '12px', fontSize: '0.875rem',
                    color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px'
                }}>
                    🔒 <strong>Read-only view</strong> — this is a historical semester. Switch to the current semester to make changes.
                </div>
            )}
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
                        {daySchedules.length} {mode === 'lecture' ? 'lecture' : 'exam'}{daySchedules.length !== 1 ? 's' : ''} on {currentDay}
                        {visibleConflictCount > 0 && (
                            <span className={styles.conflictBadge}>
                                ⚠ {visibleConflictCount} conflict{visibleConflictCount !== 1 ? 's' : ''}
                            </span>
                        )}
                    </span>
                </div>
            </div>

            {/* Week Navigation (Exam mode only) */}
            {mode === 'exam' && (
                <div className={styles.weekBar}>
                    <button
                        className={styles.weekBtn}
                        onClick={() => setCurrentWeek((w) => Math.max(1, w - 1))}
                        disabled={currentWeek <= 1}
                    >
                        ← Prev
                    </button>
                    <span className={styles.weekLabel}>Week {currentWeek} of {totalWeeks}</span>
                    <button
                        className={styles.weekBtn}
                        onClick={() => setCurrentWeek((w) => Math.min(totalWeeks, w + 1))}
                        disabled={currentWeek >= totalWeeks}
                    >
                        Next →
                    </button>
                    <button
                        className={`${styles.weekBtn} ${styles.weekBtnAdd}`}
                        onClick={() => { setTotalWeeks((w) => w + 1); setCurrentWeek(totalWeeks + 1); }}
                    >
                        + Add Week
                    </button>
                </div>
            )}

            {/* Day selector bar */}
            <div className={styles.dayBar}>
                {activeDays.map(day => {
                    const count = filteredModeSchedules.filter(s => s.day === day).length;
                    return (
                        <button
                            key={day}
                            className={`${styles.dayBtn} ${currentDay === day ? styles.dayBtnActive : ''}`}
                            onClick={() => setCurrentDay(day)}
                        >
                            {day}
                            {count > 0 && (
                                <span className={styles.dayChip}>
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Grid */}
            <div className={styles.gridWrapper} id="timetable-grid">
                {/* 1 room column, then 1 column per half-hour from 8:00 to 18:00 (20 columns total) */}
                <div
                    className={styles.grid}
                    style={{ '--grid-columns': `180px repeat(20, 1fr)` }}
                >
                    {/* Header row */}
                    <div className={styles.cornerCell}>
                        <span className={styles.cornerLabel}>Room / Time</span>
                    </div>
                    {/* Time slots (only showing 8:00, 9:00, etc. but spanning 2 columns) */}
                    {HOURS.slice(0, 10).map((hour) => (
                        <div key={hour} className={styles.timeHeader} style={{ gridColumn: 'span 2' }}>
                            <span className={styles.timePrimary}>
                                {hour.toString().padStart(2, '0')}:00
                            </span>
                        </div>
                    ))}

                    {/* Room rows */}
                    {rooms.map((room) => {
                        const roomSchedules = daySchedules.filter((s) =>
                            s.roomIds?.includes(room.id) || s.roomId === room.id
                        );
                        const layoutMap = overlapLayoutMap[room.id] || new Map();

                        return (
                            <div key={room.id} className={styles.roomRow}>
                                {/* Room label */}
                                <div className={styles.roomLabel}>
                                    <span className={styles.roomName}>{room.name}</span>
                                    <span className={styles.roomCapacity}>Capacity: {room.capacity}</span>
                                </div>

                                {/* Hourly cells for grid lining & drop zones (spanning 2 columns each) */}
                                {HOURS.slice(0, 10).map((hour) => {
                                    const cellStartCol = (hour - 8) * 2;
                                    const cellEndCol = cellStartCol + 2;

                                    const cellEvents = roomSchedules.filter((s) => {
                                        const startCol = timeToCol(s.startTime);
                                        // Return true if it STARTS in this hour block (so we only render it once)
                                        return startCol >= cellStartCol && startCol < cellEndCol;
                                    });

                                    const isCellEmpty = !roomSchedules.some((s) => {
                                        const startCol = timeToCol(s.startTime);
                                        const endCol = timeToCol(s.endTime);
                                        return startCol < cellEndCol && endCol > cellStartCol;
                                    });

                                    return (
                                        <div
                                            key={`${room.id}-${hour}`}
                                            className={`${styles.cell} ${dragOverCell === `${room.id}-${hour}` ? styles.cellDragOver : ''}`}
                                            style={{ gridColumn: 'span 2' }}
                                            onClick={() => handleCellClick(room.id, hour)}
                                            onDragOver={handleCellDragOver}
                                            onDragEnter={() => handleCellDragEnter(room.id, hour)}
                                            onDragLeave={handleCellDragLeave}
                                            onDrop={(e) => handleDrop(room.id, hour, e)}
                                        >
                                            {isCellEmpty && <span className={styles.cellHint}>+ Add</span>}
                                            <button
                                                className={styles.quickAddBtn}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCellClick(room.id, hour);
                                                }}
                                                title="Add course here"
                                            >
                                                +
                                            </button>

                                            {/* Schedule blocks that START in this hour block */}
                                            {cellEvents.map((s) => {
                                                const startCol = timeToCol(s.startTime);
                                                const endCol = timeToCol(s.endTime);
                                                const span = endCol - startCol;
                                                const color = courseColorMap[s.courseId] || COLORS[0];

                                                const hasConflict = conflictMap.has(s.id);
                                                const itemConflicts = conflictMap.get(s.id) || [];
                                                const hasError = itemConflicts.some((c) => c.severity === 'error');

                                                const layout = layoutMap.get(s.id) || { offset: 0, total: 1 };
                                                const rowHeight = 100 / layout.total;
                                                const topOffset = layout.offset * rowHeight;

                                                // startCol is 0-20. cellStartCol is the col index of this cell.
                                                // So inside this cell, relative position is based on the 30-min granular offset.
                                                // 1 span = 1 column (30 mins) = 50% width of the 1-hour cell.
                                                const leftPct = ((startCol - cellStartCol) / 2) * 100;
                                                const widthPct = (span / 2) * 100;

                                                return (
                                                    <div
                                                        key={s.id}
                                                        className={`${styles.event} ${hasError ? styles.eventConflict : ''} ${dragItem?.id === s.id ? styles.eventDragging : ''}`}
                                                        style={{
                                                            top: `calc(${topOffset}% + 4px)`,
                                                            height: `calc(${rowHeight}% - 8px)`,
                                                            left: `${leftPct}%`,
                                                            width: `calc(${widthPct}% - 4px)`,
                                                            background: hasError ? 'rgba(239, 68, 68, 0.15)' : color.bg,
                                                            borderLeftColor: hasError ? '#ef4444' : color.border,
                                                        }}
                                                        draggable
                                                        onDragStart={(e) => handleDragStart(s, e)}
                                                        onDragEnd={handleDragEnd}
                                                        onClick={(e) => handleEventClick(s, e)}
                                                        title={hasConflict ? itemConflicts.map((c) => c.message).join('\n') : `${s.courseCode} — ${s.roomNames}`}
                                                    >
                                                        <span className={styles.eventCode} style={{ color: hasError ? '#f87171' : color.border }}>
                                                            {hasError && '⚠ '}{s.courseCode}
                                                        </span>
                                                        <span className={styles.eventRoom}>{s.startTime}–{s.endTime}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
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
                                <label className="form-label">Room{modalForm.roomIds.length > 1 ? 's' : ''}</label>
                                <div className={styles.locationList}>
                                    {modalForm.roomIds.map((rid, idx) => (
                                        <div key={idx} className={styles.locationRow}>
                                            <select
                                                className="form-select form-input"
                                                value={rid}
                                                onChange={(e) => updateRoom(idx, e.target.value)}
                                            >
                                                <option value="">Select a room...</option>
                                                {getAvailableRooms(idx).map((r) => (
                                                    <option key={r.id} value={r.id}>{r.name} (Cap: {r.capacity})</option>
                                                ))}
                                            </select>
                                            {modalForm.roomIds.length > 1 && (
                                                <button
                                                    type="button"
                                                    className={styles.removeLocationBtn}
                                                    onClick={() => removeRoom(idx)}
                                                    title="Remove this room"
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        className={styles.addLocationBtn}
                                        onClick={addRoom}
                                    >
                                        + Add Another Location
                                    </button>
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Day</label>
                                <select
                                    className="form-select form-input"
                                    value={modalForm.day}
                                    onChange={(e) => updateForm({ day: e.target.value })}
                                >
                                    {activeDays.map((d) => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>

                            {mode === 'exam' && (
                                <div className="form-group">
                                    <label className="form-label">Week</label>
                                    <select
                                        className="form-select form-input"
                                        value={modalForm.week || currentWeek}
                                        onChange={(e) => updateForm({ week: parseInt(e.target.value) })}
                                    >
                                        {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) => (
                                            <option key={w} value={w}>Week {w}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

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
                                disabled={!modalForm.courseId || !modalForm.roomIds.some((r) => r)}
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
