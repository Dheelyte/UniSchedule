import test from "node:test";
import assert from "node:assert/strict";
import { roomChoices, venueFacultyIds } from "./venueGroups.js";

const rooms = [
	{ id: 1, name: "Hall 10", faculty_id: "FLS-290" },
	{ id: 2, name: "Hall 2", faculty_id: "FLS-290" },
	{ id: 3, name: "CS Lab", faculty_id: "FCAI-243" },
	{ id: 4, name: "PES 1", faculty_id: "FPAES-7903" },
	{ id: 5, name: "Law 1", faculty_id: "FL-1852" },
	{ id: 6, name: "Old", faculty_id: "FLS-290", is_active: false },
	{ id: 7, name: "Shared", faculty_id: null },
];

test("a faculty in a group gets all three faculties' rooms, its own first", () => {
	const sections = roomChoices(rooms, "FPAES-7903");
	assert.deepEqual(sections.map((s) => s.facultyId), ["FPAES-7903", "FLS-290", "FCAI-243"]);
	assert.deepEqual(sections[1].rooms.map((r) => r.name), ["Hall 2", "Hall 10"]); // numeric order, inactive left out
});

test("any of the three sees the same rooms", () => {
	const ids = (f) => roomChoices(rooms, f).flatMap((s) => s.rooms.map((r) => r.id)).sort();
	assert.deepEqual(ids("FLS-290"), ids("FCAI-243"));
	assert.deepEqual(ids("FLS-290"), [1, 2, 3, 4]);
});

test("any other faculty sees only its own rooms", () => {
	assert.deepEqual(roomChoices(rooms, "FL-1852").flatMap((s) => s.rooms.map((r) => r.id)), [5]);
	assert.deepEqual(venueFacultyIds("FL-1852"), ["FL-1852"]);
});

test("no faculty chosen offers nothing", () => {
	assert.deepEqual(roomChoices(rooms, null), []);
});
