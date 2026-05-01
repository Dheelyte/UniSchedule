'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { DAYS, EXAM_DAYS, timeToMinutes } from '@/lib/utils';
import { apiClient } from '@/lib/apiClient';
import { detectConflicts, detectAllConflicts } from '@/lib/conflicts';
import { useToast } from '@/components/Toast/Toast';
import { useConfirm } from '@/components/ConfirmModal/ConfirmContext';
import SearchableSelect from '@/components/SearchableSelect/SearchableSelect';
import { hasGlobalScope, isGsAdmin, isViewerRole } from '@/lib/roles';
import styles from './TimetableGrid.module.css';

/** Safely parse a YYYY-MM-DD string into a Date without timezone issues */
function parseLocalDate(ds) {
    if (!ds) return new Date();
    const [y, m, d] = ds.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/** Format YYYY-MM-DD to readable label */
function formatDateLabel(ds, opts) {
    return parseLocalDate(ds).toLocaleDateString('en-GB', opts);
}

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

export default function TimetableGrid({ mode = 'lecture', semesterId = null, semesterName = null, readOnly = false, readOnlyReasons = [], blockedSlots = [], enrollmentsByCourse = null }) {
    const { state, dispatch, getSchedulesWithDetails } = useApp();
    const { faculties, departments, courses, rooms } = state;
    const { addToast } = useToast();
    const confirm = useConfirm();
    const { user } = useAuth();
    const isOwnItem = useCallback((schedule) => {
        if (!schedule) return false;
        if (isViewerRole(user?.role)) return false;
        if (user?.role === 'SUPER_ADMIN') return true;
        if (isGsAdmin(user?.role)) return schedule.courseScope === 'UNIVERSITY_WIDE';
        return !!user?.faculty_id && schedule.facultyId === user.faculty_id;
    }, [user?.role, user?.faculty_id]);

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
        examDate: '',
        startTime: '08:00',
        endTime: '10:00',
    });

    const [isSaving, setIsSaving] = useState(false);
    const [modalConflicts, setModalConflicts] = useState([]);
    const [deleteTarget, setDeleteTarget] = useState(null);

    // Drag & drop state
    const [dragItem, setDragItem] = useState(null);
    const [dragOverCell, setDragOverCell] = useState(null);

    // Date state (exam mode only)
    const examDates = useMemo(() => {
        if (mode !== 'exam') return [];
        const dateSet = new Set();
        getSchedulesWithDetails.filter(s => s.type === 'exam').forEach(s => {
            if (s.examDate) {
                dateSet.add(s.examDate);
            } else if (s.day) {
                // Legacy exams without exam_date: use day_of_week as a synthetic key
                dateSet.add(`legacy:${s.day}`);
            }
        });
        return Array.from(dateSet).sort();
    }, [getSchedulesWithDetails, mode]);

    const [addedDates, setAddedDates] = useState([]);

    const allActiveDates = useMemo(() => {
        const ds = new Set([...examDates, ...addedDates]);
        const arr = Array.from(ds).sort();
        return arr;
    }, [examDates, addedDates]);

    const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().split('T')[0]);

    useEffect(() => {
        if (mode === 'exam' && allActiveDates.length > 0 && !allActiveDates.includes(currentDate)) {
            setCurrentDate(allActiveDates[0]);
        }
    }, [mode, allActiveDates, currentDate]);

    const filteredDepts = filterFaculty
        ? departments.filter((d) => d.facultyId === filterFaculty)
        : departments;

    // ALL schedules of this mode (for conflicts across days/weeks)
    const allModeSchedules = useMemo(() => {
        return getSchedulesWithDetails.filter((s) => s.type === mode);
    }, [getSchedulesWithDetails, mode]);

    const departmentsById = useMemo(() => {
        const m = new Map();
        departments.forEach((d) => m.set(d.id, d.name));
        return m;
    }, [departments]);

    const conflictMap = useMemo(() => {
        return detectAllConflicts(allModeSchedules, enrollmentsByCourse, departmentsById);
    }, [allModeSchedules, enrollmentsByCourse, departmentsById]);

    // First schedule item (in render order) that has at least one error-severity conflict.
    const firstConflictItem = useMemo(() => {
        return allModeSchedules.find((s) => {
            const list = conflictMap.get(s.id);
            return list && list.some((c) => c.severity === 'error');
        }) || null;
    }, [allModeSchedules, conflictMap]);

    const totalConflictCount = useMemo(() => {
        let n = 0;
        for (const list of conflictMap.values()) {
            if (list.some((c) => c.severity === 'error')) n++;
        }
        return n;
    }, [conflictMap]);

    const [flashScheduleId, setFlashScheduleId] = useState(null);
    const flashTimerRef = useRef(null);
    const eventNodeRefs = useRef(new Map());

    useEffect(() => () => {
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    }, []);

    const jumpToFirstConflict = () => {
        if (!firstConflictItem) return;
        // Clear filters that could be hiding the conflicting item.
        setFilterFaculty('');
        setFilterDept('');
        if (mode === 'exam') {
            setCurrentDate(firstConflictItem.examDate || `legacy:${firstConflictItem.day}`);
        } else if (firstConflictItem.day) {
            setCurrentDay(firstConflictItem.day);
        }
        setFlashScheduleId(firstConflictItem.id);
        // Allow the grid to re-render after the day/date change before scrolling.
        requestAnimationFrame(() => {
            const node = eventNodeRefs.current.get(firstConflictItem.id);
            if (node && typeof node.scrollIntoView === 'function') {
                node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        });
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setFlashScheduleId(null), 2400);
    };

    // Rooms to render: own-faculty rooms + any room referenced by a visible schedule item.
    // Global-scope users see everything; this trims the grid for FACULTY editors/viewers.
    const displayedRooms = useMemo(() => {
        if (hasGlobalScope(user?.role) || !user?.faculty_id) return rooms;
        const referenced = new Set();
        allModeSchedules.forEach((s) => (s.roomIds || []).forEach((rid) => referenced.add(rid)));
        return rooms.filter((r) => r.faculty_id === user.faculty_id || r.faculty_id === null || referenced.has(r.id));
    }, [rooms, allModeSchedules, user?.role, user?.faculty_id]);

    // Filtered mode schedules (respecting faculty, dept, week) but independent of day
    const filteredModeSchedules = useMemo(() => {
        const deptId = filterDept ? Number(filterDept) : null;
        return allModeSchedules.filter((s) => {
            if (filterFaculty && s.facultyId !== filterFaculty) return false;
            if (deptId !== null && s.departmentId !== deptId) return false;
            return true;
        });
    }, [allModeSchedules, filterFaculty, filterDept]);

    // Schedules for ONLY the current day/date
    const daySchedules = useMemo(() => {
        if (mode === 'exam') {
            if (currentDate.startsWith('legacy:')) {
                const legacyDay = currentDate.replace('legacy:', '');
                return filteredModeSchedules.filter(s => !s.examDate && s.day === legacyDay);
            }
            return filteredModeSchedules.filter(s => s.examDate === currentDate);
        }
        return filteredModeSchedules.filter(s => s.day === currentDay);
    }, [filteredModeSchedules, currentDay, currentDate, mode]);

    // Blocked slots relevant for the current day/date
    const activeBlockedSlots = useMemo(() => {
        if (!blockedSlots || blockedSlots.length === 0) return [];
        return blockedSlots.filter(slot => {
            // Check applies_to scope
            const scope = slot.applies_to || 'BOTH';
            if (mode === 'lecture' && scope === 'EXAM_ONLY') return false;
            if (mode === 'exam' && scope === 'LECTURE_ONLY') return false;

            if (slot.type === 'HOLIDAY') {
                // For exam mode with exact dates, match the date
                if (mode === 'exam' && !currentDate.startsWith('legacy:')) {
                    return slot.date === currentDate;
                }
                return false; // Holidays don't show on lecture weekly grid
            }
            if (slot.type === 'EXTRACURRICULAR') {
                if (mode === 'exam') {
                    if (currentDate.startsWith('legacy:')) {
                        return slot.day_of_week === currentDate.replace('legacy:', '');
                    }
                    // Date-based blocks (EXAM_ONLY) match exact exam date
                    if (slot.date) return slot.date === currentDate;
                    // Day-of-week blocks (BOTH) match weekday of exam date
                    if (slot.day_of_week) {
                        const examDay = parseLocalDate(currentDate).toLocaleDateString('en-US', { weekday: 'long' });
                        return slot.day_of_week === examDay;
                    }
                    return false;
                }
                return slot.day_of_week === currentDay;
            }
            return false;
        });
    }, [blockedSlots, mode, currentDay, currentDate]);

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
        let filteredCourses = courses;
        // Restrict to courses offered in the current semester. Legacy courses with
        // no semester set are still shown so older data remains schedulable.
        if (semesterName) {
            filteredCourses = filteredCourses.filter((c) => !c.semester || c.semester === semesterName);
        }
        if (filterDept) {
            const deptId = Number(filterDept);
            filteredCourses = filteredCourses.filter((c) => c.departmentId === deptId);
        } else if (filterFaculty) {
            const deptIds = departments.filter((d) => d.facultyId === filterFaculty).map((d) => d.id);
            filteredCourses = filteredCourses.filter((c) => deptIds.includes(c.departmentId));
        }

        // Hide interfaculty courses originating from another faculty unless this faculty has enrolled in them.
        // Global-scope users (SUPER_ADMIN / SUPER_VIEWER) see everything.
        if (!hasGlobalScope(user?.role) && user?.faculty_id) {
            filteredCourses = filteredCourses.filter((c) => {
                if (c.scope !== 'INTERFACULTY') return true;
                const dept = departments.find((d) => d.id === c.departmentId);
                const isOwnFaculty = dept?.facultyId === user.faculty_id;
                return isOwnFaculty;
            });
        }

        // GS admins can only schedule university-wide courses.
        if (isGsAdmin(user?.role) && !editing) {
            filteredCourses = filteredCourses.filter((c) => c.scope === 'UNIVERSITY_WIDE');
        }

        if (mode === 'exam') {
            const scheduledCourseIds = new Set(allModeSchedules.map(s => s.courseId));
            if (editing) {
                scheduledCourseIds.delete(editing.courseId);
            }
            return filteredCourses.filter(c => !scheduledCourseIds.has(c.id));
        }
        return filteredCourses;
    }, [courses, departments, filterFaculty, filterDept, mode, allModeSchedules, editing, user?.role, user?.faculty_id, semesterName]);

    const handleCellClick = (roomId, hour) => {
        if (readOnly) return;
        const startTime = `${hour.toString().padStart(2, '0')}:00`;
        const endH = Math.min(hour + 2, 18);
        const endTime = `${endH.toString().padStart(2, '0')}:00`;
        setEditing(null);
        setModalConflicts([]);
        setModalForm({
            courseId: '',
            roomIds: roomId ? [roomId] : [''],
            day: currentDay,
            examDate: currentDate,
            startTime,
            endTime,
        });
        setShowModal(true);
    };

    const handleEventClick = (schedule, e) => {
        e.stopPropagation();
        if (readOnly) return; // viewing historical semester - no edits
        if (!isOwnItem(schedule)) return; // taking faculty: read-only on this item
        setEditing(schedule);
        setModalConflicts([]);
        const trimSec = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);
        setModalForm({
            courseId: schedule.courseId,
            roomIds: (schedule.roomIds && schedule.roomIds.length > 0)
                ? schedule.roomIds
                : (schedule.roomId ? [schedule.roomId] : ['']),
            day: schedule.day || 'Monday',
            examDate: schedule.examDate || currentDate,
            startTime: trimSec(schedule.startTime),
            endTime: trimSec(schedule.endTime),
        });
        setShowModal(true);
    };

    const enrichCandidate = (formData) => {
        const c = courses.find((cc) => cc.id === formData.courseId);
        const dept = c ? departments.find((d) => d.id === c.departmentId) : null;
        return {
            ...formData,
            type: mode,
            courseId: formData.courseId,
            courseDepartmentId: c?.departmentId ?? null,
            courseLevel: c?.level ?? null,
            courseScope: c?.scope ?? null,
            facultyId: dept?.facultyId ?? null,
        };
    };

    const validateForm = (formData) => {
        if (!formData.courseId || !formData.roomIds?.some((r) => r)) return;
        const result = detectConflicts(
            enrichCandidate(formData),
            allModeSchedules,
            editing?.id || null,
            enrollmentsByCourse,
            departmentsById,
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
            enrichCandidate(formWithCleanRooms),
            allModeSchedules,
            editing?.id || null,
            enrollmentsByCourse,
            departmentsById,
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

        const overrides = result.conflicts.filter((c) => c.priorityOverride);
        if (overrides.length > 0) {
            const candidateCourse = courses.find((c) => c.id === modalForm.courseId);
            const ok = await confirm({
                title: 'Higher-priority schedule will override',
                message:
                    `Saving "${candidateCourse?.code || 'this course'}" will create the following conflict(s) with lower-priority courses. ` +
                    `It will still be scheduled, but the affected faculty editors will be notified by email to reschedule. Continue?`,
                details: overrides.map((c) => c.message),
                confirmLabel: 'Schedule anyway',
                cancelLabel: 'Cancel',
                tone: 'primary',
            });
            if (!ok) return;
        } else if (result.hasWarning) {
            result.conflicts.filter((c) => c.severity === 'warning').forEach((c) => {
                addToast({
                    type: 'warning',
                    title: 'Schedule Warning',
                    message: c.message,
                    duration: 6000,
                });
            });
        }

        const payload = { ...formWithCleanRooms, type: mode };

        setIsSaving(true);
        try {
            if (editing) {
                const apiPayload = {
                    room_ids: validRoomIds,
                    day_of_week: mode === 'exam' ? null : payload.day,
                    exam_date: mode === 'exam' ? payload.examDate : null,
                    start_time: payload.startTime,
                    end_time: payload.endTime
                };
                await apiClient.put(`/timetable/schedule-items/${editing.id}`, apiPayload);
                dispatch({ type: ACTION_TYPES.UPDATE_SCHEDULE, payload: { id: editing.id, ...payload, examDate: payload.examDate } });
                addToast({ type: 'success', title: 'Schedule Updated', message: `${courses.find(c => c.id === modalForm.courseId)?.code || 'Course'} updated successfully.` });
            } else {
                const course = courses.find(c => c.id === modalForm.courseId);
                const dept = departments.find(d => d.id === course?.departmentId);
                const apiPayload = {
                    course_id: payload.courseId,
                    faculty_id: dept?.facultyId || faculties[0]?.id || '',
                    room_ids: validRoomIds,
                    day_of_week: mode === 'exam' ? null : payload.day,
                    exam_date: mode === 'exam' ? payload.examDate : null,
                    start_time: payload.startTime,
                    end_time: payload.endTime,
                    type: payload.type,
                };
                const res = await apiClient.post('/timetable/schedule-items', { ...apiPayload, semester_id: semesterId });
                dispatch({
                    type: ACTION_TYPES.ADD_SCHEDULE, payload: {
                        id: res.id,
                        courseId: parseInt(payload.courseId),
                        roomIds: (payload.roomIds || []).map(r => parseInt(r)),
                        facultyId: dept?.facultyId || faculties[0]?.id || '',
                        day: payload.day,
                        examDate: payload.examDate,
                        startTime: payload.startTime,
                        endTime: payload.endTime,
                        type: payload.type,
                        semester_id: semesterId,
                    }
                });
                addToast({ type: 'success', title: 'Course Scheduled', message: `${courses.find(c => c.id === modalForm.courseId)?.code || 'Course'} added to timetable.` });
            }
        } catch (e) {
            console.error('Failed to sync schedule', e);
            addToast({ type: 'error', title: 'Scheduling Error', message: e.message || 'Failed to synchronize with server.', duration: 8000 });
        } finally {
            setIsSaving(false);
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

        const samePos = mode === 'exam'
            ? (currentDate === dragItem.examDate && newStartTime === dragItem.startTime && dragItem.roomIds?.includes(roomId) && dragItem.roomIds.length === 1)
            : (currentDay === dragItem.day && newStartTime === dragItem.startTime && dragItem.roomIds?.includes(roomId) && dragItem.roomIds.length === 1);
        if (samePos) {
            setDragItem(null);
            return;
        }

        const candidate = {
            courseId: dragItem.courseId,
            roomIds: [roomId],
            day: mode === 'exam' ? null : currentDay,
            examDate: mode === 'exam' ? currentDate : null,
            startTime: newStartTime,
            endTime: newEndTime,
            type: mode,
            courseDepartmentId: dragItem.courseDepartmentId ?? null,
            courseLevel: dragItem.courseLevel ?? null,
            courseScope: dragItem.courseScope ?? null,
        };

        const result = detectConflicts(candidate, allModeSchedules, dragItem.id, enrollmentsByCourse, departmentsById);

        if (result.hasConflict) {
            result.conflicts.filter((c) => c.severity === 'error').forEach((c) => {
                addToast({ type: 'error', title: 'Conflict Detected', message: c.message, duration: 8000 });
            });
            setDragItem(null);
            return;
        }

        const overrides = result.conflicts.filter((c) => c.priorityOverride);
        if (overrides.length > 0) {
            const ok = await confirm({
                title: 'Higher-priority schedule will override',
                message:
                    `Moving "${dragItem.courseCode || 'this course'}" here will create the following conflict(s) with the courses below. ` +
                    `It will still be moved, but the affected faculty editors will be notified by email to reschedule. Continue?`,
                details: overrides.map((c) => c.message),
                confirmLabel: 'Move anyway',
                cancelLabel: 'Cancel',
                tone: 'primary',
            });
            if (!ok) {
                setDragItem(null);
                return;
            }
        } else if (result.hasWarning) {
            result.conflicts.filter((c) => c.severity === 'warning').forEach((c) => {
                addToast({ type: 'warning', title: 'Schedule Warning', message: c.message, duration: 6000 });
            });
        }

        try {
            const apiPayload = {
                room_ids: [roomId],
                day_of_week: mode === 'exam' ? null : currentDay,
                exam_date: mode === 'exam' ? currentDate : null,
                start_time: newStartTime,
                end_time: newEndTime
            };
            await apiClient.put(`/timetable/schedule-items/${dragItem.id}`, apiPayload);

            dispatch({
                type: ACTION_TYPES.UPDATE_SCHEDULE,
                payload: { id: dragItem.id, day: currentDay, examDate: currentDate, startTime: newStartTime, endTime: newEndTime, roomIds: [roomId] },
            });
            const moveLabel = mode === 'exam' ? formatDateLabel(currentDate, { weekday: 'short', month: 'short', day: 'numeric' }) : currentDay;
            addToast({
                type: 'success',
                title: 'Course Moved',
                message: `${dragItem.courseCode || 'Course'} moved to ${moveLabel} ${newStartTime}–${newEndTime}.`,
            });
        } catch (err) {
            console.error('Drop error', err);
            addToast({ type: 'error', title: 'Scheduling Error', message: err.message || 'Failed to synchronize movement with server.', duration: 8000 });
        }

        setDragItem(null);
    }, [dragItem, allModeSchedules, mode, dispatch, addToast, currentDay, currentDate, enrollmentsByCourse]);

    const timeOptions = [];
    for (let h = 8; h <= 18; h++) {
        timeOptions.push(`${h.toString().padStart(2, '0')}:00`);
        if (h < 18) timeOptions.push(`${h.toString().padStart(2, '0')}:30`);
    }

    const visibleConflictCount = daySchedules.filter((s) => conflictMap.has(s.id)).length;

    const getAvailableRooms = (currentIndex) => {
        const selectedIds = modalForm.roomIds.filter((_, i) => i !== currentIndex);
        let pool = rooms;
        // Faculty editors can only schedule into their own faculty's rooms (and shared/unassigned ones).
        if (!hasGlobalScope(user?.role) && user?.faculty_id) {
            pool = pool.filter((r) => r.faculty_id === user.faculty_id || r.faculty_id === null);
        }
        return pool.filter((r) => !selectedIds.includes(r.id));
    };

    return (
        <div className={styles.container}>
            {readOnly && readOnlyReasons.length > 0 && (
                <div style={{
                    background: '#fef9c3', border: '1px solid #fcd34d', borderRadius: '8px',
                    padding: '10px 16px', marginBottom: '12px', fontSize: '0.875rem',
                    color: '#92400e', display: 'flex', alignItems: 'flex-start', gap: '8px'
                }}>
                    <span aria-hidden>🔒</span>
                    <div>
                        <strong>Read-only view</strong>
                        {readOnlyReasons.length === 1 ? (
                            <span>: {readOnlyReasons[0]}</span>
                        ) : (
                            <ul style={{ margin: '4px 0 0 0px', padding: 0 }}>
                                {readOnlyReasons.map((r, i) => <li key={i}>{r}</li>)}
                            </ul>
                        )}
                    </div>
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
                        {daySchedules.length} {mode === 'lecture' ? 'lecture' : 'exam'}{daySchedules.length !== 1 ? 's' : ''} on {mode === 'exam' ? (currentDate.startsWith('legacy:') ? currentDate.replace('legacy:', '') : formatDateLabel(currentDate, { day: 'numeric', month: 'short', year: 'numeric' })) : currentDay}
                        {visibleConflictCount > 0 && (
                            <span className={styles.conflictBadge}>
                                ⚠ {visibleConflictCount} conflict{visibleConflictCount !== 1 ? 's' : ''}
                            </span>
                        )}
                        {totalConflictCount > 0 && firstConflictItem && (
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ marginLeft: 8, padding: '2px 10px', fontSize: '0.78rem' }}
                                onClick={jumpToFirstConflict}
                                title={`Jump to ${firstConflictItem.courseCode}`}
                            >
                                Go to conflict → {firstConflictItem.courseCode}
                            </button>
                        )}
                    </span>
                </div>
            </div>

            {/* Day selector bar */}
            {mode === 'exam' ? (
                <div className={styles.dayBar}>
                    {allActiveDates.length === 0 && <span style={{ color: 'var(--color-text-muted)', marginRight: '16px', fontSize: '0.9rem' }}>No exam dates scheduled yet.</span>}
                    {allActiveDates.map(date => {
                        const count = filteredModeSchedules.filter(s => s.examDate === date).length;
                        return (
                            <button
                                key={date}
                                className={`${styles.dayBtn} ${currentDate === date ? styles.dayBtnActive : ''}`}
                                onClick={() => setCurrentDate(date)}
                            >
                                {date.startsWith('legacy:') ? `⚠ ${date.replace('legacy:', '')} (no date)` : formatDateLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })}
                                {count > 0 && <span className={styles.dayChip}>{count}</span>}
                            </button>
                        );
                    })}
                    {!readOnly && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                            <input
                                type="date"
                                className="form-input"
                                style={{ padding: '4px 8px', width: 'auto', fontSize: '0.85rem' }}
                                id="exam-date-adder"
                            />
                            <button
                                className={`${styles.dayBtn}`}
                                style={{ whiteSpace: 'nowrap', fontWeight: 600 }}
                                onClick={() => {
                                    const input = document.getElementById('exam-date-adder');
                                    const val = input?.value;
                                    if (val) {
                                        if (!allActiveDates.includes(val)) {
                                            setAddedDates(prev => [...prev, val]);
                                        }
                                        setCurrentDate(val);
                                        input.value = '';
                                    }
                                }}
                            >
                                + Add Date
                            </button>
                        </div>
                    )}
                </div>
            ) : (
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
                                    <span className={styles.dayChip}>{count}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

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
                                {hour.toString().padStart(2, '0')}:00 - {(hour + 1).toString().padStart(2, '0')}:00
                            </span>
                        </div>
                    ))}

                    {/* Room rows */}
                    {displayedRooms.map((room) => {
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
                                            {isCellEmpty && !readOnly && <span className={styles.cellHint}>+ Add</span>}
                                            {!readOnly && (
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
                                            )}

                                            {/* Blocked slot overlays */}
                                            {activeBlockedSlots.filter(slot => {
                                                if (slot.type === 'HOLIDAY') return true; // Full day
                                                if (!slot.start_time || !slot.end_time) return true; // Whole-day block
                                                const slotStart = timeToMinutes(slot.start_time.slice(0, 5));
                                                const slotEnd = timeToMinutes(slot.end_time.slice(0, 5));
                                                const cellStart = hour * 60;
                                                const cellEnd = (hour + 1) * 60;
                                                return slotStart < cellEnd && slotEnd > cellStart;
                                            }).map((slot, si) => {
                                                let leftPct = 0;
                                                let widthPct = 100;
                                                if (slot.type !== 'HOLIDAY' && slot.start_time && slot.end_time) {
                                                    const slotStart = timeToMinutes(slot.start_time.slice(0, 5));
                                                    const slotEnd = timeToMinutes(slot.end_time.slice(0, 5));
                                                    const cellStart = hour * 60;
                                                    const cellEnd = (hour + 1) * 60;
                                                    leftPct = Math.max(0, ((slotStart - cellStart) / 60) * 100);
                                                    widthPct = Math.min(100, ((Math.min(slotEnd, cellEnd) - Math.max(slotStart, cellStart)) / 60) * 100);
                                                }
                                                return (
                                                    <div
                                                        key={`blocked-${slot.id}-${si}`}
                                                        style={{
                                                            position: 'absolute',
                                                            top: 0,
                                                            left: `${leftPct}%`,
                                                            width: `${widthPct}%`,
                                                            height: '100%',
                                                            background: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.10), rgba(239,68,68,0.10) 4px, rgba(239,68,68,0.05) 4px, rgba(239,68,68,0.05) 8px)',
                                                            borderTop: '2px solid rgba(239,68,68,0.35)',
                                                            borderBottom: '2px solid rgba(239,68,68,0.35)',
                                                            zIndex: 1,
                                                            pointerEvents: 'none',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }}
                                                        title={`Blocked: ${slot.name}`}
                                                    >
                                                        <span style={{ fontSize: '0.6rem', color: 'rgba(239,68,68,0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                            {slot.name}
                                                        </span>
                                                    </div>
                                                );
                                            })}

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

                                                const isFlashing = flashScheduleId === s.id;
                                                return (
                                                    <div
                                                        key={s.id}
                                                        ref={(el) => {
                                                            if (el) eventNodeRefs.current.set(s.id, el);
                                                            else eventNodeRefs.current.delete(s.id);
                                                        }}
                                                        className={`${styles.event} ${hasError ? styles.eventConflict : ''} ${dragItem?.id === s.id ? styles.eventDragging : ''}`}
                                                        style={{
                                                            top: `calc(${topOffset}% + 4px)`,
                                                            height: `calc(${rowHeight}% - 8px)`,
                                                            left: `${leftPct}%`,
                                                            width: `calc(${widthPct}% - 4px)`,
                                                            background: hasError ? 'rgba(239, 68, 68, 0.15)' : color.bg,
                                                            borderLeftColor: hasError ? '#ef4444' : color.border,
                                                            outline: isFlashing ? '3px solid #f59e0b' : undefined,
                                                            boxShadow: isFlashing ? '0 0 0 4px rgba(245, 158, 11, 0.35)' : undefined,
                                                            transition: 'outline 0.2s, box-shadow 0.2s',
                                                            zIndex: isFlashing ? 5 : undefined,
                                                        }}
                                                        draggable={!readOnly && isOwnItem(s)}
                                                        onDragStart={(e) => handleDragStart(s, e)}
                                                        onDragEnd={handleDragEnd}
                                                        onClick={(e) => handleEventClick(s, e)}
                                                        title={hasConflict ? itemConflicts.map((c) => c.message).join('\n') : `${s.courseCode} - ${s.roomNames}${!isOwnItem(s) ? ' (read-only — owned by another faculty)' : ''}`}
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
                                <SearchableSelect
                                    options={modalCourses.map(c => ({ value: c.id, label: `${c.code} - ${c.title}` }))}
                                    value={modalForm.courseId}
                                    onChange={(val) => updateForm({ courseId: val })}
                                    placeholder="Select a course..."
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Room{modalForm.roomIds.length > 1 ? 's' : ''}</label>
                                <div className={styles.locationList}>
                                    {modalForm.roomIds.map((rid, idx) => (
                                        <div key={idx} className={styles.locationRow}>
                                            <SearchableSelect
                                                options={getAvailableRooms(idx).map(r => ({ value: r.id, label: `${r.name} (Cap: ${r.capacity})` }))}
                                                value={rid}
                                                onChange={(val) => updateRoom(idx, val)}
                                                placeholder="Select a room..."
                                            />
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

                            {mode === 'exam' ? (
                                <div className="form-group">
                                    <label className="form-label">Exam Date</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={modalForm.examDate}
                                        onChange={(e) => updateForm({ examDate: e.target.value })}
                                    />
                                </div>
                            ) : (
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
                                    disabled={isSaving}
                                >
                                    Delete
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={isSaving}>Cancel</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSave}
                                disabled={!modalForm.courseId || !modalForm.roomIds.some((r) => r) || isSaving}
                            >
                                {isSaving ? 'Saving...' : (editing ? 'Save Changes' : 'Add to Timetable')}
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
