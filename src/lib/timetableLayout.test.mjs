import { test } from "node:test";
import assert from "node:assert/strict";
import { assignLanes, splitCourseCode, computeDayRange, fitChipText } from "./timetableLayout.js";

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
