import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildTimeSlots,
	clipSchedulesToWindow,
	DAILY_EXPORT_FORMATS,
	formatCompactClock,
	getDailyExportFormat,
} from "./timetableLayout.js";

test("formatCompactClock: 12-hour, no suffix, minutes only when non-zero", () => {
	assert.equal(formatCompactClock(8 * 60), "8");
	assert.equal(formatCompactClock(12 * 60), "12");
	assert.equal(formatCompactClock(13 * 60), "1");
	assert.equal(formatCompactClock(16 * 60 + 30), "4:30");
	assert.equal(formatCompactClock(0), "12");
});

test("UG daily-hourly: ten 1-hour slots 8 - 9:00am ... 5 - 6:00pm", () => {
	const f = DAILY_EXPORT_FORMATS["daily-hourly"];
	const labels = buildTimeSlots(f.startMin, f.endMin, f.stepMin, f.labelStyle).map((s) => s.label);
	assert.deepEqual(labels, [
		"8 - 9:00am",
		"9 - 10:00am",
		"10 - 11:00am",
		"11am - 12:00pm",
		"12 - 1:00pm",
		"1 - 2:00pm",
		"2 - 3:00pm",
		"3 - 4:00pm",
		"4 - 5:00pm",
		"5 - 6:00pm",
	]);
});

test("ICE daily-ice-30: twelve 30-minute slots 4:00 - 4:30pm ... 9:30 - 10:00pm, nothing before 4pm", () => {
	const f = DAILY_EXPORT_FORMATS["daily-ice-30"];
	const slots = buildTimeSlots(f.startMin, f.endMin, f.stepMin, f.labelStyle);
	assert.equal(slots.length, 12);
	assert.equal(slots[0].label, "4:00 - 4:30pm");
	assert.equal(slots[1].label, "4:30 - 5:00pm");
	assert.equal(slots[11].label, "9:30 - 10:00pm");
	assert.ok(slots.every((s) => s.startMin >= 16 * 60));
});

test("getDailyExportFormat: standard layout is not a daily format", () => {
	assert.equal(getDailyExportFormat("standard"), null);
	assert.equal(getDailyExportFormat(undefined), null);
	assert.equal(getDailyExportFormat("daily-ice-30").stepMin, 30);
});

test("clipSchedulesToWindow: inside, clipped and outside classes", () => {
	const { inside, outside } = clipSchedulesToWindow(
		[
			{ courseCode: "A", startTime: "17:00", endTime: "18:30" }, // fully inside
			{ courseCode: "B", startTime: "15:00", endTime: "17:00" }, // starts before 4pm
			{ courseCode: "C", startTime: "09:00", endTime: "11:00" }, // morning: outside
			{ courseCode: "D", startTime: "21:00", endTime: "22:30" }, // ends after 10pm
		],
		16 * 60,
		22 * 60,
	);
	assert.deepEqual(outside.map((s) => s.courseCode), ["C"]);
	const byCode = Object.fromEntries(inside.map((s) => [s.courseCode, s]));
	assert.equal(byCode.A.clipped, false);
	assert.equal(byCode.B.startTime, "16:00");
	assert.equal(byCode.B.originalStartTime, "15:00");
	assert.equal(byCode.B.clipped, true);
	assert.equal(byCode.D.endTime, "22:00");
});

const rooms = [
	{ id: 1, name: "LT 1", facultyId: 5 },
	{ id: 2, name: "LT 2", facultyId: 5 },
];
const faculties = [{ id: 5, name: "Faculty of Law" }];

test("Daily PDF (UG 1-hour): cover + one page per lecture day with 8 - 9:00am style headers, A3 default, standard naming", async () => {
	const { exportDailyTimetablePDF } = await import("./pdfExportDaily.js");
	const schedules = [
		{ id: 1, courseCode: "LAW101", day: "Monday", startTime: "08:00", endTime: "09:30", roomIds: [1], facultyName: "Faculty of Law" },
		{ id: 2, courseCode: "LAW205", day: "Wednesday", startTime: "11:00", endTime: "13:00", roomIds: [2], facultyName: "Faculty of Law" },
	];
	const pdf = exportDailyTimetablePDF({
		compress: false,
		schedules, rooms, faculties,
		faculty: "Faculty of Law", session: "2026/2027", semester: "First Semester",
		layout: "daily-hourly", isLocked: true,
	});
	// Cover + Monday-Friday (Saturday only when used): 6 pages.
	assert.equal(pdf.getNumberOfPages(), 6);
	// Default paperSize is A3 landscape (420mm x 297mm)
	assert.equal(Math.round(pdf.internal.pageSize.getWidth()), 420);
	const out = pdf.output();
	for (const label of ["(8 - 9:00am)", "(12 - 1:00pm)", "(5 - 6:00pm)", "(MONDAY)", "(FRIDAY)", "(LECTURE TIMETABLE)", "(FINAL TIMETABLE)"]) {
		assert.ok(out.includes(label), `PDF contains ${label}`);
	}
	assert.ok(!out.includes("(SATURDAY)"), "No Saturday page when nothing is scheduled on it");
	assert.ok(!out.includes("slots, 8am"), "No slot caption under the day name");
	assert.match(pdf.fileName, /^faculty_of_law_timetable_lectures_2026-2027_first_semester_\d{4}-\d{2}-\d{2}_a3\.pdf$/);
});

test("Daily PDF (General Studies): only days with GST schedules are printed, not the entire week", async () => {
	const { exportDailyTimetablePDF } = await import("./pdfExportDaily.js");
	const schedules = [
		{ id: 10, courseCode: "GST111", day: "Friday", startTime: "16:00", endTime: "18:00", isOnline: true, facultyName: "Faculty of Law" },
		{ id: 11, courseCode: "LAW101", day: "Monday", startTime: "08:00", endTime: "10:00", roomIds: [1], facultyName: "Faculty of Law" },
	];
	const pdf = exportDailyTimetablePDF({
		compress: false,
		schedules, rooms, faculties,
		faculty: "Faculty of Law", session: "2026/2027", semester: "First Semester",
		layout: "daily-hourly",
	});
	// Cover (1) + GST section (Friday only = 1) + Faculty of Law section (Mon-Fri = 5) = 7 pages.
	assert.equal(pdf.getNumberOfPages(), 7);
});

test("Daily PDF (ICE 30-min): 4pm-10pm columns, morning classes listed not drawn", async () => {
	const { exportDailyTimetablePDF } = await import("./pdfExportDaily.js");
	const iceConfig = {
		lecture_days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
		exam_days: [], day_start: "07:00", day_end: "21:00", slot_minutes: 15, exam_slots: [],
	};
	const schedules = [
		{ id: 1, courseCode: "ICE-LAW301", day: "Tuesday", startTime: "16:00", endTime: "17:30", roomIds: [1] },
		{ id: 2, courseCode: "ICE-LAW410", day: "Tuesday", startTime: "10:00", endTime: "11:30", roomIds: [2] },
		{ id: 3, courseCode: "ICE-LAW220", day: "Thursday", startTime: "18:30", endTime: "20:00", roomIds: [2] },
	];
	const pdf = exportDailyTimetablePDF({
		compress: false,
		schedules, rooms, faculties, config: iceConfig, realmKey: "ICE", realmName: "ICE",
		session: "2026/2027", semester: "First Semester", layout: "daily-ice-30",
	});
	// Cover + the days with classes (ICE teaches any day): Tuesday, Thursday.
	assert.equal(pdf.getNumberOfPages(), 3);
	const out = pdf.output();
	for (const label of ["(4:00 - 4:30pm)", "(4:30 - 5:00pm)", "(9:30 - 10:00pm)", "(TUESDAY)", "(THURSDAY)"]) {
		assert.ok(out.includes(label), `PDF contains ${label}`);
	}
	assert.ok(!out.includes("(9 - 10:00am)") && !out.includes("(2 - 3:00pm)"), "No morning/afternoon columns");
	assert.ok(out.includes("ICE-LAW410 10am-11:30am"), "Out-of-window class is listed in the note");
	assert.match(pdf.fileName, /^ice_general_university_timetable_lectures_2026-2027_first_semester_\d{4}-\d{2}-\d{2}_a3\.pdf$/);
});

test("Daily PDF: many rooms on one day continue onto extra pages", async () => {
	const { exportDailyTimetablePDF } = await import("./pdfExportDaily.js");
	const manyRooms = Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, name: `Room ${100 + i}` }));
	const schedules = manyRooms.map((r, i) => ({
		id: i, courseCode: `CRS${100 + i}`, day: "Monday", startTime: "09:00", endTime: "10:00", roomIds: [r.id],
	}));
	const pdf = exportDailyTimetablePDF({
		compress: false, schedules, rooms: manyRooms, layout: "daily-hourly" });
	// Cover + Monday overflow (>1 page) + Tuesday-Friday (1 page each).
	assert.ok(pdf.getNumberOfPages() > 6);
});
