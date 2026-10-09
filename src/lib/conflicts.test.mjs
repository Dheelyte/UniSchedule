import { test } from "node:test";
import assert from "node:assert/strict";
import { detectConflicts, detectAllConflicts, countConflicts, toExternalBooking } from "./conflicts.js";

const ICE_CONFIG = {
	lecture_days: ["Friday", "Saturday", "Sunday"],
	exam_days: ["Friday", "Saturday", "Sunday"],
	day_start: "07:00",
	day_end: "21:00",
	slot_minutes: 15,
	exam_slots: [
		{ label: "7am - 10am", start: "07:00", end: "10:00" },
		{ label: "10am - 1pm", start: "10:00", end: "13:00" },
		{ label: "1pm - 4pm", start: "13:00", end: "16:00" },
		{ label: "4pm - 7pm", start: "16:00", end: "19:00" },
		{ label: "7pm - 9pm", start: "19:00", end: "21:00" },
	],
	levels: [100, 200, 300, 400, 500, 600, 700],
	semester_names: ["First Semester", "Second Semester"],
	strict: true,
};

let nextId = 1;
const lecture = (over = {}) => ({
	id: nextId++,
	type: "lecture",
	courseId: 1,
	courseCode: "CSC201",
	roomIds: [14],
	roomNames: "LT1",
	facultyId: "sci",
	day: "Friday",
	startTime: "10:00",
	endTime: "12:00",
	...over,
});
const exam = (over = {}) => lecture({ type: "exam", day: null, examDate: "2026-10-09", ...over });

// A UG row as GET /timetable/external-bookings returns it.
const ugBooking = (over = {}) =>
	toExternalBooking({
		id: 812,
		realm_key: "UG",
		realm_name: "Undergraduate",
		type: "lecture",
		room_ids: [14],
		day_of_week: "Friday",
		exam_date: null,
		start_time: "10:00:00",
		end_time: "12:00:00",
		course_code: "CSC201",
		is_special_faculty: false,
		...over,
	});

test("UG output is unchanged when no options are passed", () => {
	const a = lecture({ id: 1, courseId: 1, courseCode: "CSC201" });
	const b = lecture({ id: 2, courseId: 2, courseCode: "MTH101", startTime: "11:00", endTime: "13:00" });
	const late = lecture({ id: 3, courseId: 3, courseCode: "PHY101", roomIds: [15], day: "Monday", startTime: "17:00", endTime: "19:00" });

	assert.deepEqual(detectConflicts({ ...b, id: undefined }, [a], null), {
		hasConflict: true,
		hasWarning: true,
		conflicts: [
			{
				type: "room",
				severity: "error",
				relatedId: 1,
				otherScope: null,
				message: 'Room conflict: "LT1" is already booked for CSC201 on Friday 10:00–12:00.',
			},
		],
	});
	assert.deepEqual(detectConflicts({ ...late, id: undefined }, [a], null).conflicts, [
		{
			type: "time",
			severity: "warning",
			message: "Time warning: This slot (17:00–19:00) falls outside standard operating hours (08:00–18:00).",
		},
	]);

	const map = detectAllConflicts([a, b, late]);
	assert.deepEqual([...map.keys()], [1, 2, 3]);
	assert.deepEqual(map.get(1), [
		{ type: "room", severity: "error", message: 'Room "LT1" double-booked with MTH101 (11:00–13:00)', relatedId: 2 },
	]);
	assert.deepEqual(map.get(3), [{ type: "time", severity: "warning", message: "Outside operating hours (08:00–18:00)" }]);
	assert.deepEqual(countConflicts([a, b, late]), { errorCount: 1, warningCount: 1, totalCount: 2 });

	// Passing UG's defaults explicitly, or no external bookings, changes nothing.
	assert.deepEqual(detectAllConflicts([a, b, late], null, null, null, { externalBookings: [] }), map);
});

test("the outside-hours check follows the realm's window", () => {
	const evening = lecture({ startTime: "19:15", endTime: "20:45" });
	assert.equal(detectConflicts(evening, [], null).conflicts[0]?.type, "time");
	assert.deepEqual(detectConflicts(evening, [], null, null, null, { config: ICE_CONFIG }).conflicts, []);

	const early = lecture({ startTime: "06:45", endTime: "08:00" });
	assert.deepEqual(detectConflicts(early, [], null, null, null, { config: ICE_CONFIG }).conflicts, [
		{
			type: "time",
			severity: "warning",
			message: "Time warning: This slot (06:45–08:00) falls outside standard operating hours (07:00–21:00).",
		},
	]);

	const item = { ...evening, id: 50 };
	assert.equal(detectAllConflicts([item]).get(50)[0].message, "Outside operating hours (08:00–18:00)");
	assert.equal(detectAllConflicts([item], null, null, null, { config: ICE_CONFIG }).size, 0);
	assert.equal(countConflicts([item]).warningCount, 1);
	assert.equal(countConflicts([item], { config: ICE_CONFIG }).warningCount, 0);
});

test("external bookings are shaped like schedule items with an ext- id", () => {
	assert.deepEqual(ugBooking(), {
		id: "ext-812",
		external: true,
		realmKey: "UG",
		realmName: "Undergraduate",
		type: "lecture",
		roomIds: [14],
		day: "Friday",
		examDate: null,
		startTime: "10:00",
		endTime: "12:00",
		courseCode: "CSC201",
		isSpecialFaculty: false,
	});
});

test("a same-type overlap with another realm's booking is an error", () => {
	const options = { config: ICE_CONFIG, externalBookings: [ugBooking()] };
	const candidate = lecture({ id: undefined, courseCode: "ICE101", startTime: "11:00", endTime: "13:00" });

	const result = detectConflicts(candidate, [], null, null, null, options);
	assert.equal(result.hasConflict, true);
	assert.equal(result.conflicts.length, 1);
	const [clash] = result.conflicts;
	assert.deepEqual(
		{ type: clash.type, severity: clash.severity, external: clash.external, relatedId: clash.relatedId },
		{ type: "room", severity: "error", external: true, relatedId: "ext-812" },
	);
	assert.match(clash.message, /held by Undergraduate · CSC201 on Friday 10:00–12:00/);

	// A different room, another day, or a back-to-back slot is fine.
	const free = (over) => detectConflicts({ ...candidate, ...over }, [], null, null, null, options).conflicts;
	assert.deepEqual(free({ roomIds: [15] }), []);
	assert.deepEqual(free({ day: "Sunday" }), []);
	assert.deepEqual(free({ startTime: "12:00", endTime: "14:00" }), []);
	// Room ids from a form may be strings.
	assert.equal(free({ roomIds: ["14"] }).length, 1);
});

test("a clash with another realm can't be overridden by priority or dismissed", () => {
	const options = { externalBookings: [ugBooking()] };
	const uw = lecture({ id: undefined, courseScope: "UNIVERSITY_WIDE" });
	const result = detectConflicts(uw, [], null, null, null, options);
	assert.equal(result.hasConflict, true);
	assert.equal(result.conflicts[0].priorityOverride, undefined);

	// Dismissal signatures are built from numeric ids; an ext- id never matches one.
	const item = lecture({ id: 7 });
	const dismissed = new Set(["room:7:", "room:7:812", "room:NaN:NaN"]);
	const map = detectAllConflicts([item], null, null, dismissed, options);
	assert.equal(map.get(7).length, 1);
	assert.equal(map.get(7)[0].external, true);
	assert.equal(map.get(7)[0].severity, "error");
});

test("special faculties are exempt from external clashes on either side", () => {
	const special = lecture({ id: 8, isSpecialFaculty: true });
	assert.equal(detectAllConflicts([special], null, null, null, { externalBookings: [ugBooking()] }).size, 0);
	const plain = lecture({ id: 9 });
	const exemptBooking = ugBooking({ is_special_faculty: true });
	assert.equal(detectAllConflicts([plain], null, null, null, { externalBookings: [exemptBooking] }).size, 0);
});

test("exams clash with another realm's exams by date", () => {
	const ugExam = ugBooking({ type: "exam", day_of_week: null, exam_date: "2026-10-11", start_time: "09:00:00" });
	const options = { config: ICE_CONFIG, externalBookings: [ugExam] };
	const sameDate = exam({ id: 20, examDate: "2026-10-11", startTime: "10:00", endTime: "13:00" });
	const otherDate = exam({ id: 21, examDate: "2026-10-10", startTime: "10:00", endTime: "13:00" });
	const map = detectAllConflicts([sameDate, otherDate], null, null, null, options);
	assert.deepEqual([...map.keys()], [20]);
	assert.equal(map.get(20)[0].severity, "error");
	assert.match(map.get(20)[0].message, /on 2026-10-11 09:00–12:00/);
});

test("a lecture against another realm's exam is only a warning", () => {
	// 2026-10-09 is a Friday: an exam that day meets the weekly UG Friday lecture.
	const options = { config: ICE_CONFIG, externalBookings: [ugBooking()] };
	const fridayExam = exam({ id: undefined, examDate: "2026-10-09", startTime: "11:00", endTime: "13:00" });
	const result = detectConflicts(fridayExam, [], null, null, null, options);
	assert.equal(result.hasConflict, false);
	assert.equal(result.hasWarning, true);
	assert.deepEqual(
		result.conflicts.map((c) => [c.type, c.severity, c.external, c.crossType, c.relatedId]),
		[["room", "warning", true, true, "ext-812"]],
	);
	assert.match(result.conflicts[0].message, /weekly Undergraduate lecture \(CSC201\) on Fridays 10:00–12:00/);
	// An exam on the Saturday doesn't meet the Friday lecture.
	assert.deepEqual(detectConflicts({ ...fridayExam, examDate: "2026-10-10" }, [], null, null, null, options).conflicts, []);

	// The other way round: a weekly lecture against an exam dated on its weekday.
	const ugExam = ugBooking({ type: "exam", day_of_week: null, exam_date: "2026-10-11" });
	const sunday = lecture({ id: 30, day: "Sunday", startTime: "09:00", endTime: "11:00" });
	const friday = lecture({ id: 31, day: "Friday", startTime: "09:00", endTime: "11:00" });
	const map = detectAllConflicts([sunday, friday], null, null, null, { config: ICE_CONFIG, externalBookings: [ugExam] });
	assert.deepEqual([...map.keys()], [30]);
	assert.equal(map.get(30)[0].severity, "warning");
	assert.match(map.get(30)[0].message, /Undergraduate exam \(CSC201\) on 2026-10-11 10:00–12:00/);
});
