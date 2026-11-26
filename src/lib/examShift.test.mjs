import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShiftRequest, describeShift, shortDate } from "./examShift.js";

const base = { semesterId: 3, facultyIds: [] };

test("days and weeks become a signed amount", () => {
	assert.deepEqual(buildShiftRequest({ ...base, mode: "days", amount: "2" }).body, { semester_id: 3, mode: "days", amount: 2 });
	assert.deepEqual(buildShiftRequest({ ...base, mode: "weeks", amount: 2, direction: "earlier" }).body, {
		semester_id: 3,
		mode: "weeks",
		amount: -2,
	});
});

test("a new start date is sent as is", () => {
	assert.deepEqual(buildShiftRequest({ ...base, mode: "start_date", newStartDate: "2026-08-24" }).body, {
		semester_id: 3,
		mode: "start_date",
		new_start_date: "2026-08-24",
	});
});

test("the optional filters are only sent when used", () => {
	const { body } = buildShiftRequest({
		...base,
		mode: "days",
		amount: 1,
		facultyIds: ["FE-76"],
		fromDate: "2026-08-10",
		toDate: "2026-08-21",
	});
	assert.deepEqual(body, {
		semester_id: 3,
		mode: "days",
		amount: 1,
		faculty_ids: ["FE-76"],
		from_date: "2026-08-10",
		to_date: "2026-08-21",
	});
});

test("incomplete or impossible forms explain what is missing", () => {
	assert.match(buildShiftRequest({ ...base, mode: "days", amount: "" }).error, /1 to 60/);
	assert.match(buildShiftRequest({ ...base, mode: "weeks", amount: 0 }).error, /weeks/);
	assert.match(buildShiftRequest({ ...base, mode: "days", amount: 1.5 }).error, /whole number/);
	assert.match(buildShiftRequest({ ...base, mode: "start_date" }).error, /new date/);
	assert.match(
		buildShiftRequest({ ...base, mode: "days", amount: 1, fromDate: "2026-08-21", toDate: "2026-08-10" }).error,
		/after/,
	);
	assert.match(buildShiftRequest({ semesterId: null, mode: "days", amount: 1 }).error, /semester/);
});

test("dates are shown without time-zone drift", () => {
	assert.equal(shortDate("2026-08-16"), "Sun 16 Aug");
	assert.equal(shortDate(""), "");
});

test("the preview summary reads naturally", () => {
	assert.equal(describeShift({ selected: 0, moving: 0 }), "No exams match these choices.");
	assert.equal(describeShift({ selected: 4, moving: 0 }), "None of the chosen exams would change date.");
	assert.equal(describeShift({ selected: 40, moving: 12 }), "12 of 40 exams will move.");
	assert.equal(describeShift({ selected: 5, moving: 5 }), "5 exams will move.");
	assert.equal(describeShift({ selected: 1, moving: 1 }), "1 exam will move.");
});
