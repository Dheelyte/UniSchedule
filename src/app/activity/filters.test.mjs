import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryOf, includedBy, inCategories, normalizeCategories } from "./categories.js";
import {
	DEFAULT_FILTERS,
	SHORTENED_NOTE,
	crossesMidnight,
	describeFilters,
	exportStartFilters,
	filterChips,
	formatDay,
	formatLagos,
	isDefault,
	lagosStamp,
	normalizeTimeWindow,
	parseFilters,
	timeWindowLabel,
	toApiParams,
	toExportFilters,
	toSearchParams,
} from "./filters.js";

const OPTIONS = {
	presets: { last_7_days: { start: "2026-11-20", end: "2026-11-26" }, today: { start: "2026-11-26", end: "2026-11-26" } },
	last_12_months: { start: "2025-11-27", end: "2026-11-26" },
	faculties: [{ id: "SCI", name: "Faculty of Science" }],
	departments: [{ id: 3, name: "Physics", faculty_id: "SCI" }],
};

test("URL filters round-trip", () => {
	const query =
		"range=custom&from=2026-03-01&to=2026-03-31&time=22%3A00-06%3A00&type=exam&cat=auth%2Cschedule_item" +
		"&action=auth.login&user=ada%40x.com&role=HOD&faculty=SCI&dept=3&q=PHY&portal=this";
	const state = parseFilters(query);
	assert.deepEqual(state, {
		range: "custom",
		from: "2026-03-01",
		to: "2026-03-31",
		time: "22:00-06:00",
		type: "exam",
		cat: ["schedule_item", "auth"],
		action: ["auth.login"],
		user: ["ada@x.com"],
		role: ["HOD"],
		faculty: "SCI",
		dept: "3",
		q: "PHY",
		portal: "this",
	});
	assert.deepEqual(parseFilters(toSearchParams(state).toString()), state);
	// Repeated parameters read the same as comma-separated ones.
	assert.deepEqual(parseFilters("cat=auth&cat=course").cat, ["course", "auth"]);
});

test("defaults stay out of the URL but the API always gets the range", () => {
	assert.equal(toSearchParams(DEFAULT_FILTERS).toString(), "");
	assert.equal(toApiParams(DEFAULT_FILTERS).toString(), "range=last_30_days");
	assert.ok(isDefault(parseFilters("")));
	assert.equal(toSearchParams(parseFilters("range=all")).toString(), "range=all");
	assert.ok(!isDefault(parseFilters("range=all")));
	assert.deepEqual(toExportFilters(parseFilters("range=today&cat=auth,course&user=a@x.com")), {
		range: "today",
		cat: ["course", "auth"],
		user: ["a@x.com"],
	});
});

test("bad values fall back to the defaults", () => {
	const state = parseFilters("range=forever&type=both&portal=ICE&dept=abc&faculty=%3Cx%3E&action=DROP%20TABLE&time=08:00-17:00");
	assert.deepEqual(state, { ...DEFAULT_FILTERS });
	// A custom range needs both dates; dates the wrong way round are swapped.
	assert.equal(parseFilters("range=custom&from=2026-03-01").range, "last_30_days");
	assert.deepEqual(
		[parseFilters("range=custom&from=2026-03-31&to=2026-03-01").from, parseFilters("range=custom&from=2026-03-31&to=2026-03-01").to],
		["2026-03-01", "2026-03-31"],
	);
	// A time of day only applies to a custom range.
	assert.equal(parseFilters("range=today&time=08:00-17:00").time, "");
	assert.equal(toApiParams(parseFilters("range=today&time=08:00-17:00")).get("time"), null);
});

test("time windows, including ones that cross midnight", () => {
	assert.equal(normalizeTimeWindow("8:00 – 17:30"), "08:00-17:30");
	assert.equal(normalizeTimeWindow("08:00-08:00"), "");
	assert.equal(normalizeTimeWindow("24:00-01:00"), "");
	assert.ok(crossesMidnight("22:00-06:00") && !crossesMidnight("08:00-17:00"));
	assert.equal(timeWindowLabel("22:00-06:00"), "22:00–06:00 (overnight)");
	assert.equal(timeWindowLabel("08:00-17:00"), "08:00–17:00");
});

test("categories: a parent replaces its children and nothing counts twice", () => {
	assert.deepEqual(normalizeCategories(["schedule_item.exam", "schedule_item", "nope", "auth"]), ["schedule_item", "auth"]);
	assert.deepEqual(includedBy(["schedule_item"]), ["schedule_item.lecture", "schedule_item.exam"]);
	assert.equal(categoryOf("schedule_item.exam.create").key, "schedule_item.exam");
	assert.equal(categoryOf("conflict.dismiss.bulk").key, "conflict");
	assert.equal(categoryOf("mystery.thing").key, "other");
	assert.ok(inCategories("schedule_item.exam.create", ["schedule_item"]));
	assert.ok(!inCategories("course.create", ["auth"]));
	assert.ok(inCategories("course.create", []));
});

test("chips: one per active filter, each removable, with readable labels", () => {
	const state = parseFilters("range=custom&from=2026-03-01&to=2026-03-31&time=22:00-06:00&type=exam&cat=schedule_item&user=a@x.com&role=HOD&faculty=SCI&dept=3&q=PHY&portal=cross");
	const chips = filterChips(state, { options: OPTIONS, roleLabels: { HOD: "Faculty Viewer (HOD)" } });
	assert.deepEqual(chips.map((c) => c.label), [
		"1 Mar 2026 – 31 Mar 2026, 22:00–06:00 (overnight)",
		"Exam timetable",
		"Category: Schedule items (all), incl. Lecture and Exam",
		"User: a@x.com",
		"Role: Faculty Viewer (HOD)",
		"Faculty: Faculty of Science",
		"Department: Physics",
		"Keyword: “PHY”",
		"Cross-portal events only",
	]);
	// Removing the range chip returns to the default timeframe; removing a faculty clears its department.
	assert.equal(chips[0].next.range, "last_30_days");
	assert.equal(chips[0].next.time, "");
	const faculty = chips.find((c) => c.id === "faculty");
	assert.deepEqual([faculty.next.faculty, faculty.next.dept], ["", ""]);
	assert.deepEqual(filterChips(DEFAULT_FILTERS), []);
	assert.equal(filterChips(parseFilters("range=last_7_days"), { options: OPTIONS })[0].label, "Last 7 days (20 Nov 2026 – 26 Nov 2026)");
});

test("the export lists every filter, including those left at all", () => {
	const rows = describeFilters(parseFilters("range=custom&from=2026-03-01&to=2026-03-01&time=08:00-17:00&type=lecture"), { options: OPTIONS });
	const map = Object.fromEntries(rows);
	assert.equal(map.Timeframe, "1 Mar 2026, 08:00–17:00");
	assert.equal(map["Time of day"], "08:00–17:00");
	assert.equal(map["Timetable type"], "Lecture timetable");
	assert.equal(map.Categories, "All categories");
	assert.equal(map.Portal, "This portal + cross-portal");
	assert.equal(rows.length, 11);
});

test("an export opened from All time covers the last 12 months, with a note", () => {
	const { filters, note } = exportStartFilters(parseFilters("range=all&cat=auth"), OPTIONS);
	assert.deepEqual([filters.range, filters.from, filters.to, filters.cat], ["custom", "2025-11-27", "2026-11-26", ["auth"]]);
	assert.equal(note, SHORTENED_NOTE);
	const unchanged = exportStartFilters(parseFilters("range=today"), OPTIONS);
	assert.deepEqual([unchanged.filters.range, unchanged.note], ["today", null]);
});

test("times show in Lagos, whatever the computer's time zone", () => {
	// 23:30 UTC is 00:30 the next day in Lagos.
	assert.equal(formatLagos("2026-11-25T23:30:00Z"), "26 Nov 2026, 00:30:00");
	assert.equal(formatLagos("2026-11-26T13:05:03.123456+00:00"), "26 Nov 2026, 14:05:03");
	assert.equal(lagosStamp("2026-11-26T14:05:03+01:00"), "2026-11-26 14:05");
	assert.equal(formatDay("2026-03-01"), "1 Mar 2026");
});
