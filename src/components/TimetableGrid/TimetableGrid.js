'use client';

import { useState, useMemo, useCallback } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import { DAYS, EXAM_DAYS, timeToMinutes } from '@/lib/utils';
import { detectConflicts, detectAllConflicts } from '@/lib/conflicts';
import { useToast } from '@/components/Toast/Toast';
import styles from './TimetableGrid.module.css';

const HOURS = Array.from({ length: 10 }, (_, i) => i + 8); // 8..17
const MAX_VISIBLE_EVENTS = 3; // Max events shown side-by-side before "+N more"

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

/**
 * Compute side-by-side layout columns for overlapping events.
 * Returns a Map of scheduleId → { col, totalCols }.
 */
function computeOverlapLayout(events) {
    if (events.length <= 1) {
        const map = new Map();
        if (events.length === 1) map.set(events[0].id, { col: 0, totalCols: 1 });
        return map;
    }

    // Sort by start time, then by end time (earlier end first)
    const sorted = [...events].sort((a, b) => {
        const diff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
        return diff !== 0 ? diff : timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
    });

    // Assign columns using a greedy algorithm
    const columns = []; // columns[i] = end time of last event in column i
    const assignments = new Map();

    sorted.forEach((ev) => {
        const start = timeToMinutes(ev.startTime);
        let placed = false;
        for (let c = 0; c < columns.length; c++) {
            if (columns[c] <= start) {
                columns[c] = timeToMinutes(ev.endTime);
                assignments.set(ev.id, { col: c, totalCols: 0 });
                placed = true;
                break;
            }
        }
        if (!placed) {
            assignments.set(ev.id, { col: columns.length, totalCols: 0 });
            columns.push(timeToMinutes(ev.endTime));
        }
    });

    // Now find true overlap groups and set totalCols per group
    // A group is a set of events that all mutually overlap (connected component via time overlap)
    const groups = [];
    const visited = new Set();

    sorted.forEach((ev) => {
        if (visited.has(ev.id)) return;
        // BFS to find all events in this connected overlap group
        const group = [];
        const queue = [ev];
        visited.add(ev.id);
        while (queue.length > 0) {
            const curr = queue.shift();
            group.push(curr);
            sorted.forEach((other) => {
                if (visited.has(other.id)) return;
                // Check if any event in the group overlaps with other
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
        const maxCol = Math.max(...group.map((e) => assignments.get(e.id).col)) + 1;
        group.forEach((e) => {
            assignments.get(e.id).totalCols = maxCol;
        });
    });

    return assignments;
}

export default function TimetableGrid({ mode = 'lecture' }) {
    const { state, dispatch, getSchedulesWithDetails } = useApp();
    const { faculties, departments, courses, rooms } = state;
    const { addToast } = useToast();

    // Map correct day array
    const activeDays = mode === 'exam' ? EXAM_DAYS : DAYS;

    // Filters
    const [filterFaculty, setFilterFaculty] = useState('');
    const [filterDept, setFilterDept] = useState('');

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

    // Validation state
    const [modalConflicts, setModalConflicts] = useState([]);

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState(null);

    // Overflow popover (for +N more)
    const [overflowPopover, setOverflowPopover] = useState(null); // { day, hour, schedules, rect }

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

    // Filtered departments based on faculty
    const filteredDepts = filterFaculty
        ? departments.filter((d) => d.facultyId === filterFaculty)
        : departments;

    // Get schedules for current mode, filtered by faculty/dept (and week for exams)
    const schedules = useMemo(() => {
        return getSchedulesWithDetails.filter((s) => {
            if (s.type !== mode) return false;
            if (filterFaculty && s.facultyId !== filterFaculty) return false;
            if (filterDept && s.departmentId !== filterDept) return false;
            if (mode === 'exam' && s.week && s.week !== currentWeek) return false;
            return true;
        });
    }, [getSchedulesWithDetails, mode, filterFaculty, filterDept, currentWeek]);

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

    // Pre-compute overlap layout for each day
    const overlapLayoutMap = useMemo(() => {
        const dayMap = {};
        activeDays.forEach((day) => {
            const daySchedules = schedules.filter((s) => s.day === day);
            const layout = computeOverlapLayout(daySchedules);
            layout.forEach((val, key) => {
                dayMap[key] = val;
            });
        });
        return dayMap;
    }, [schedules, activeDays]);

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
            roomIds: [rooms[0]?.id || ''],
            day,
            startTime,
            endTime,
            ...(mode === 'exam' ? { week: currentWeek } : {}),
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
            roomIds: schedule.roomIds || (schedule.roomId ? [schedule.roomId] : ['']),
            day: schedule.day,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            ...(mode === 'exam' ? { week: schedule.week || currentWeek } : {}),
        });
        setShowModal(true);
    };

    // Live validation when modal form changes
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

    // Room list management for modal
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

    // Save schedule
    const handleSave = () => {
        const validRoomIds = modalForm.roomIds.filter((r) => r);
        if (!modalForm.courseId || validRoomIds.length === 0) return;

        const formWithCleanRooms = { ...modalForm, roomIds: validRoomIds };

        // Run final conflict check
        const result = detectConflicts(
            { ...formWithCleanRooms, type: mode },
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

        const payload = { ...formWithCleanRooms, type: mode, ...(mode === 'exam' ? { week: formWithCleanRooms.week || currentWeek } : {}) };
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

    // ---- Drag & Drop Handlers ----
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

    const handleCellDragEnter = useCallback((day, hour) => {
        setDragOverCell(`${day}-${hour}`);
    }, []);

    const handleCellDragLeave = useCallback(() => {
        setDragOverCell(null);
    }, []);

    const handleDrop = useCallback((day, hour, e) => {
        e.preventDefault();
        setDragOverCell(null);
        if (!dragItem) return;

        // Calculate duration in minutes
        const oldStart = timeToMinutes(dragItem.startTime);
        const oldEnd = timeToMinutes(dragItem.endTime);
        const duration = oldEnd - oldStart;

        const newStartMin = hour * 60;
        const newEndMin = newStartMin + duration;

        // Clamp to 18:00
        if (newEndMin > 18 * 60) {
            addToast({ type: 'warning', title: 'Cannot Drop', message: 'The course would extend past 6:00 PM.' });
            setDragItem(null);
            return;
        }

        const newStartTime = `${Math.floor(newStartMin / 60).toString().padStart(2, '0')}:${(newStartMin % 60).toString().padStart(2, '0')}`;
        const newEndTime = `${Math.floor(newEndMin / 60).toString().padStart(2, '0')}:${(newEndMin % 60).toString().padStart(2, '0')}`;

        // Skip if same position
        if (day === dragItem.day && newStartTime === dragItem.startTime) {
            setDragItem(null);
            return;
        }

        // Conflict check
        const candidate = {
            courseId: dragItem.courseId,
            roomIds: dragItem.roomIds || [],
            day,
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

        dispatch({
            type: ACTION_TYPES.UPDATE_SCHEDULE,
            payload: { id: dragItem.id, day, startTime: newStartTime, endTime: newEndTime },
        });
        addToast({
            type: 'success',
            title: 'Course Moved',
            message: `${dragItem.courseCode} moved to ${day} ${newStartTime}–${newEndTime}.`,
        });
        setDragItem(null);
    }, [dragItem, allModeSchedules, mode, dispatch, addToast]);

    // Time options
    const timeOptions = [];
    for (let h = 8; h <= 18; h++) {
        timeOptions.push(`${h.toString().padStart(2, '0')}:00`);
        if (h < 18) timeOptions.push(`${h.toString().padStart(2, '0')}:30`);
    }

    // Count conflicts in the visible grid
    const visibleConflictCount = schedules.filter((s) => conflictMap.has(s.id)).length;

    // Get rooms already selected (to filter dropdown options)
    const getAvailableRooms = (currentIndex) => {
        const selectedIds = modalForm.roomIds.filter((_, i) => i !== currentIndex);
        return rooms.filter((r) => !selectedIds.includes(r.id));
    };

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

            {/* Grid */}
            <div className={styles.gridWrapper} id="timetable-grid">
                <div
                    className={styles.grid}
                    style={{ '--grid-columns': `80px repeat(${activeDays.length}, 1fr)` }}
                >
                    {/* Header row */}
                    <div className={styles.cornerCell}>
                        <span className={styles.cornerLabel}>Time</span>
                    </div>
                    {activeDays.map((day) => (
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
                            {activeDays.map((day) => {
                                const cellSchedules = schedules.filter(
                                    (s) => s.day === day
                                );

                                // Find events that START in this cell
                                const cellStart = (hour - 8) * 2;
                                const cellEnd = cellStart + 2;
                                const cellEvents = cellSchedules.filter((s) => {
                                    const startRow = timeToRow(s.startTime);
                                    return startRow >= cellStart && startRow < cellEnd;
                                });

                                // Determine if cell is entirely empty
                                const isCellEmpty = !cellSchedules.some((s) => {
                                    const startRow = timeToRow(s.startTime);
                                    const endRow = timeToRow(s.endTime);
                                    return startRow < cellEnd && endRow > cellStart;
                                });

                                // Determine if we need overflow
                                const needsOverflow = cellEvents.length > MAX_VISIBLE_EVENTS;
                                const visibleEvents = needsOverflow ? cellEvents.slice(0, MAX_VISIBLE_EVENTS - 1) : cellEvents;
                                const overflowCount = needsOverflow ? cellEvents.length - visibleEvents.length : 0;
                                const visibleCols = needsOverflow ? MAX_VISIBLE_EVENTS : undefined; // force column count when overflowing

                                return (
                                    <div
                                        key={`${day}-${hour}`}
                                        className={`${styles.cell} ${dragOverCell === `${day}-${hour}` ? styles.cellDragOver : ''}`}
                                        onClick={() => handleCellClick(day, hour)}
                                        onDragOver={handleCellDragOver}
                                        onDragEnter={() => handleCellDragEnter(day, hour)}
                                        onDragLeave={handleCellDragLeave}
                                        onDrop={(e) => handleDrop(day, hour, e)}
                                    >
                                        {isCellEmpty && <span className={styles.cellHint}>+ Add</span>}
                                        <button
                                            className={styles.quickAddBtn}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleCellClick(day, hour);
                                            }}
                                            title="Add new course here"
                                        >
                                            +
                                        </button>

                                        {/* Schedule blocks */}
                                        {cellSchedules.map((s) => {
                                            const startRow = timeToRow(s.startTime);
                                            const endRow = timeToRow(s.endTime);

                                            // Only render if this block starts in this cell
                                            if (startRow < cellStart || startRow >= cellEnd) return null;

                                            // Skip if this event is hidden by overflow
                                            if (needsOverflow && !visibleEvents.includes(s)) return null;

                                            const span = endRow - startRow;
                                            const color = courseColorMap[s.courseId] || COLORS[0];
                                            const hasConflict = conflictMap.has(s.id);
                                            const itemConflicts = conflictMap.get(s.id) || [];
                                            const hasError = itemConflicts.some((c) => c.severity === 'error');

                                            // Side-by-side layout — use capped columns when overflowing
                                            const layout = overlapLayoutMap[s.id] || { col: 0, totalCols: 1 };
                                            const totalCols = visibleCols || layout.totalCols;
                                            const col = needsOverflow ? visibleEvents.indexOf(s) : layout.col;
                                            const colWidth = 100 / totalCols;
                                            const leftPct = col * colWidth;

                                            return (
                                                <div
                                                    key={s.id}
                                                    className={`${styles.event} ${hasError ? styles.eventConflict : ''} ${dragItem?.id === s.id ? styles.eventDragging : ''}`}
                                                    style={{
                                                        top: `${((startRow - cellStart) / 2) * 100}%`,
                                                        height: `${(span / 2) * 100}%`,
                                                        left: `${leftPct}%`,
                                                        width: `${colWidth}%`,
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
                                                    <span className={styles.eventRoom}>{s.roomNames}</span>
                                                    <span className={styles.eventTime}>{s.startTime}–{s.endTime}</span>
                                                </div>
                                            );
                                        })}

                                        {/* +N more badge */}
                                        {needsOverflow && (
                                            <div
                                                className={styles.overflowBadge}
                                                style={{
                                                    top: `${((timeToRow(cellEvents[0].startTime) - cellStart) / 2) * 100}%`,
                                                    left: `${((MAX_VISIBLE_EVENTS - 1) / MAX_VISIBLE_EVENTS) * 100}%`,
                                                    width: `${100 / MAX_VISIBLE_EVENTS}%`,
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    setOverflowPopover({
                                                        day,
                                                        hour,
                                                        schedules: cellEvents,
                                                        rect: { top: rect.bottom + 4, left: rect.left },
                                                    });
                                                }}
                                            >
                                                +{overflowCount} more
                                            </div>
                                        )}

                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            {/* Overflow Popover */}
            {overflowPopover && (
                <>
                    <div className={styles.popoverBackdrop} onClick={() => setOverflowPopover(null)} />
                    <div
                        className={styles.overflowPopover}
                        style={{
                            top: overflowPopover.rect.top,
                            left: overflowPopover.rect.left,
                        }}
                    >
                        <div className={styles.popoverHeader}>
                            <span className={styles.popoverTitle}>
                                {overflowPopover.day} — {overflowPopover.schedules[0]?.startTime}
                            </span>
                            <span className={styles.popoverCount}>
                                {overflowPopover.schedules.length} courses
                            </span>
                            <button className={styles.popoverClose} onClick={() => setOverflowPopover(null)}>✕</button>
                        </div>
                        <div className={styles.popoverList}>
                            {overflowPopover.schedules.map((s) => {
                                const color = courseColorMap[s.courseId] || COLORS[0];
                                const hasConflict = conflictMap.has(s.id);
                                return (
                                    <div
                                        key={s.id}
                                        className={`${styles.popoverItem} ${hasConflict ? styles.popoverItemConflict : ''}`}
                                        style={{ borderLeftColor: color.border }}
                                        onClick={(e) => {
                                            setOverflowPopover(null);
                                            handleEventClick(s, e);
                                        }}
                                    >
                                        <span className={styles.popoverCode} style={{ color: color.border }}>
                                            {hasConflict && '⚠ '}{s.courseCode}
                                        </span>
                                        <span className={styles.popoverRoom}>{s.roomNames}</span>
                                        <span className={styles.popoverTime}>{s.startTime}–{s.endTime}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

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

                            {/* Multi-location room picker */}
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
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="12" y1="5" x2="12" y2="19" />
                                            <line x1="5" y1="12" x2="19" y2="12" />
                                        </svg>
                                        Add Another Location
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
