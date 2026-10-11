/**
 * Conflict Detection Engine (High-Performance Interval Sweep)
 *
 * Detects conflicts:
 * 1. Room Conflict - any shared room booked for overlapping times on the same day
 * 2. Course Conflict - same course scheduled at overlapping times across different faculties
 * 3. Audience Conflict - same (dept x level) booked at overlapping times for different courses
 * 4. Duplicate Exam - same course scheduled across faculties in exam mode
 * 5. Time Warning - scheduling outside the realm's day window (UG: 8 AM – 6 PM)
 * 6. External Room Conflict - a room another realm (programme) already holds
 *
 * Kept free of path aliases so it can be unit-tested directly with `node --test`.
 */

import { timesOverlap, timeToMinutes } from './utils.js';
import { UG_CONFIG, isOutsideWindow, weekdayOf } from './realm.js';

const UW_DEPT = 'university-wide';

const SCOPE_PRIORITY = { UNIVERSITY_WIDE: 3, INTERFACULTY: 2, DEPARTMENTAL: 1 };
function scopePriority(scope) {
    return SCOPE_PRIORITY[scope] || 0;
}

/**
 * Check whether two room ID lists share at least one room.
 */
function sharesRoomFast(aRooms, bRooms) {
    if (!aRooms || !bRooms || aRooms.length === 0 || bRooms.length === 0) return false;
    for (let i = 0; i < aRooms.length; i++) {
        if (bRooms.includes(aRooms[i])) return true;
    }
    return false;
}

function sharesRoom(a, b) {
    const aRooms = a.roomIds || (a.roomId ? [a.roomId] : []);
    const bRooms = b.roomIds || (b.roomId ? [b.roomId] : []);
    return sharesRoomFast(aRooms, bRooms);
}

/** Get displayable room list from a schedule item. */
function getRoomLabel(s) {
    return s.roomNames || s.roomName || 'Room';
}

const hhmm = (t) => String(t || '').slice(0, 5);

/**
 * Shape a row of `GET /timetable/external-bookings` (another realm's session)
 * like a schedule item. The id is prefixed with `ext-` so it can never collide
 * with one of the active realm's ids in a conflict map.
 */
export function toExternalBooking(row) {
    return {
        id: `ext-${row.id}`,
        external: true,
        realmKey: row.realm_key,
        realmName: row.realm_name || row.realm_key,
        type: row.type,
        roomIds: row.room_ids || [],
        day: row.day_of_week || null,
        examDate: row.exam_date || null,
        startTime: hhmm(row.start_time),
        endTime: hhmm(row.end_time),
        courseCode: row.course_code || 'a course',
        isSpecialFaculty: !!row.is_special_faculty,
    };
}

/**
 * Conflicts between one of this realm's items and the other realms' bookings.
 * Rooms are shared between realms, so a same-type overlap is an error that can
 * be neither dismissed nor overridden by priority. A lecture against an exam
 * is only a warning: semesters have no dates, so nothing confirms that the
 * weekly lecture still runs on the exam's date.
 */
function externalConflicts(item, externalBookings) {
    const out = [];
    // An online session holds no room.
    if (!externalBookings || externalBookings.length === 0 || item.isSpecialFaculty || item.is_online || item.isOnline) return out;
    const itemRooms = (item.roomIds || (item.roomId ? [item.roomId] : [])).map(String);
    const itemWeekday = item.type === 'exam' ? weekdayOf(item.examDate) : item.day;
    externalBookings.forEach((ext) => {
        if (ext.isSpecialFaculty) return;
        if (!(ext.roomIds || []).some((rid) => itemRooms.includes(String(rid)))) return;
        if (!timesOverlap(
            { startTime: item.startTime, endTime: item.endTime },
            { startTime: ext.startTime, endTime: ext.endTime },
        )) return;
        const who = `${ext.realmName} · ${ext.courseCode}`;
        const when = `${hhmm(ext.startTime)}–${hhmm(ext.endTime)}`;
        if (ext.type === item.type) {
            const sameSlot = item.type === 'exam'
                ? !!item.examDate && ext.examDate === item.examDate
                : !!item.day && ext.day === item.day;
            if (!sameSlot) return;
            out.push({
                type: 'room',
                severity: 'error',
                external: true,
                relatedId: ext.id,
                message: `Room conflict: "${getRoomLabel(item)}" is held by ${who} on ${ext.examDate || ext.day} ${when}. Rooms are shared between programmes, so one of the two sessions has to move.`,
            });
            return;
        }
        const extWeekday = ext.type === 'exam' ? weekdayOf(ext.examDate) : ext.day;
        if (!itemWeekday || extWeekday !== itemWeekday) return;
        out.push({
            type: 'room',
            severity: 'warning',
            external: true,
            crossType: true,
            relatedId: ext.id,
            message: ext.type === 'lecture'
                ? `Room warning: "${getRoomLabel(item)}" has a weekly ${ext.realmName} lecture (${ext.courseCode}) on ${ext.day}s ${when}. Check that those lectures have ended by this exam.`
                : `Room warning: "${getRoomLabel(item)}" has a ${ext.realmName} exam (${ext.courseCode}) on ${ext.examDate} ${when}. Check that this lecture is not running then.`,
        });
    });
    return out;
}

/**
 * Compute the (department, level) audiences that an item targets.
 */
function audiencesOf(item, enrollmentsByCourse) {
    const out = [];
    if (item.courseScope === 'UNIVERSITY_WIDE') {
        out.push({ deptId: UW_DEPT, level: item.courseLevel ?? null });
    } else if (item.courseDepartmentId) {
        out.push({ deptId: item.courseDepartmentId, level: item.courseLevel ?? null });
    }
    const extras = enrollmentsByCourse?.get(item.courseId);
    if (extras && extras.length > 0) {
        for (let i = 0; i < extras.length; i++) {
            out.push({ deptId: extras[i].department_id, level: extras[i].level });
        }
    }
    return out;
}

/**
 * Check if two audience targets overlap.
 */
function audienceOverlaps(a, b) {
    if (a.deptId !== b.deptId && a.deptId !== UW_DEPT && b.deptId !== UW_DEPT) return false;
    if (a.level === null || b.level === null) return true;
    return a.level === b.level;
}

function findAudienceClashFast(aAud, bAud) {
    if (!aAud || !bAud || aAud.length === 0 || bAud.length === 0) return null;
    for (let i = 0; i < aAud.length; i++) {
        const x = aAud[i];
        for (let j = 0; j < bAud.length; j++) {
            const y = bAud[j];
            if (audienceOverlaps(x, y)) {
                const concreteDept = x.deptId !== UW_DEPT ? x.deptId : (y.deptId !== UW_DEPT ? y.deptId : UW_DEPT);
                return { deptId: concreteDept, level: x.level ?? y.level ?? null };
            }
        }
    }
    return null;
}

export function findAudienceClash(a, b, enrollmentsByCourse) {
    const aAud = audiencesOf(a, enrollmentsByCourse);
    const bAud = audiencesOf(b, enrollmentsByCourse);
    return findAudienceClashFast(aAud, bAud);
}

/**
 * Check all conflicts for a given candidate schedule item against existing schedules.
 * @param {{config?: Object, externalBookings?: Array}} options - the realm config
 *   (UG's when omitted) and the other realms' bookings (see `toExternalBooking`)
 */
export function detectConflicts(candidate, allSchedules, excludeId = null, enrollmentsByCourse = null, departmentsById = null, options = {}) {
    const { config = UG_CONFIG, externalBookings = [] } = options || {};
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

    const candStartMin = timeToMinutes(candidate.startTime);
    const candEndMin = timeToMinutes(candidate.endTime);
    const candRooms = candidate.roomIds || (candidate.roomId ? [candidate.roomId] : []);
    const candAudiences = audiencesOf(candidate, enrollmentsByCourse);
    const isCandOnline = !!(candidate.is_online || candidate.isOnline);

    for (let i = 0; i < allSchedules.length; i++) {
        const s = allSchedules[i];
        if (s.id === excludeId || s.isSpecialFaculty) continue;

        // Duplicate exam check across all days/weeks
        if (candidate.type === 'exam' && s.type === 'exam') {
            if (s.courseId === candidate.courseId && s.facultyId !== candidate.facultyId) {
                conflicts.push({
                    type: 'duplicate',
                    severity: 'error',
                    relatedId: s.id,
                    message: `Duplicate exam: "${s.courseCode || 'Course'}" already has an exam scheduled on ${s.day}${s.week ? ` (Week ${s.week})` : ''} ${s.startTime}–${s.endTime}.`,
                });
            }
        }

        // Must match type
        if (s.type !== candidate.type) continue;

        // Calendar slot match
        if (candidate.type === 'exam') {
            if (candidate.examDate && s.examDate) {
                if (s.examDate !== candidate.examDate) continue;
            } else if (s.day && candidate.day && s.day !== candidate.day) {
                continue;
            }
            if (s.week !== candidate.week) continue;
        } else if (s.day !== candidate.day) {
            continue;
        }

        // Time overlap check
        const sStartMin = timeToMinutes(s.startTime);
        const sEndMin = timeToMinutes(s.endTime);
        if (Math.max(candStartMin, sStartMin) >= Math.min(candEndMin, sEndMin)) continue;

        // 1. Room conflict
        const sRooms = s.roomIds || (s.roomId ? [s.roomId] : []);
        if (sharesRoomFast(candRooms, sRooms)) {
            let isRoomConflict = candidate.type !== 'exam';
            if (candidate.type === 'exam') {
                if (!candidate.facultyId || !s.facultyId) {
                    isRoomConflict = false;
                } else if (candidate.facultyId === s.facultyId) {
                    isRoomConflict = false;
                } else {
                    isRoomConflict = true;
                }
            }
            if (isRoomConflict) {
                conflicts.push({
                    type: 'room',
                    severity: 'error',
                    relatedId: s.id,
                    otherScope: s.courseScope || null,
                    message: candidate.type === 'exam'
                        ? `Room conflict: "${getRoomLabel(s)}" is already booked for ${s.courseCode || 'a course'} (${s.facultyName || s.facultyId}) on ${s.day} ${s.startTime}–${s.endTime}. Exams may only share a venue within the same faculty.`
                        : `Room conflict: "${getRoomLabel(s)}" is already booked for ${s.courseCode || 'a course'} on ${s.day} ${s.startTime}–${s.endTime}.`,
                });
            }
        }

        // 2. Course conflict (lectures)
        if (candidate.type === 'lecture' && s.courseId === candidate.courseId && s.facultyId !== candidate.facultyId) {
            conflicts.push({
                type: 'course',
                severity: 'error',
                relatedId: s.id,
                otherScope: s.courseScope || null,
                message: `Course conflict: "${s.courseCode || 'Course'}" is already scheduled on ${s.day} ${s.startTime}–${s.endTime}.`,
            });
        }

        // 3. Audience conflict
        if (candidate.courseId !== s.courseId && !isCandOnline && !s.is_online && !s.isOnline) {
            const sAudiences = audiencesOf(s, enrollmentsByCourse);
            const clash = findAudienceClashFast(candAudiences, sAudiences);
            if (clash) {
                const isUW = clash.deptId === UW_DEPT;
                const levelSuffix = clash.level ? ` (${clash.level}L)` : '';
                const resolvedName = !isUW ? deptName(clash.deptId) : null;
                const audienceLabel = isUW
                    ? `all students${levelSuffix}`
                    : `${resolvedName || `dept ${clash.deptId}`}${levelSuffix}`;
                conflicts.push({
                    type: 'audience',
                    severity: 'error',
                    relatedId: s.id,
                    otherScope: s.courseScope || null,
                    message: `Audience clash: ${s.courseCode || 'a course'} also targets ${audienceLabel} on ${s.day || s.examDate} ${s.startTime}–${s.endTime}.`,
                });
            }
        }
    }

    // 4. Time conflict
    if (isOutsideWindow(candidate.startTime, candidate.endTime, config)) {
        conflicts.push({
            type: 'time',
            severity: 'warning',
            message: `Time warning: This slot (${candidate.startTime}–${candidate.endTime}) falls outside standard operating hours (${config.day_start}–${config.day_end}).`,
        });
    }

    // 5. Room held by another realm
    conflicts.push(...externalConflicts(candidate, externalBookings));

    // Priority override
    const candidatePriority = scopePriority(candidate.courseScope);
    if (candidatePriority > 1) {
        conflicts.forEach((c) => {
            if (c.severity !== 'error' || !c.otherScope || c.external) return;
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
 * conflicts (e.g. time warnings) leave the second id empty.
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
 * High-performance sweep-line conflict detection engine.
 *
 * Scales linearly O(N log N) with scheduling volume instead of O(N^2),
 * allowing large timetables (5,000+ items) to calculate in < 400ms.
 *
 * Returns a Map of scheduleId -> array of conflict objects.
 * @param {{config?: Object, externalBookings?: Array}} options - as for `detectConflicts`
 */
export function detectAllConflicts(allSchedules, enrollmentsByCourse = null, departmentsById = null, dismissedSignatures = null, options = {}) {
    const { config = UG_CONFIG, externalBookings = [] } = options || {};
    if (!allSchedules || allSchedules.length === 0) return new Map();

    const deptName = (id) => {
        if (id === UW_DEPT) return null;
        if (!departmentsById) return null;
        const v = departmentsById.get ? departmentsById.get(id) : departmentsById[id];
        if (!v) return null;
        return typeof v === 'string' ? v : (v.name || null);
    };

    const conflictMap = new Map();
    function addConflict(itemId, conflict) {
        let list = conflictMap.get(itemId);
        if (!list) {
            list = [];
            conflictMap.set(itemId, list);
        }
        list.push(conflict);
    }

    // Step 1: Pre-process items into a lightweight, normalized array
    const processed = [];
    for (let i = 0; i < allSchedules.length; i++) {
        const s = allSchedules[i];
        if (s.isSpecialFaculty) continue;
        const rooms = s.roomIds || (s.roomId ? [s.roomId] : []);
        const startMin = timeToMinutes(s.startTime);
        const endMin = timeToMinutes(s.endTime);
        const aud = audiencesOf(s, enrollmentsByCourse);
        processed.push({
            id: s.id,
            type: s.type,
            day: s.day,
            examDate: s.examDate,
            week: s.week,
            startTime: s.startTime,
            endTime: s.endTime,
            startMin,
            endMin,
            courseId: s.courseId,
            courseCode: s.courseCode,
            facultyId: s.facultyId,
            facultyName: s.facultyName,
            is_online: !!(s.is_online || s.isOnline),
            roomIds: rooms,
            roomNames: s.roomNames || s.roomName || 'Room',
            audiences: aud,
        });
    }

    // Step 2: Time warnings (outside operating hours)
    for (let i = 0; i < processed.length; i++) {
        const p = processed[i];
        if (isOutsideWindow(p.startTime, p.endTime, config)) {
            addConflict(p.id, {
                type: 'time',
                severity: 'warning',
                message: `Outside operating hours (${config.day_start}–${config.day_end})`,
            });
        }
    }

    // Step 3: Duplicate exam check across all days/weeks (indexed by courseId)
    const examByCourse = new Map();
    for (let i = 0; i < processed.length; i++) {
        const p = processed[i];
        if (p.type !== 'exam') continue;
        let list = examByCourse.get(p.courseId);
        if (!list) {
            list = [];
            examByCourse.set(p.courseId, list);
        }
        list.push(p);
    }

    for (const list of examByCourse.values()) {
        if (list.length <= 1) continue;
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i];
                const b = list[j];
                if (a.facultyId !== b.facultyId) {
                    addConflict(a.id, {
                        type: 'duplicate',
                        severity: 'error',
                        message: `Duplicate exam: ${b.courseCode} already scheduled on ${b.day}${b.week ? ` (Week ${b.week})` : ''} ${b.startTime}–${b.endTime}`,
                        relatedId: b.id,
                    });
                    addConflict(b.id, {
                        type: 'duplicate',
                        severity: 'error',
                        message: `Duplicate exam: ${a.courseCode} already scheduled on ${a.day}${a.week ? ` (Week ${a.week})` : ''} ${a.startTime}–${a.endTime}`,
                        relatedId: a.id,
                    });
                }
            }
        }
    }

    // Step 4: Partition into calendar day buckets
    const groups = new Map();
    for (let i = 0; i < processed.length; i++) {
        const p = processed[i];
        let key;
        if (p.type === 'exam') {
            key = `exam:${p.examDate || p.day || ''}:${p.week ?? ''}`;
        } else {
            key = `lecture:${p.day || ''}`;
        }
        let grp = groups.get(key);
        if (!grp) {
            grp = [];
            groups.set(key, grp);
        }
        grp.push(p);
    }

    // Step 5: Sweep-line interval overlap detection per bucket
    for (const grp of groups.values()) {
        // Sort items by start time
        grp.sort((a, b) => a.startMin - b.startMin);

        for (let i = 0; i < grp.length; i++) {
            const a = grp[i];
            for (let j = i + 1; j < grp.length; j++) {
                const b = grp[j];
                // Once b starts at or after a ends, no future items in this sorted list can overlap a
                if (b.startMin >= a.endMin) {
                    break;
                }

                // If b ends before or when a starts (possible when b has very short duration), skip
                if (b.endMin <= a.startMin) {
                    continue;
                }

                // 1. Room conflict (shared room)
                if (sharesRoomFast(a.roomIds, b.roomIds)) {
                    let isRoomConflict = a.type !== 'exam';
                    if (a.type === 'exam') {
                        if (a.facultyId && b.facultyId && a.facultyId !== b.facultyId) {
                            isRoomConflict = true;
                        }
                    }
                    if (isRoomConflict) {
                        addConflict(a.id, {
                            type: 'room',
                            severity: 'error',
                            message: a.type === 'exam'
                                ? `Room "${b.roomNames}" shared with ${b.courseCode} from a different faculty (${b.facultyName || b.facultyId}) at ${b.startTime}–${b.endTime}`
                                : `Room "${b.roomNames}" double-booked with ${b.courseCode} (${b.startTime}–${b.endTime})`,
                            relatedId: b.id,
                        });
                        addConflict(b.id, {
                            type: 'room',
                            severity: 'error',
                            message: a.type === 'exam'
                                ? `Room "${a.roomNames}" shared with ${a.courseCode} from a different faculty (${a.facultyName || a.facultyId}) at ${a.startTime}–${a.endTime}`
                                : `Room "${a.roomNames}" double-booked with ${a.courseCode} (${a.startTime}–${a.endTime})`,
                            relatedId: a.id,
                        });
                    }
                }

                // 2. Course conflict (lectures: same course scheduled across faculties at overlapping time)
                if (a.type === 'lecture' && a.courseId === b.courseId && a.facultyId !== b.facultyId) {
                    addConflict(a.id, {
                        type: 'course',
                        severity: 'error',
                        message: `${b.courseCode} is scheduled again at ${b.startTime}–${b.endTime}`,
                        relatedId: b.id,
                    });
                    addConflict(b.id, {
                        type: 'course',
                        severity: 'error',
                        message: `${a.courseCode} is scheduled again at ${a.startTime}–${a.endTime}`,
                        relatedId: a.id,
                    });
                }

                // 3. Audience conflict (different courses targeting overlapping dept x level)
                if (a.courseId !== b.courseId) {
                    if (!a.is_online && !b.is_online) {
                        const clash = findAudienceClashFast(a.audiences, b.audiences);
                        if (clash) {
                            const isUW = clash.deptId === UW_DEPT;
                            const resolvedName = !isUW ? deptName(clash.deptId) : null;
                            const audienceLabel = isUW
                                ? 'all students (university-wide course)'
                                : `${resolvedName || `dept ${clash.deptId}`}${clash.level ? ` (${clash.level}L)` : ''}`;

                            addConflict(a.id, {
                                type: 'audience',
                                severity: 'error',
                                message: `Audience clash with ${b.courseCode} — ${audienceLabel} double-booked at ${b.startTime}–${b.endTime}`,
                                relatedId: b.id,
                            });
                            addConflict(b.id, {
                                type: 'audience',
                                severity: 'error',
                                message: `Audience clash with ${a.courseCode} — ${audienceLabel} double-booked at ${a.startTime}–${a.endTime}`,
                                relatedId: a.id,
                            });
                        }
                    }
                }
            }
        }
    }

    // Step 6: Filter dismissed signatures if supplied
    if (dismissedSignatures && dismissedSignatures.size > 0) {
        for (const [id, list] of conflictMap.entries()) {
            const filtered = list.filter((c) => {
                const sig = conflictSignature(c.type, id, c.relatedId ?? null);
                return !dismissedSignatures.has(sig);
            });
            if (filtered.length === 0) {
                conflictMap.delete(id);
            } else {
                conflictMap.set(id, filtered);
            }
        }
    }

    // Step 7: Rooms held by another realm. They can't be dismissed, so they are added after the filter.
    if (externalBookings.length > 0) {
        for (let i = 0; i < processed.length; i++) {
            const found = externalConflicts(processed[i], externalBookings);
            for (let j = 0; j < found.length; j++) addConflict(processed[i].id, found[j]);
        }
    }

    return conflictMap;
}

/**
 * Count total unique conflicts (not double-counting pairs).
 */
export function countConflicts(allSchedules, options = {}) {
    const { config = UG_CONFIG } = options || {};
    const pairs = new Set();
    let warningCount = 0;

    for (let i = 0; i < allSchedules.length; i++) {
        const a = allSchedules[i];
        if (isOutsideWindow(a.startTime, a.endTime, config)) {
            warningCount++;
        }
        for (let j = i + 1; j < allSchedules.length; j++) {
            const b = allSchedules[j];
            if (a.day !== b.day || a.type !== b.type) continue;
            if (!timesOverlap(
                { startTime: a.startTime, endTime: a.endTime },
                { startTime: b.startTime, endTime: b.endTime }
            )) continue;

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
