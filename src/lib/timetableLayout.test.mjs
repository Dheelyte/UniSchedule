import { test } from "node:test";
import assert from "node:assert/strict";
import {
	assignLanes,
	splitCourseCode,
	computeDayRange,
	fitChipText,
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

test("fitChipText falls back without shrinking the font", () => {
	const sizes = { main: 7, prefix: 6 };
	const measure = (text) => text.length; // 1 unit per character
	assert.equal(fitChipText("UNILAG-HIS206", 10, measure, sizes).kind, "two-line");
	assert.equal(fitChipText("HIS201", 10, measure, sizes).kind, "single");
	const mainOnly = fitChipText("UNIVERSITY-HIS206", 8, measure, sizes);
	assert.equal(mainOnly.kind, "main-only");
	assert.equal(mainOnly.marked, true);
	assert.deepEqual(mainOnly.lines, ["HIS206"]);
	const stacked = fitChipText("UNILAG-HIS206", 4, measure, sizes);
	assert.deepEqual(stacked.lines, ["HIS", "206"]);
	assert.equal(stacked.marked, true);
	assert.equal(fitChipText("HIS201", 4, measure, sizes).marked, false);
	assert.equal(fitChipText("UNILAG-HIS206", 2, measure, sizes).kind, "clipped");
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

