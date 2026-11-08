import { test } from "node:test";
import assert from "node:assert/strict";
import { filterSchedulesForExport } from "./exportFilters.js";

const faculties = [
	{ id: "SCI", name: "Science" },
	{ id: "ENG", name: "Engineering" },
	{ id: "GS", name: "General Studies" },
];
const departments = [
	{ id: 1, facultyId: "SCI" },
	{ id: 2, facultyId: "ENG" },
];
const courses = [
	{ id: 10, code: "MTH101", isCbtExam: true },
	{ id: 11, code: "EEG201", isCbtExam: false },
	{ id: 12, code: "GST101", isCbtExam: true },
];
const schedules = [
	{ id: 1, courseId: 10, courseCode: "MTH101", departmentId: 1, facultyId: "SCI", courseLevel: 100 },
	{ id: 2, courseId: 11, courseCode: "EEG201", departmentId: 2, facultyId: "ENG", courseLevel: 200 },
	{ id: 3, courseId: 12, courseCode: "GST101", departmentId: 1, facultyId: "SCI", courseLevel: 100 },
];
// Engineering 100-level students take MTH101.
const enrollmentsByCourse = new Map([[10, [{ course_id: 10, department_id: 2, level: 100 }]]]);
const base = { faculties, departments, courses, enrollmentsByCourse };
const ids = (rows) => rows.map((r) => r.id);

test("no filters keeps everything", () => {
	assert.deepEqual(ids(filterSchedulesForExport(schedules, base)), [1, 2, 3]);
});

test("department filter includes courses its students are enrolled in", () => {
	assert.deepEqual(ids(filterSchedulesForExport(schedules, { ...base, departmentId: "2" })), [1, 2]);
});

test("level filter uses the enrolled level for taken courses", () => {
	assert.deepEqual(ids(filterSchedulesForExport(schedules, { ...base, departmentId: "2", level: "100" })), [1]);
	assert.deepEqual(ids(filterSchedulesForExport(schedules, { ...base, departmentId: "2", level: "200" })), [2]);
	assert.deepEqual(ids(filterSchedulesForExport(schedules, { ...base, level: 100 })), [1, 3]);
});

test("faculty filter includes enrolled courses", () => {
	assert.deepEqual(ids(filterSchedulesForExport(schedules, { ...base, facultyId: "ENG" })), [1, 2]);
});

test("General Studies faculty and gstOnly select GST courses", () => {
	assert.deepEqual(ids(filterSchedulesForExport(schedules, { ...base, facultyId: "GS" })), [3]);
	const gst = filterSchedulesForExport(schedules, { ...base, gstOnly: true });
	assert.deepEqual(ids(gst), [3]);
	assert.equal(gst[0].facultyName, "General Studies");
});

test("cbtOnly keeps CBT courses", () => {
	assert.deepEqual(ids(filterSchedulesForExport(schedules, { ...base, cbtOnly: true })), [1, 3]);
});
