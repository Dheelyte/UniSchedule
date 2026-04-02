/**
 * Utility helpers for the timetable app.
 */

/** Generate a short unique ID with an optional prefix. */
export function generateId(prefix = 'id') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Days of the week used in the timetable. */
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/** Standard operating hours (8 AM – 6 PM). */
export const OPERATING_HOURS = { start: '08:00', end: '18:00' };

/**
 * Convert a time string "HH:MM" ➜ minutes since midnight.
 * Useful for overlap checks.
 */
export function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

/**
 * Check whether two time ranges overlap.
 * Each range is { startTime, endTime } in "HH:MM" format.
 */
export function timesOverlap(a, b) {
    const aStart = timeToMinutes(a.startTime);
    const aEnd = timeToMinutes(a.endTime);
    const bStart = timeToMinutes(b.startTime);
    const bEnd = timeToMinutes(b.endTime);
    return aStart < bEnd && bStart < aEnd;
}

/**
 * Check if a schedule item falls outside standard operating hours.
 */
export function isOutsideOperatingHours(startTime, endTime) {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    const opStart = timeToMinutes(OPERATING_HOURS.start);
    const opEnd = timeToMinutes(OPERATING_HOURS.end);
    return start < opStart || end > opEnd;
}
