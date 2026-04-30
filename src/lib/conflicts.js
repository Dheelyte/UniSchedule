/**
 * Conflict Detection Engine
 *
 * Detects three types of conflicts:
 * 1. Room Conflict - any shared room booked for overlapping times on the same day
 * 2. Course Conflict - same course scheduled at overlapping times on the same day
 * 3. Time Conflict - scheduling outside standard operating hours (8 AM – 6 PM)
 *
 * Schedule items use `roomIds` (array) to support multiple locations per session.
 */

import { timesOverlap, isOutsideOperatingHours } from './utils';

/**
 * Check whether two schedule items share at least one room.
 * Handles both the new `roomIds` array and legacy `roomId` string.
 */
function sharesRoom(a, b) {
    const aRooms = a.roomIds || (a.roomId ? [a.roomId] : []);
    const bRooms = b.roomIds || (b.roomId ? [b.roomId] : []);
    return aRooms.some((rid) => bRooms.includes(rid));
}

/** Get displayable room list from a schedule item. */
function getRoomLabel(s) {
    return s.roomNames || s.roomName || 'Room';
}

/**
 * Compute the (department, level) audiences that an item targets.
 * Originating audience comes from the joined course; additional audiences come from
 * `course_enrollments` via the `enrollmentsByCourse` lookup map.
 */
const UW_DEPT = 'university-wide';

function audiencesOf(item, enrollmentsByCourse) {
    const out = [];
    if (item.courseScope === 'UNIVERSITY_WIDE') {
        // UW courses target every department at the course's level (null level = all levels).
        out.push({ deptId: UW_DEPT, level: item.courseLevel ?? null });
    } else if (item.courseDepartmentId) {
        out.push({ deptId: item.courseDepartmentId, level: item.courseLevel ?? null });
    }
    const extras = enrollmentsByCourse?.get(item.courseId) || [];
    extras.forEach((e) => {
        out.push({ deptId: e.department_id, level: e.level });
    });
    return out;
}

/**
 * (department, level) overlap. NULL level acts as a wildcard ("all levels").
 * `UW_DEPT` acts as a wildcard department (every student at that level).
 */
function audienceOverlaps(a, b) {
    if (a.deptId !== b.deptId && a.deptId !== UW_DEPT && b.deptId !== UW_DEPT) return false;
    if (a.level === null || b.level === null) return true;
    return a.level === b.level;
}

function findAudienceClash(a, b, enrollmentsByCourse) {
    const aAud = audiencesOf(a, enrollmentsByCourse);
    if (aAud.length === 0) return null;
    const bAud = audiencesOf(b, enrollmentsByCourse);
    if (bAud.length === 0) return null;
    for (const x of aAud) {
        for (const y of bAud) {
            if (audienceOverlaps(x, y)) {
                const concreteDept = x.deptId !== UW_DEPT ? x.deptId : (y.deptId !== UW_DEPT ? y.deptId : UW_DEPT);
                return { deptId: concreteDept, level: x.level ?? y.level ?? null };
            }
        }
    }
    return null;
}

/**
 * Check all conflicts for a given schedule item against existing schedules.
 * @param {Object} candidate - The schedule item to check { courseId, roomIds, day, startTime, endTime, type }
 * @param {Array} allSchedules - All existing schedule items (with details)
 * @param {string|null} excludeId - ID to exclude (for editing existing items)
 * @returns {{ hasConflict: boolean, conflicts: Array<{type: string, message: string, severity: string}> }}
 */
export function detectConflicts(candidate, allSchedules, excludeId = null, enrollmentsByCourse = null) {
    const conflicts = [];

    // For exam mode: check for duplicate course across ALL weeks/days
    if (candidate.type === 'exam') {
        const duplicateCourse = allSchedules.find(
            (s) => s.id !== excludeId && s.type === 'exam' && s.courseId === candidate.courseId
        );
        if (duplicateCourse) {
            conflicts.push({
                type: 'duplicate',
                severity: 'error',
                message: `Duplicate exam: "${duplicateCourse.courseCode || 'Course'}" already has an exam scheduled on ${duplicateCourse.day}${duplicateCourse.week ? ` (Week ${duplicateCourse.week})` : ''} ${duplicateCourse.startTime}–${duplicateCourse.endTime}.`,
            });
        }
    }

    // For room/time overlap checks: scope to same day + same type
    // In exam mode, also scope to same week
    const relevantSchedules = allSchedules.filter((s) => {
        if (s.id === excludeId) return false;
        if (s.day !== candidate.day || s.type !== candidate.type) return false;
        if (candidate.type === 'exam' && s.week !== candidate.week) return false;
        return true;
    });

    // 1. Room Conflict - any shared room in overlapping time (Exams are allowed to share rooms)
    if (candidate.type !== 'exam') {
        const roomConflicts = relevantSchedules.filter(
            (s) =>
                sharesRoom(candidate, s) &&
                timesOverlap(
                    { startTime: candidate.startTime, endTime: candidate.endTime },
                    { startTime: s.startTime, endTime: s.endTime }
                )
        );

        roomConflicts.forEach((s) => {
            conflicts.push({
                type: 'room',
                severity: 'error',
                message: `Room conflict: "${getRoomLabel(s)}" is already booked for ${s.courseCode || 'a course'} on ${s.day} ${s.startTime}–${s.endTime}.`,
            });
        });
    }

    // 2. Course Conflict (same course at overlapping times on same day)
    // In lecture mode, this is allowed (courses can repeat)
    // In exam mode, duplicate is already caught above
    if (candidate.type === 'lecture') {
        const courseConflicts = relevantSchedules.filter(
            (s) =>
                s.courseId === candidate.courseId &&
                timesOverlap(
                    { startTime: candidate.startTime, endTime: candidate.endTime },
                    { startTime: s.startTime, endTime: s.endTime }
                )
        );

        courseConflicts.forEach((s) => {
            conflicts.push({
                type: 'course',
                severity: 'error',
                message: `Course conflict: "${s.courseCode || 'Course'}" is already scheduled on ${s.day} ${s.startTime}–${s.endTime}.`,
            });
        });
    }

    // 3. Audience Conflict (same department × level scheduled at the same time = student double-booking)
    relevantSchedules.forEach((s) => {
        const overlap = timesOverlap(
            { startTime: candidate.startTime, endTime: candidate.endTime },
            { startTime: s.startTime, endTime: s.endTime },
        );
        if (!overlap) return;
        const clash = findAudienceClash(candidate, s, enrollmentsByCourse);
        if (clash) {
            const isUW = clash.deptId === 'university-wide';
            const levelSuffix = clash.level ? ` (${clash.level}L)` : '';
            const audienceLabel = isUW
                ? `all students${levelSuffix}`
                : `dept ${clash.deptId}${levelSuffix}`;
            conflicts.push({
                type: 'audience',
                severity: 'error',
                message: `Audience clash: ${s.courseCode || 'a course'} also targets ${audienceLabel} on ${s.day || s.examDate} ${s.startTime}–${s.endTime}.`,
            });
        }
    });

    // 4. Time Conflict (outside operating hours)
    if (isOutsideOperatingHours(candidate.startTime, candidate.endTime)) {
        conflicts.push({
            type: 'time',
            severity: 'warning',
            message: `Time warning: This slot (${candidate.startTime}–${candidate.endTime}) falls outside standard operating hours (08:00–18:00).`,
        });
    }

    return {
        hasConflict: conflicts.some((c) => c.severity === 'error'),
        hasWarning: conflicts.length > 0,
        conflicts,
    };
}

/**
 * Detect ALL conflicts across the entire schedule.
 * Returns a Map of scheduleId → array of conflict objects.
 * @param {Array} allSchedules - All schedule items with details
 * @returns {Map<string, Array>}
 */
export function detectAllConflicts(allSchedules, enrollmentsByCourse = null) {
    const conflictMap = new Map();

    for (let i = 0; i < allSchedules.length; i++) {
        const a = allSchedules[i];
        const itemConflicts = [];

        // Exam mode: check for duplicate course across all weeks/days
        if (a.type === 'exam') {
            for (let j = 0; j < allSchedules.length; j++) {
                if (i === j) continue;
                const b = allSchedules[j];
                if (b.type !== 'exam') continue;
                if (a.courseId === b.courseId) {
                    itemConflicts.push({
                        type: 'duplicate',
                        severity: 'error',
                        message: `Duplicate exam: ${b.courseCode} already scheduled on ${b.day}${b.week ? ` (Week ${b.week})` : ''} ${b.startTime}–${b.endTime}`,
                        relatedId: b.id,
                    });
                }
            }
        }

        for (let j = 0; j < allSchedules.length; j++) {
            if (i === j) continue;
            const b = allSchedules[j];

            if (a.day !== b.day || a.type !== b.type) continue;
            // In exam mode, room/time conflicts only within same week
            if (a.type === 'exam' && a.week !== b.week) continue;

            const overlaps = timesOverlap(
                { startTime: a.startTime, endTime: a.endTime },
                { startTime: b.startTime, endTime: b.endTime }
            );

            if (!overlaps) continue;

            // Room conflict - any shared room (Exams can share rooms)
            if (a.type !== 'exam' && sharesRoom(a, b)) {
                itemConflicts.push({
                    type: 'room',
                    severity: 'error',
                    message: `Room "${getRoomLabel(b)}" double-booked with ${b.courseCode} (${b.startTime}–${b.endTime})`,
                    relatedId: b.id,
                });
            }

            // Course conflict (only for lectures - exam duplicates already handled above)
            if (a.type === 'lecture' && a.courseId === b.courseId) {
                itemConflicts.push({
                    type: 'course',
                    severity: 'error',
                    message: `${b.courseCode} is scheduled again at ${b.startTime}–${b.endTime}`,
                    relatedId: b.id,
                });
            }

            // Audience conflict — same dept × level booked twice in the same time window
            if (a.courseId !== b.courseId) {
                const clash = findAudienceClash(a, b, enrollmentsByCourse);
                if (clash) {
                    const isUW = clash.deptId === 'university-wide';
                    const audienceLabel = isUW
                        ? 'all students (university-wide course)'
                        : `dept ${clash.deptId}${clash.level ? ` (${clash.level}L)` : ''}`;
                    itemConflicts.push({
                        type: 'audience',
                        severity: 'error',
                        message: `Audience clash with ${b.courseCode} — ${audienceLabel} double-booked at ${b.startTime}–${b.endTime}`,
                        relatedId: b.id,
                    });
                }
            }
        }

        // Time conflict
        if (isOutsideOperatingHours(a.startTime, a.endTime)) {
            itemConflicts.push({
                type: 'time',
                severity: 'warning',
                message: `Outside operating hours (08:00–18:00)`,
            });
        }

        if (itemConflicts.length > 0) {
            conflictMap.set(a.id, itemConflicts);
        }
    }

    return conflictMap;
}

/**
 * Count total unique conflicts (not double-counting pairs).
 */
export function countConflicts(allSchedules) {
    const pairs = new Set();
    let warningCount = 0;

    for (let i = 0; i < allSchedules.length; i++) {
        const a = allSchedules[i];

        if (isOutsideOperatingHours(a.startTime, a.endTime)) {
            warningCount++;
        }

        for (let j = i + 1; j < allSchedules.length; j++) {
            const b = allSchedules[j];
            if (a.day !== b.day || a.type !== b.type) continue;

            const overlaps = timesOverlap(
                { startTime: a.startTime, endTime: a.endTime },
                { startTime: b.startTime, endTime: b.endTime }
            );

            if (!overlaps) continue;

            if (a.type !== 'exam' && sharesRoom(a, b)) {
                pairs.add(`room:${[a.id, b.id].sort().join('-')}`);
            }
            if (a.courseId === b.courseId) {
                pairs.add(`course:${[a.id, b.id].sort().join('-')}`);
            }
        }
    }

    return { errorCount: pairs.size, warningCount, totalCount: pairs.size + warningCount };
}
