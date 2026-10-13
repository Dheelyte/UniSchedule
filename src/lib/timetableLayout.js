// Pure layout helpers for the lecture timetable PDF grid. Kept free of jsPDF
// and path aliases so they can be unit-tested directly with `node --test`.

export function timeToMinutes(timeStr) {
	if (!timeStr) return 0;
	const [h, m] = timeStr.split(":").map(Number);
	return h * 60 + (m || 0);
}

// Greedy lane assignment for classes sharing one room + day. Classes are
// sorted by start (then end); each goes into the first lane whose last class
// has already ended (end <= start, so back-to-back classes share a lane),
// otherwise a new lane is opened. Returns copies of the classes with `lane`
// and the group's total `laneCount`, in start-time order.
export function assignLanes(classes) {
	const sorted = [...classes].sort((a, b) => {
		const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
		if (startDiff !== 0) return startDiff;
		return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
	});
	const laneEnds = [];
	const placed = sorted.map((cls) => {
		const start = timeToMinutes(cls.startTime);
		let lane = laneEnds.findIndex((end) => end <= start);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(0);
		}
		laneEnds[lane] = timeToMinutes(cls.endTime);
		return { ...cls, lane };
	});
	const laneCount = laneEnds.length;
	return placed.map((cls) => ({ ...cls, laneCount }));
}

// Splits a course code at its LAST hyphen into a prefix (e.g. "UNILAG") and
// main code (e.g. "HIS206"). Cross-listed codes ("A-X101/B-Y202") are split
// per part and re-joined. Codes without a usable hyphen have no prefix.
export function splitCourseCode(rawCode) {
	const parts = String(rawCode || "N/A").split(/[,/]+/).map((p) => p.trim()).filter(Boolean);
	const split = (parts.length ? parts : ["N/A"]).map((code) => {
		const idx = code.lastIndexOf("-");
		if (idx <= 0 || idx === code.length - 1) return { prefix: "", main: code };
		return { prefix: code.slice(0, idx), main: code.slice(idx + 1) };
	});
	const prefixes = [...new Set(split.map((s) => s.prefix).filter(Boolean))];
	return {
		prefix: prefixes.join("/").toUpperCase(),
		main: split.map((s) => s.main).join(" / "),
	};
}

// Hour range a faculty's grid must cover. Defaults to 08:00-18:00 and widens
// (to even hours, so the 2-hour header labels stay aligned) to include any
// class starting earlier or ending later. `outOfRange` lists those classes.
// Hour range a faculty's grid must cover. Defaults to 08:00-18:00 and widens
// (to even hours, so the 2-hour header labels stay aligned) to include any
// class starting earlier or ending later. `outOfRange` lists those classes.
// When options.trim is true, empty leading and trailing hours across the faculty
// are trimmed to recover horizontal space.
export function computeDayRange(classes, defaultStartH = 8, defaultEndH = 18, options = {}) {
	if (!classes || classes.length === 0) {
		return { startH: defaultStartH, endH: defaultEndH, outOfRange: [] };
	}
	let startMin = Infinity;
	let endMin = -Infinity;
	const outOfRange = [];
	classes.forEach((cls) => {
		const s = timeToMinutes(cls.startTime);
		const e = timeToMinutes(cls.endTime);
		if (e > s) {
			if (s < defaultStartH * 60 || e > defaultEndH * 60) outOfRange.push(cls);
			startMin = Math.min(startMin, s);
			endMin = Math.max(endMin, e);
		}
	});
	if (startMin === Infinity) {
		return { startH: defaultStartH, endH: defaultEndH, outOfRange: [] };
	}
	if (options.trim) {
		const startH = Math.floor(startMin / 60);
		const endH = Math.ceil(endMin / 60);
		return { startH: Math.max(0, startH), endH: Math.min(24, endH), outOfRange };
	}
	let startH = Math.floor(Math.min(defaultStartH * 60, startMin) / 60);
	let endH = Math.ceil(Math.max(defaultEndH * 60, endMin) / 60);
	if (startH % 2 !== 0) startH -= 1;
	if (endH % 2 !== 0) endH += 1;
	return { startH: Math.max(0, startH), endH: Math.min(24, endH), outOfRange };
}

function getSubjectNumberRanges(code) {
	const tokenRegex = /[A-Za-z]+(?:-\d+|\d+)[A-Za-z]*/g;
	const ranges = [];
	let m;
	while ((m = tokenRegex.exec(code)) !== null) {
		ranges.push({ start: m.index, end: m.index + m[0].length });
	}
	return ranges;
}

/**
 * Splits a course code into at most 2 lines, breaking ONLY after a hyphen or before '('.
 * Never splits inside a subject+number token (e.g. HIS206, CM233, HIS-305, EN101, PPGG325).
 * Keeps the hyphen at the end of line 1. Chooses the split that minimises the widest line.
 * Returns [line1, line2] or null if no valid split exists.
 */
export function splitChipCode(code, measure, fontSizePt = 7) {
	const raw = String(code || "").trim();
	if (!raw) return null;
	const ranges = getSubjectNumberRanges(raw);
	const candidates = [];
	for (let i = 1; i < raw.length; i++) {
		const afterHyphen = raw[i - 1] === "-";
		const beforeParen = raw[i] === "(";
		if (!afterHyphen && !beforeParen) continue;

		// Never split strictly inside a subject+number token
		const splitsToken = ranges.some((r) => i > r.start && i < r.end);
		if (splitsToken) continue;

		const line1 = raw.slice(0, i);
		const line2 = raw.slice(i);
		const w1 = measure ? measure(line1, fontSizePt) : line1.length;
		const w2 = measure ? measure(line2, fontSizePt) : line2.length;
		const maxW = Math.max(w1, w2);
		candidates.push({ lines: [line1, line2], maxW });
	}

	if (candidates.length === 0) return null;
	candidates.sort((a, b) => a.maxW - b.maxW);
	return candidates[0].lines;
}

/**
 * Pure layout function for lecture timetable chips.
 * Returns { lines, fontSizePt, rotated, requiredHeightPt }
 * - Chips >= 2 hours: horizontal. Try 1 line at 7pt, then 2 lines at 7pt, 6.5pt, 6pt.
 * - Chips < 2 hours: always rotated 90° (reading bottom-to-top). Try 1 line at 7pt, then 2 lines at 7pt, 6.5pt, 6pt.
 * - Never go below 6pt. If nothing fits at current chip height, return requiredHeightPt needed to fit.
 * - 1pt padding from edges, line height 1.1.
 */
export function layoutChipLabel(code, chipWidthPt, chipHeightPt, measure, options) {
	const rawCode = String(code || "").trim();
	const isLessThan2Hours = options?.isLessThan2Hours !== undefined
		? options.isLessThan2Hours
		: (options?.durationMin !== undefined ? options.durationMin < 120 : chipWidthPt < 28);
	const rotated = !!isLessThan2Hours;

	const padPt = 1;
	const lineHeightMult = 1.1;

	// Length axis is along text direction: width for horizontal, height for rotated
	const availLength = rotated ? (chipHeightPt - 2 * padPt) : (chipWidthPt - 2 * padPt);
	// Stack axis is perpendicular: height for horizontal, width for rotated
	const availStack = rotated ? (chipWidthPt - 2 * padPt) : (chipHeightPt - 2 * padPt);

	const split2Lines = splitChipCode(rawCode, measure, 7);

	// Try in order:
	// - 1 line @ 7pt
	// - 2 lines @ 7pt
	// - 2 lines @ 6.5pt
	// - 2 lines @ 6pt
	// (or 1 line @ 6.5pt, 1 line @ 6pt if unsplittable)
	const candidateSpecs = [];
	candidateSpecs.push({ lines: [rawCode], fontSizePt: 7 });
	if (split2Lines) {
		candidateSpecs.push({ lines: split2Lines, fontSizePt: 7 });
		candidateSpecs.push({ lines: split2Lines, fontSizePt: 6.5 });
		candidateSpecs.push({ lines: split2Lines, fontSizePt: 6 });
	} else {
		candidateSpecs.push({ lines: [rawCode], fontSizePt: 6.5 });
		candidateSpecs.push({ lines: [rawCode], fontSizePt: 6 });
	}

	for (const cand of candidateSpecs) {
		const maxLineLength = Math.max(...cand.lines.map((l) => measure(l, cand.fontSizePt)));
		const stackSize = cand.lines.length * cand.fontSizePt * lineHeightMult;

		if (maxLineLength <= availLength && stackSize <= availStack) {
			const requiredHeightPt = rotated
				? maxLineLength + 2 * padPt
				: stackSize + 2 * padPt;
			return {
				lines: cand.lines,
				fontSizePt: cand.fontSizePt,
				rotated,
				requiredHeightPt: Math.min(chipHeightPt, requiredHeightPt),
			};
		}
	}

	// Nothing fits at current chip height; return requiredHeightPt for the best layout at >= 6pt
	const fallbackCand = split2Lines
		? { lines: split2Lines, fontSizePt: 6 }
		: { lines: [rawCode], fontSizePt: 6 };

	const maxLineLength = Math.max(...fallbackCand.lines.map((l) => measure(l, fallbackCand.fontSizePt)));
	const stackSize = fallbackCand.lines.length * fallbackCand.fontSizePt * lineHeightMult;

	const requiredHeightPt = rotated
		? maxLineLength + 2 * padPt
		: stackSize + 2 * padPt;

	return {
		lines: fallbackCand.lines,
		fontSizePt: fallbackCand.fontSizePt,
		rotated,
		requiredHeightPt,
	};
}

export const ONLINE_ROOM_ID = "online_virtual_room";
export const ONLINE_ROOM_NAME = "Online Classes";

export function isScheduleOnline(schedule) {
	return !!(
		schedule &&
		(schedule.is_online ||
			schedule.isOnline ||
			schedule.roomId === ONLINE_ROOM_ID ||
			(Array.isArray(schedule.roomIds) && schedule.roomIds.includes(ONLINE_ROOM_ID)))
	);
}

export function scheduleMatchesRoom(schedule, room) {
	if (!room) return false;
	const isOnlineRoom = room.id === ONLINE_ROOM_ID || !!room.isOnline;
	if (isOnlineRoom) {
		return isScheduleOnline(schedule);
	}
	if (isScheduleOnline(schedule)) {
		return false;
	}
	const rids = schedule.roomIds || (schedule.roomId ? [schedule.roomId] : []);
	return rids.includes(room.id);
}

export function buildFacultyRooms(
	facSchedules,
	activeRooms,
	onlineRoom = { id: ONLINE_ROOM_ID, name: ONLINE_ROOM_NAME, isOnline: true }
) {
	const hasOnline = (facSchedules || []).some(isScheduleOnline);
	const physicalRooms = (activeRooms || []).filter((r) => {
		if (r.id === ONLINE_ROOM_ID || r.isOnline) return false;
		return (facSchedules || []).some((si) => scheduleMatchesRoom(si, r));
	});
	return hasOnline ? [onlineRoom, ...physicalRooms] : physicalRooms;
}

/**
 * Merges adjacent, contiguous, or close-interval schedules for the same course in the same venue on the same day.
 * When a course is scheduled over multiple entries (e.g. 8am-9am and 9am-10am), this merges them into a single
 * continuous schedule covering the combined time window (8am-10am), rather than picking just one or discarding
 * the subsequent occurrence.
 *
 * Distinct sessions with large gaps (e.g. morning lecture and afternoon tutorial) are preserved as separate sessions.
 *
 * @param {Array<Object>} schedules - Array of schedule objects
 * @param {number|Object} [options=15] - Maximum gap in minutes allowed between consecutive sessions to be merged, or options object
 * @param {number} [options.maxGapMinutes=15]
 * @param {Object} [options.room=null] - If provided, treats all schedules as matching this room
 * @returns {Array<Object>} Merged schedules
 */
export function mergeAdjacentCourseSchedules(schedules, options = 15) {
	if (!Array.isArray(schedules) || schedules.length === 0) {
		return [];
	}

	const maxGapMinutes = typeof options === "number" ? options : (options?.maxGapMinutes ?? 15);
	const targetRoom = typeof options === "object" ? options?.room ?? null : null;

	const getCourseKey = (s) => {
		const code = s.courseCode || s.courseId || "N/A";
		return String(code).trim().toUpperCase();
	};

	const getDayKey = (s) => {
		return String(s.day || "").replace("legacy:", "").trim().toLowerCase();
	};

	const getRoomKey = (s) => {
		if (targetRoom && targetRoom.id != null) return String(targetRoom.id);
		if (isScheduleOnline(s)) return ONLINE_ROOM_ID;
		if (Array.isArray(s.roomIds) && s.roomIds.length > 0) {
			return s.roomIds.slice().sort().join(",");
		}
		if (s.roomId != null) return String(s.roomId);
		return "";
	};

	const groups = new Map();
	for (const s of schedules) {
		if (!s || !s.startTime || !s.endTime) continue;
		const courseKey = getCourseKey(s);
		const dayKey = getDayKey(s);
		const roomKey = getRoomKey(s);
		const groupKey = `${dayKey}::${roomKey}::${courseKey}`;
		if (!groups.has(groupKey)) {
			groups.set(groupKey, []);
		}
		groups.get(groupKey).push(s);
	}

	const result = [];

	for (const [, items] of groups) {
		const sorted = [...items].sort((a, b) => {
			const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
			if (startDiff !== 0) return startDiff;
			return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
		});

		let current = null;

		for (const item of sorted) {
			if (!current) {
				current = { ...item };
				continue;
			}

			const currentEndMin = timeToMinutes(current.endTime);
			const itemStartMin = timeToMinutes(item.startTime);
			const itemEndMin = timeToMinutes(item.endTime);

			if (itemStartMin <= currentEndMin + maxGapMinutes) {
				if (itemEndMin > currentEndMin) {
					current.endTime = item.endTime;
				}
				const prevIds = current.mergedScheduleIds || (current.id != null ? [current.id] : []);
				if (item.id != null && !prevIds.includes(item.id)) {
					current.mergedScheduleIds = [...prevIds, item.id];
				}
			} else {
				result.push(current);
				current = { ...item };
			}
		}

		if (current) {
			result.push(current);
		}
	}

	result.sort((a, b) => {
		const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
		if (startDiff !== 0) return startDiff;
		return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
	});

	return result;
}

