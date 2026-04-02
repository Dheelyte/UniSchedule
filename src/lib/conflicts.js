/**
 * Conflict Detection Engine
 *
 * Detects three types of conflicts:
 * 1. Room Conflict — same room booked for overlapping times on the same day
 * 2. Course Conflict — same course scheduled at overlapping times on the same day
 * 3. Time Conflict — scheduling outside standard operating hours (8 AM – 6 PM)
 */

import { timesOverlap, isOutsideOperatingHours } from './utils';

/**
 * Check all conflicts for a given schedule item against existing schedules.
 * @param {Object} candidate - The schedule item to check { courseId, roomId, day, startTime, endTime, type }
 * @param {Array} allSchedules - All existing schedule items (with details)
 * @param {string|null} excludeId - ID to exclude (for editing existing items)
 * @returns {{ hasConflict: boolean, conflicts: Array<{type: string, message: string, severity: string}> }}
 */
export function detectConflicts(candidate, allSchedules, excludeId = null) {
    const conflicts = [];

    const relevantSchedules = allSchedules.filter(
        (s) => s.id !== excludeId && s.day === candidate.day && s.type === candidate.type
    );

    // 1. Room Conflict
    const roomConflicts = relevantSchedules.filter(
        (s) =>
            s.roomId === candidate.roomId &&
            timesOverlap(
                { startTime: candidate.startTime, endTime: candidate.endTime },
                { startTime: s.startTime, endTime: s.endTime }
            )
    );

    roomConflicts.forEach((s) => {
        conflicts.push({
            type: 'room',
            severity: 'error',
            message: `Room conflict: "${s.roomName || 'Room'}" is already booked for ${s.courseCode || 'a course'} on ${s.day} ${s.startTime}–${s.endTime}.`,
        });
    });

    // 2. Course Conflict
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

    // 3. Time Conflict (outside operating hours)
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
export function detectAllConflicts(allSchedules) {
    const conflictMap = new Map();

    for (let i = 0; i < allSchedules.length; i++) {
        const a = allSchedules[i];
        const itemConflicts = [];

        for (let j = 0; j < allSchedules.length; j++) {
            if (i === j) continue;
            const b = allSchedules[j];

            if (a.day !== b.day || a.type !== b.type) continue;

            const overlaps = timesOverlap(
                { startTime: a.startTime, endTime: a.endTime },
                { startTime: b.startTime, endTime: b.endTime }
            );

            if (!overlaps) continue;

            // Room conflict
            if (a.roomId === b.roomId) {
                itemConflicts.push({
                    type: 'room',
                    severity: 'error',
                    message: `Room "${b.roomName}" double-booked with ${b.courseCode} (${b.startTime}–${b.endTime})`,
                    relatedId: b.id,
                });
            }

            // Course conflict
            if (a.courseId === b.courseId) {
                itemConflicts.push({
                    type: 'course',
                    severity: 'error',
                    message: `${b.courseCode} is scheduled again at ${b.startTime}–${b.endTime}`,
                    relatedId: b.id,
                });
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

            if (a.roomId === b.roomId) {
                pairs.add(`room:${[a.id, b.id].sort().join('-')}`);
            }
            if (a.courseId === b.courseId) {
                pairs.add(`course:${[a.id, b.id].sort().join('-')}`);
            }
        }
    }

    return { errorCount: pairs.size, warningCount, totalCount: pairs.size + warningCount };
}
