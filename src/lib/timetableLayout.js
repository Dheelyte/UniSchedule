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
export function computeDayRange(classes, defaultStartH = 8, defaultEndH = 18) {
	let startMin = defaultStartH * 60;
	let endMin = defaultEndH * 60;
	const outOfRange = [];
	classes.forEach((cls) => {
		const s = timeToMinutes(cls.startTime);
		const e = timeToMinutes(cls.endTime);
		if (s < defaultStartH * 60 || e > defaultEndH * 60) outOfRange.push(cls);
		startMin = Math.min(startMin, s);
		endMin = Math.max(endMin, e);
	});
	let startH = Math.floor(startMin / 60);
	let endH = Math.ceil(endMin / 60);
	if (startH % 2 !== 0) startH -= 1;
	if (endH % 2 !== 0) endH += 1;
	return { startH: Math.max(0, startH), endH: Math.min(24, endH), outOfRange };
}

// Chooses how a chip's text is laid out, at FIXED font sizes (never shrunk).
// `measure(text, fontSizePt, bold)` returns the text width in the same unit as
// `innerW`. `marked` means the prefix was dropped; the renderer then draws a
// small "•" in the chip corner (explained by a legend). Fallback order:
//   "single"    code without a prefix on one centred line
//   "two-line"  prefix over main code
//   "main-only" main code alone
//   "stacked"   main code broken into letters / digits over two lines
//   "clipped"   last-resort: main code truncated with an ellipsis
export function fitChipText(rawCode, innerW, measure, sizes) {
	const { prefix, main } = splitCourseCode(rawCode);
	const marked = !!prefix;
	const fits = (text, size, bold) => measure(text, size, bold) <= innerW;

	if (fits(main, sizes.main, true)) {
		if (!prefix) return { kind: "single", lines: [main], marked: false };
		if (fits(prefix, sizes.prefix, false)) return { kind: "two-line", prefix, lines: [main], marked: false };
		return { kind: "main-only", lines: [main], marked };
	}
	const m = main.match(/^([A-Za-z]+)\s*(\d.*)$/);
	if (m && fits(m[1], sizes.main, true) && fits(m[2], sizes.main, true)) {
		return { kind: "stacked", lines: [m[1], m[2]], marked };
	}
	let clipped = main;
	while (clipped.length > 1 && !fits(clipped + "…", sizes.main, true)) {
		clipped = clipped.slice(0, -1);
	}
	return { kind: "clipped", lines: [clipped + "…"], marked };
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

