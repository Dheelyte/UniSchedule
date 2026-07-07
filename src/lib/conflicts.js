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

// Higher number = higher scheduling priority. A higher-priority schedule may be
// saved despite an error-level conflict with a lower-priority one (the conflict
// is downgraded to a warning so the save proceeds; both items remain flagged on
// the timetable, and the backend notifies the affected faculty editors).
const SCOPE_PRIORITY = { UNIVERSITY_WIDE: 3, INTERFACULTY: 2, DEPARTMENTAL: 1 };
function scopePriority(scope) {
    return SCOPE_PRIORITY[scope] || 0;
}

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
export function detectConflicts(candidate, allSchedules, excludeId = null, enrollmentsByCourse = null, departmentsById = null) {
    const deptName = (id) => {
        if (id === UW_DEPT) return null;
        if (!departmentsById) return null;
        const v = departmentsById.get ? departmentsById.get(id) : departmentsById[id];
        if (!v) return null;
        return typeof v === 'string' ? v : (v.name || null);
    };
    const conflicts = [];

    // Courses in special faculties are exempt from conflict detection.
    if (candidate.isSpecialFaculty) {
        return { hasConflict: false, hasWarning: false, conflicts };
    }

    // For exam mode: check for duplicate course across ALL weeks/days
    if (candidate.type === 'exam') {
        const duplicateCourse = allSchedules.find(
            (s) => s.id !== excludeId && !s.isSpecialFaculty && s.type === 'exam' && s.courseId === candidate.courseId
        );
        if (duplicateCourse) {
            conflicts.push({
                type: 'duplicate',
                severity: 'error',
                message: `Duplicate exam: "${duplicateCourse.courseCode || 'Course'}" already has an exam scheduled on ${duplicateCourse.day}${duplicateCourse.week ? ` (Week ${duplicateCourse.week})` : ''} ${duplicateCourse.startTime}–${duplicateCourse.endTime}.`,
            });
        }
    }

    // For room/time overlap checks: scope to same calendar slot + same type.
    // Lectures match by day_of_week; exams match by examDate (falling back to
    // legacy day_of_week for items that pre-date date-based exam scheduling).
    // In exam mode, also scope to same week.
    const relevantSchedules = allSchedules.filter((s) => {
        if (s.id === excludeId) return false;
        if (s.isSpecialFaculty) return false;
        if (s.type !== candidate.type) return false;
        if (candidate.type === 'exam') {
            if (candidate.examDate && s.examDate) {
                if (s.examDate !== candidate.examDate) return false;
            } else if (s.day && candidate.day && s.day !== candidate.day) {
                return false;
            }
            if (s.week !== candidate.week) return false;
        } else if (s.day !== candidate.day) {
            return false;
        }
        return true;
    });

    // 1. Room Conflict - any shared room in overlapping time.
    // Exams may share a room with other exams, but only when they belong to the
    // same faculty. Cross-faculty exams in the same venue are still flagged.
    const roomConflicts = relevantSchedules.filter((s) => {
        if (!sharesRoom(candidate, s)) return false;
        if (!timesOverlap(
            { startTime: candidate.startTime, endTime: candidate.endTime },
            { startTime: s.startTime, endTime: s.endTime },
        )) return false;
        if (candidate.type === 'exam') {
            // Allow sharing when both sides have a defined matching faculty,
            // or when either side is faculty-less (university-wide).
            if (!candidate.facultyId || !s.facultyId) return false;
            if (candidate.facultyId === s.facultyId) return false;
        }
        return true;
    });

    roomConflicts.forEach((s) => {
        conflicts.push({
            type: 'room',
            severity: 'error',
            otherScope: s.courseScope || null,
            message: candidate.type === 'exam'
                ? `Room conflict: "${getRoomLabel(s)}" is already booked for ${s.courseCode || 'a course'} (${s.facultyName || s.facultyId}) on ${s.day} ${s.startTime}–${s.endTime}. Exams may only share a venue within the same faculty.`
                : `Room conflict: "${getRoomLabel(s)}" is already booked for ${s.courseCode || 'a course'} on ${s.day} ${s.startTime}–${s.endTime}.`,
        });
    });

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
                otherScope: s.courseScope || null,
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
            const resolvedName = !isUW ? deptName(clash.deptId) : null;
            const audienceLabel = isUW
                ? `all students${levelSuffix}`
                : `${resolvedName || `dept ${clash.deptId}`}${levelSuffix}`;
            conflicts.push({
                type: 'audience',
                severity: 'error',
                otherScope: s.courseScope || null,
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

    // Priority override: if the candidate's scope outranks the colliding item's
    // scope, the save is allowed. Demote the conflict to a warning and tag it so
    // the UI can explain that affected faculty editors will be notified.
    const candidatePriority = scopePriority(candidate.courseScope);
    if (candidatePriority > 1) {
        conflicts.forEach((c) => {
            if (c.severity !== 'error' || !c.otherScope) return;
            const otherPriority = scopePriority(c.otherScope);
            if (candidatePriority > otherPriority) {
                c.severity = 'warning';
                c.priorityOverride = true;
                c.message = `${c.message}`;
            }
        });
    }

    return {
        hasConflict: conflicts.some((c) => c.severity === 'error'),
        hasWarning: conflicts.length > 0,
        conflicts,
    };
}

/**
 * Build a stable signature for a conflict so it can be matched against a
 * persisted dismissal. Pairwise conflicts order the two item ids; single-item
 * conflicts (e.g. time warnings) leave the second id empty. Must mirror the
 * backend normalization in `ConflictDismissal`.
 */
export function conflictSignature(type, itemAId, itemBId = null) {
    if (itemBId === null || itemBId === undefined) return `${type}:${Number(itemAId)}:`;
    const a = Number(itemAId);
    const b = Number(itemBId);
    return `${type}:${Math.min(a, b)}:${Math.max(a, b)}`;
}

/**
 * Turn a list of dismissal records from the API into a Set of signatures.
 */
export function dismissalSignatureSet(dismissals) {
    const set = new Set();
    (dismissals || []).forEach((d) => {
        set.add(conflictSignature(d.conflict_type, d.item_a_id, d.item_b_id ?? null));
    });
    return set;
}

/**
 * Detect ALL conflicts across the entire schedule.
 * Returns a Map of scheduleId → array of conflict objects.
 * @param {Array} allSchedules - All schedule items with details
 * @param {Set<string>|null} dismissedSignatures - signatures to suppress
 * @returns {Map<string, Array>}
 */
export function detectAllConflicts(allSchedules, enrollmentsByCourse = null, departmentsById = null, dismissedSignatures = null) {
    const deptName = (id) => {
        if (id === UW_DEPT) return null;
        if (!departmentsById) return null;
        const v = departmentsById.get ? departmentsById.get(id) : departmentsById[id];
        if (!v) return null;
        return typeof v === 'string' ? v : (v.name || null);
    };
    const conflictMap = new Map();

    for (let i = 0; i < allSchedules.length; i++) {
        const a = allSchedules[i];
        // Courses in special faculties are exempt from conflict detection.
        if (a.isSpecialFaculty) continue;
        const itemConflicts = [];

        // Exam mode: check for duplicate course across all weeks/days
        if (a.type === 'exam') {
            for (let j = 0; j < allSchedules.length; j++) {
                if (i === j) continue;
                const b = allSchedules[j];
                if (b.isSpecialFaculty) continue;
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
            if (b.isSpecialFaculty) continue;

            if (a.type !== b.type) continue;
            if (a.type === 'exam') {
                if (a.examDate && b.examDate) {
                    if (a.examDate !== b.examDate) continue;
                } else if (a.day && b.day && a.day !== b.day) {
                    continue;
                } else if (!a.examDate && !b.examDate && (a.day !== b.day)) {
                    continue;
                }
                if (a.week !== b.week) continue;
            } else if (a.day !== b.day) {
                continue;
            }

            const overlaps = timesOverlap(
                { startTime: a.startTime, endTime: a.endTime },
                { startTime: b.startTime, endTime: b.endTime }
            );

            if (!overlaps) continue;

            // Room conflict - any shared room.
            // Exams may share a venue only within the same faculty (UW/faculty-less items pass).
            if (sharesRoom(a, b)) {
                let isRoomConflict = a.type !== 'exam';
                if (a.type === 'exam') {
                    if (a.facultyId && b.facultyId && a.facultyId !== b.facultyId) {
                        isRoomConflict = true;
                    }
                }
                if (isRoomConflict) {
                    itemConflicts.push({
                        type: 'room',
                        severity: 'error',
                        message: a.type === 'exam'
                            ? `Room "${getRoomLabel(b)}" shared with ${b.courseCode} from a different faculty (${b.facultyName || b.facultyId}) at ${b.startTime}–${b.endTime}`
                            : `Room "${getRoomLabel(b)}" double-booked with ${b.courseCode} (${b.startTime}–${b.endTime})`,
                        relatedId: b.id,
                    });
                }
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
                    const resolvedName = !isUW ? deptName(clash.deptId) : null;
                    const audienceLabel = isUW
                        ? 'all students (university-wide course)'
                        : `${resolvedName || `dept ${clash.deptId}`}${clash.level ? ` (${clash.level}L)` : ''}`;
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

        const kept = dismissedSignatures
            ? itemConflicts.filter(
                  (c) => !dismissedSignatures.has(conflictSignature(c.type, a.id, c.relatedId ?? null)),
              )
            : itemConflicts;

        if (kept.length > 0) {
            conflictMap.set(a.id, kept);
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

            if (sharesRoom(a, b)) {
                const isExamSameFaculty = a.type === 'exam' && (
                    !a.facultyId || !b.facultyId || a.facultyId === b.facultyId
                );
                if (!isExamSameFaculty) {
                    pairs.add(`room:${[a.id, b.id].sort().join('-')}`);
                }
            }
            if (a.courseId === b.courseId) {
                pairs.add(`course:${[a.id, b.id].sort().join('-')}`);
            }
        }
    }

    return { errorCount: pairs.size, warningCount, totalCount: pairs.size + warningCount };
}
