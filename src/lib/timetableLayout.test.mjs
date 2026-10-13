import { test } from "node:test";
import assert from "node:assert/strict";
import {
	assignLanes,
	splitCourseCode,
	computeDayRange,
	layoutChipLabel,
	splitChipCode,
	ONLINE_ROOM_ID,
	ONLINE_ROOM_NAME,
	isScheduleOnline,
	scheduleMatchesRoom,
	buildFacultyRooms,
	mergeAdjacentCourseSchedules,
} from "./timetableLayout.js";

const cls = (id, startTime, endTime) => ({ id, startTime, endTime });
const lanesById = (placed) => Object.fromEntries(placed.map((c) => [c.id, c.lane]));

test("assignLanes: no overlap uses a single lane", () => {
	const placed = assignLanes([cls("a", "08:00", "10:00"), cls("b", "13:00", "15:00")]);
	assert.deepEqual(lanesById(placed), { a: 0, b: 0 });
	assert.ok(placed.every((c) => c.laneCount === 1));
});

test("assignLanes: partial overlap (8-10 & 9-11) opens a second lane", () => {
	const placed = assignLanes([cls("b", "09:00", "11:00"), cls("a", "08:00", "10:00")]);
	assert.deepEqual(lanesById(placed), { a: 0, b: 1 });
	assert.ok(placed.every((c) => c.laneCount === 2));
});

test("assignLanes: full overlap (two classes 12-2) gets two lanes", () => {
	const placed = assignLanes([cls("a", "12:00", "14:00"), cls("b", "12:00", "14:00")]);
	assert.deepEqual(new Set(placed.map((c) => c.lane)), new Set([0, 1]));
	assert.ok(placed.every((c) => c.laneCount === 2));
});

test("assignLanes: back-to-back (10-12 then 12-2) shares a lane", () => {
	const placed = assignLanes([cls("a", "10:00", "12:00"), cls("b", "12:00", "14:00")]);
	assert.deepEqual(lanesById(placed), { a: 0, b: 0 });
	assert.equal(placed[0].laneCount, 1);
});

test("assignLanes: three-way overlap needs three lanes, later class reuses a freed lane", () => {
	const placed = assignLanes([
		cls("a", "08:00", "11:00"),
		cls("b", "09:00", "11:00"),
		cls("c", "10:00", "12:00"),
		cls("d", "11:00", "12:00"),
	]);
	assert.deepEqual(lanesById(placed), { a: 0, b: 1, c: 2, d: 0 });
	assert.ok(placed.every((c) => c.laneCount === 3));
});

test("assignLanes: empty input", () => {
	assert.deepEqual(assignLanes([]), []);
});

test("splitCourseCode splits at the last hyphen", () => {
	assert.deepEqual(splitCourseCode("UNILAG-HIS206"), { prefix: "UNILAG", main: "HIS206" });
	assert.deepEqual(splitCourseCode("LAG-PHL219"), { prefix: "LAG", main: "PHL219" });
	assert.deepEqual(splitCourseCode("ENG-CM102"), { prefix: "ENG", main: "CM102" });
	assert.deepEqual(splitCourseCode("A-B-C101"), { prefix: "A-B", main: "C101" });
	assert.deepEqual(splitCourseCode("HIS201"), { prefix: "", main: "HIS201" });
	assert.deepEqual(splitCourseCode("GST105/GST111"), { prefix: "", main: "GST105 / GST111" });
});

test("computeDayRange keeps 8-18 when everything fits", () => {
	const r = computeDayRange([cls("a", "08:00", "10:00"), cls("b", "16:00", "18:00")]);
	assert.deepEqual(r, { startH: 8, endH: 18, outOfRange: [] });
});

test("computeDayRange widens to even hours and reports offenders", () => {
	const late = cls("late", "17:00", "19:00");
	const early = cls("early", "07:00", "09:00");
	const r = computeDayRange([cls("a", "10:00", "12:00"), late, early]);
	assert.equal(r.startH, 6);
	assert.equal(r.endH, 20);
	assert.deepEqual(r.outOfRange.map((c) => c.id), ["late", "early"]);
});

test("computeDayRange with trim option trims leading and trailing empty hours", () => {
	const classes = [cls("a", "09:00", "11:00"), cls("b", "14:00", "16:00")];
	const r = computeDayRange(classes, 8, 18, { trim: true });
	assert.equal(r.startH, 9);
	assert.equal(r.endH, 16);
});

test("splitChipCode breaks only after a hyphen or before ( and never inside subject+number tokens", () => {
	const measure = (text) => text.length;
	assert.deepEqual(splitChipCode("UNILAG-HIS206", measure), ["UNILAG-", "HIS206"]);
	assert.deepEqual(splitChipCode("UNILAG-HIS-305", measure), ["UNILAG-", "HIS-305"]);
	assert.deepEqual(splitChipCode("LAG-GST-EN101", measure), ["LAG-GST-", "EN101"]);
	assert.deepEqual(splitChipCode("CEG211(EE:I)", measure), ["CEG211", "(EE:I)"]);
	assert.deepEqual(splitChipCode("PPGG325(Lab)", measure), ["PPGG325", "(Lab)"]);
	assert.deepEqual(splitChipCode("LAG-PHL219", measure), ["LAG-", "PHL219"]);
	assert.deepEqual(splitChipCode("RUS-CM233", measure), ["RUS-", "CM233"]);
	assert.deepEqual(splitChipCode("MAT101-A", measure), ["MAT101-", "A"]);
	assert.equal(splitChipCode("HIS201", measure), null);
	assert.equal(splitChipCode("PHY225N", measure), null);
});

test("layoutChipLabel: joining lines reproduces the original code exactly for all code shapes", () => {
	const codeShapes = [
		"HIS201",
		"LAG-PHL219",
		"RUS-CM233",
		"UNILAG-HIS206",
		"UNILAG-HIS-305",
		"LAG-GST-EN101",
		"CEG211(EE:I)",
		"PPGG325(Lab)",
		"MAT101-A",
		"PHY225N"
	];
	const measure = (text, size) => text.length * size * 0.5;

	for (const code of codeShapes) {
		// Test in 1-hour chip (e.g. 21pt width)
		const res1h = layoutChipLabel(code, 21, 18.7, measure);
		assert.equal(res1h.lines.join(""), code, `1h lines join back to ${code}`);
		assert.ok(res1h.fontSizePt >= 6, `${code} font size must be >= 6pt (got ${res1h.fontSizePt})`);

		// Test in 2-hour chip (e.g. 42pt width)
		const res2h = layoutChipLabel(code, 42, 18.7, measure);
		assert.equal(res2h.lines.join(""), code, `2h lines join back to ${code}`);
		assert.ok(res2h.fontSizePt >= 6, `${code} font size must be >= 6pt (got ${res2h.fontSizePt})`);
	}
});

test("layoutChipLabel: long codes in 1-hour chips come back rotated; HIS201 in 2-hour chip is one horizontal line", () => {
	const measure = (text, size) => text.length * size * 0.5;

	// 1-hour chips (< 2 hours) are always rotated
	const res1h = layoutChipLabel("UNILAG-HIS-305", 21, 18.7, measure);
	assert.equal(res1h.rotated, true);

	// HIS201 in a 2-hour chip (>= 2 hours) is horizontal and on a single line
	const res2h = layoutChipLabel("HIS201", 42, 18.7, measure);
	assert.equal(res2h.rotated, false);
	assert.deepEqual(res2h.lines, ["HIS201"]);
	assert.equal(res2h.fontSizePt, 7);
});

test("isScheduleOnline identifies online schedules from various properties", () => {
	assert.equal(isScheduleOnline({ is_online: true }), true);
	assert.equal(isScheduleOnline({ isOnline: true }), true);
	assert.equal(isScheduleOnline({ roomId: ONLINE_ROOM_ID }), true);
	assert.equal(isScheduleOnline({ roomIds: [ONLINE_ROOM_ID] }), true);
	assert.equal(isScheduleOnline({ is_online: false, roomIds: [101] }), false);
	assert.equal(isScheduleOnline(null), false);
	assert.equal(isScheduleOnline({}), false);
});

test("scheduleMatchesRoom routes online courses only to the online room", () => {
	const onlineRoom = { id: ONLINE_ROOM_ID, name: ONLINE_ROOM_NAME, isOnline: true };
	const physicalRoom = { id: 101, name: "Room 101" };
	const otherPhysicalRoom = { id: 102, name: "Room 102" };

	const onlineClass = { id: 1, courseCode: "CSC201", is_online: true, roomIds: [101] };
	const physicalClass = { id: 2, courseCode: "CSC202", is_online: false, roomIds: [101] };

	// Online class matches online room, does NOT match physical room even if residual roomIds exists
	assert.equal(scheduleMatchesRoom(onlineClass, onlineRoom), true);
	assert.equal(scheduleMatchesRoom(onlineClass, physicalRoom), false);

	// Physical class matches its assigned physical room, does NOT match online room
	assert.equal(scheduleMatchesRoom(physicalClass, onlineRoom), false);
	assert.equal(scheduleMatchesRoom(physicalClass, physicalRoom), true);
	assert.equal(scheduleMatchesRoom(physicalClass, otherPhysicalRoom), false);
});

test("buildFacultyRooms places online venue first when faculty has online courses", () => {
	const onlineRoom = { id: ONLINE_ROOM_ID, name: ONLINE_ROOM_NAME, isOnline: true };
	const r1 = { id: 101, name: "Room 101" };
	const r2 = { id: 102, name: "Room 102" };
	const r3 = { id: 103, name: "Room 103" };
	const activeRooms = [r1, r2, r3];

	const schedulesWithOnline = [
		{ id: 1, is_online: true },
		{ id: 2, is_online: false, roomIds: [102] },
	];

	const roomsWithOnline = buildFacultyRooms(schedulesWithOnline, activeRooms, onlineRoom);
	// Online room must be first, followed by active physical room 102 (101 and 103 excluded since not in this faculty)
	assert.deepEqual(roomsWithOnline, [onlineRoom, r2]);

	// When faculty has ONLY online courses
	const onlyOnlineSchedules = [{ id: 1, is_online: true }];
	const roomsOnlyOnline = buildFacultyRooms(onlyOnlineSchedules, activeRooms, onlineRoom);
	assert.deepEqual(roomsOnlyOnline, [onlineRoom]);

	// When faculty has NO online courses
	const onlyPhysicalSchedules = [{ id: 2, is_online: false, roomIds: [101] }];
	const roomsOnlyPhysical = buildFacultyRooms(onlyPhysicalSchedules, activeRooms, onlineRoom);
	assert.deepEqual(roomsOnlyPhysical, [r1]);
});

test("mergeAdjacentCourseSchedules: merges back-to-back entries for the same course in same venue", () => {
	const schedules = [
		{ id: 1, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "08:00", endTime: "09:00" },
		{ id: 2, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "09:00", endTime: "10:00" },
	];
	const merged = mergeAdjacentCourseSchedules(schedules);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].courseCode, "AAA111");
	assert.equal(merged[0].startTime, "08:00");
	assert.equal(merged[0].endTime, "10:00");
	assert.deepEqual(merged[0].mergedScheduleIds, [1, 2]);
});

test("mergeAdjacentCourseSchedules: merges multiple consecutive entries (3 hours straight)", () => {
	const schedules = [
		{ id: 1, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "08:00", endTime: "09:00" },
		{ id: 2, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "09:00", endTime: "10:00" },
		{ id: 3, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "10:00", endTime: "11:00" },
	];
	const merged = mergeAdjacentCourseSchedules(schedules);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].startTime, "08:00");
	assert.equal(merged[0].endTime, "11:00");
	assert.deepEqual(merged[0].mergedScheduleIds, [1, 2, 3]);
});

test("mergeAdjacentCourseSchedules: merges entries with close enough interval (within 15 minutes)", () => {
	const schedules = [
		{ id: 1, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "08:00", endTime: "08:50" },
		{ id: 2, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "09:00", endTime: "09:50" },
	];
	const merged = mergeAdjacentCourseSchedules(schedules);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].startTime, "08:00");
	assert.equal(merged[0].endTime, "09:50");
});

test("mergeAdjacentCourseSchedules: preserves distinct sessions separated by a large interval", () => {
	const schedules = [
		{ id: 1, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "08:00", endTime: "09:00" },
		{ id: 2, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "09:00", endTime: "10:00" },
		{ id: 3, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "14:00", endTime: "16:00" },
	];
	const merged = mergeAdjacentCourseSchedules(schedules);
	assert.equal(merged.length, 2);
	assert.equal(merged[0].startTime, "08:00");
	assert.equal(merged[0].endTime, "10:00");
	assert.equal(merged[1].startTime, "14:00");
	assert.equal(merged[1].endTime, "16:00");
});

test("mergeAdjacentCourseSchedules: preserves two separate non-overlapping sessions on the same day in same venue", () => {
	// A course scheduled twice on the same day in the same room at entirely different times
	const schedules = [
		{ id: 1, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "08:00", endTime: "10:00" },
		{ id: 2, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "14:00", endTime: "16:00" },
	];
	const merged = mergeAdjacentCourseSchedules(schedules);
	assert.equal(merged.length, 2);
	assert.equal(merged[0].startTime, "08:00");
	assert.equal(merged[0].endTime, "10:00");
	assert.equal(merged[1].startTime, "14:00");
	assert.equal(merged[1].endTime, "16:00");

	// When passed to assignLanes, both sessions are placed in the room
	const placed = assignLanes(merged);
	assert.equal(placed.length, 2);
	assert.equal(placed[0].startTime, "08:00");
	assert.equal(placed[1].startTime, "14:00");
});

test("mergeAdjacentCourseSchedules: does not merge different courses in the same room", () => {
	const schedules = [
		{ id: 1, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "08:00", endTime: "09:00" },
		{ id: 2, courseCode: "BBB222", day: "Monday", roomId: 10, startTime: "09:00", endTime: "10:00" },
	];
	const merged = mergeAdjacentCourseSchedules(schedules);
	assert.equal(merged.length, 2);
	assert.equal(merged[0].courseCode, "AAA111");
	assert.equal(merged[1].courseCode, "BBB222");
});

test("mergeAdjacentCourseSchedules: does not merge across different rooms", () => {
	const schedules = [
		{ id: 1, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "08:00", endTime: "09:00" },
		{ id: 2, courseCode: "AAA111", day: "Monday", roomId: 20, startTime: "09:00", endTime: "10:00" },
	];
	const merged = mergeAdjacentCourseSchedules(schedules);
	assert.equal(merged.length, 2);
	assert.equal(merged[0].roomId, 10);
	assert.equal(merged[1].roomId, 20);
});

test("mergeAdjacentCourseSchedules: does not merge across different days", () => {
	const schedules = [
		{ id: 1, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "08:00", endTime: "09:00" },
		{ id: 2, courseCode: "AAA111", day: "Tuesday", roomId: 10, startTime: "09:00", endTime: "10:00" },
	];
	const merged = mergeAdjacentCourseSchedules(schedules);
	assert.equal(merged.length, 2);
});

test("mergeAdjacentCourseSchedules: handles out-of-order input correctly", () => {
	const schedules = [
		{ id: 2, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "09:00", endTime: "10:00" },
		{ id: 1, courseCode: "AAA111", day: "Monday", roomId: 10, startTime: "08:00", endTime: "09:00" },
	];
	const merged = mergeAdjacentCourseSchedules(schedules);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].startTime, "08:00");
	assert.equal(merged[0].endTime, "10:00");
});

test("mergeAdjacentCourseSchedules: empty or invalid inputs", () => {
	assert.deepEqual(mergeAdjacentCourseSchedules([]), []);
	assert.deepEqual(mergeAdjacentCourseSchedules(null), []);
});

test("PDF export: dense faculty layout satisfies all requirements and fixture codes", async () => {
	const { exportTimetablePDF } = await import("./pdfExport.js");
	const rooms = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, name: "Room " + (100 + i), facultyId: 1 }));
	const codes = [
		"HIS201", "LAG-PHL219", "RUS-CM233", "UNILAG-HIS206", "UNILAG-HIS-305",
		"LAG-GST-EN101", "CEG211(EE:I)", "PPGG325(Lab)", "MAT101-A", "PHY225N"
	];
	const schedules = codes.map((code, idx) => ({
		id: idx + 1,
		courseCode: code,
		day: "Monday",
		startTime: "09:00",
		endTime: idx % 2 === 0 ? "10:00" : "11:00",
		roomId: 100 + idx,
		facultyId: 1
	}));
	const pdf = exportTimetablePDF({
		schedules,
		rooms,
		faculties: [{ id: 1, name: "Faculty of Arts" }],
		faculty: "Faculty of Arts",
		title: "Lecture Timetable",
		session: "2026/2027",
		semester: "First Semester",
		mode: "lecture",
		paperSize: "a3"
	});

	assert.ok(pdf, "PDF instance generated");
	assert.ok(pdf.getNumberOfPages() >= 2, "Dense faculty overflows vertically across multiple pages");

	const pdfString = pdf.output();
	assert.ok(!pdfString.includes("•"), "No prefix-dropping bullet marker in PDF");
	assert.ok(!pdfString.includes("…"), "No ellipsis marker in PDF");
});


