import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExport, ExportError, signoffQrDataUrl } from "./exportJob.js";

// A small bundle in the shape GET /export/bundle returns.
function bundle(overrides = {}) {
	return {
		realm: { key: "UG", name: "Undergraduate", config: undefined },
		session_name: "2026/2027",
		semester_id: 3,
		semester_name: "First Semester",
		timetable_type: "lecture",
		is_locked: false,
		signoff: { is_locked: false },
		faculties: [{ id: "SCI", name: "Faculty of Science" }, { id: "ENG", name: "Faculty of Engineering" }],
		departments: [
			{ id: 1, name: "Physics", faculty_id: "SCI" },
			{ id: 2, name: "Civil", faculty_id: "ENG" },
		],
		rooms: [
			{ id: 10, name: "LT 1", faculty_id: "SCI", is_active: true },
			{ id: 11, name: "CBT Centre", faculty_id: "SCI", is_active: true },
			{ id: 12, name: "Closed Hall", faculty_id: "ENG", is_active: false },
		],
		courses: [
			{ id: 100, code: "PHY201", title: "Mechanics", department_id: 1, level: 200, scope: "INTERFACULTY", is_cbt_exam: false },
			{ id: 101, code: "CEG301", title: "Structures", department_id: 2, level: 300, scope: "DEPARTMENTAL", is_cbt_exam: false },
			{ id: 102, code: "PHY101", title: "Physics I", department_id: 1, level: 100, scope: "DEPARTMENTAL", is_cbt_exam: true },
		],
		// Civil 300 level takes PHY201 too.
		enrollments: [{ id: 1, course_id: 100, department_id: 2, level: 300, enrolled_at: "2026-01-01T00:00:00Z" }],
		schedule_items: [
			{ id: 1, course_id: 100, room_ids: [10], faculty_id: "SCI", day_of_week: "Monday", start_time: "08:00:00", end_time: "10:00:00", type: "lecture", is_online: false },
			{ id: 2, course_id: 101, room_ids: [12], faculty_id: "ENG", day_of_week: "Tuesday", start_time: "10:00:00", end_time: "12:00:00", type: "lecture", is_online: false },
		],
		blocked_slots: [],
		...overrides,
	};
}

const examBundle = () => bundle({
	timetable_type: "exam",
	schedule_items: [
		{ id: 3, course_id: 100, room_ids: [10], faculty_id: "SCI", exam_date: "2026-08-10", start_time: "09:00:00", end_time: "12:00:00", type: "exam", is_online: false },
		{ id: 4, course_id: 102, room_ids: [11], faculty_id: "SCI", exam_date: "2026-08-11", start_time: "09:00:00", end_time: "12:00:00", type: "exam", is_online: false },
	],
});

test("buildExport: a lecture PDF with the standard file name", () => {
	const out = buildExport(bundle(), { kind: "lecture", paperSize: "a4" });
	assert.equal(out.contentType, "application/pdf");
	assert.ok(out.data.byteLength > 1000);
	assert.match(out.fileName, /2026-2027_first_semester.*\.pdf$/);
});

test("buildExport: a department gets the courses its students take from elsewhere", () => {
	const out = buildExport(bundle(), { kind: "lecture", format: "csv", departmentId: "2" });
	assert.ok(out.data.startsWith("﻿"), "CSV starts with a BOM so Excel reads UTF-8");
	assert.match(out.data, /PHY201/, "PHY201 is taken by Civil 300 level");
	assert.match(out.data, /CEG301/);
});

test("buildExport: rooms switched off are left out of PDFs", () => {
	// CEG301 is only in a closed hall, so Engineering has nothing to print.
	assert.throws(
		() => buildExport(bundle({ enrollments: [] }), { kind: "lecture", facultyId: "ENG" }),
		(e) => e instanceof ExportError && e.status === 404,
	);
});

test("buildExport: nothing matching the filters is an ExportError, not a crash", () => {
	assert.throws(() => buildExport(bundle(), { kind: "lecture", level: "500" }), ExportError);
	assert.throws(() => buildExport(bundle(), { kind: "nope" }), ExportError);
});

test("buildExport: CBT exports only CBT courses", () => {
	const cbt = buildExport(examBundle(), { kind: "cbt", format: "csv" });
	assert.match(cbt.data, /PHY101/);
	assert.doesNotMatch(cbt.data, /PHY201/);
	const exam = buildExport(examBundle(), { kind: "exam", format: "csv" });
	assert.match(exam.data, /PHY201/);
	assert.match(exam.data, /PHY101/);
});

test("signoffQrDataUrl: a QR image for a FINAL timetable, nothing for a draft", async () => {
	assert.equal(await signoffQrDataUrl({ is_locked: false }), null);
	const qr = await signoffQrDataUrl({ is_locked: true, verification: { code: "UG-7K3P-92QD" } });
	assert.match(qr, /^data:image\/png;base64,/);
});
