import { test } from "node:test";
import assert from "node:assert/strict";
import {
	UG_CONFIG,
	FALLBACK_REALMS,
	getRealmConfig,
	hourRange,
	timeOptions,
	minutesFromDayStart,
	isOutsideWindow,
	isAllowedLectureDay,
	isAllowedExamDate,
	weekdayOf,
	loginPath,
	lastRealm,
	splitRealmLink,
} from "./realm.js";
import { DAYS, EXAM_DAYS, OPERATING_HOURS, isOutsideOperatingHours } from "./utils.js";

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

test("UG_CONFIG matches today's hardcoded constants", () => {
	assert.deepEqual(UG_CONFIG.lecture_days, DAYS);
	assert.deepEqual(UG_CONFIG.exam_days, EXAM_DAYS);
	assert.equal(UG_CONFIG.day_start, OPERATING_HOURS.start);
	assert.equal(UG_CONFIG.day_end, OPERATING_HOURS.end);
	// TimetableGrid's HOURS (8..18) and its 08:00–18:00 half-hour time list.
	assert.deepEqual(hourRange(UG_CONFIG), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
	const legacyTimes = [];
	for (let h = 8; h <= 18; h++) {
		legacyTimes.push(`${h.toString().padStart(2, "0")}:00`);
		if (h < 18) legacyTimes.push(`${h.toString().padStart(2, "0")}:30`);
	}
	assert.deepEqual(timeOptions(UG_CONFIG), legacyTimes);
	// The courses page's level and semester lists.
	assert.deepEqual(UG_CONFIG.levels, [100, 200, 300, 400, 500, 600, 700]);
	assert.deepEqual(UG_CONFIG.semester_names, ["First Semester", "Second Semester"]);
	assert.equal(UG_CONFIG.strict, false);
});

test("isOutsideWindow agrees with the legacy UG check", () => {
	for (const [start, end] of [["08:00", "10:00"], ["07:30", "09:00"], ["16:00", "18:00"], ["17:00", "18:30"]]) {
		assert.equal(isOutsideWindow(start, end, UG_CONFIG), isOutsideOperatingHours(start, end), `${start}-${end}`);
	}
});

test("getRealmConfig: the user's config, or UG when there is none", () => {
	assert.equal(getRealmConfig({ realm_config: ICE_CONFIG }), ICE_CONFIG);
	assert.equal(getRealmConfig(null), UG_CONFIG);
	assert.equal(getRealmConfig({}), UG_CONFIG);
});

test("ICE: hours, 15-minute time options and positions", () => {
	assert.deepEqual(hourRange(ICE_CONFIG), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
	const times = timeOptions(ICE_CONFIG);
	assert.equal(times[0], "07:00");
	assert.equal(times[1], "07:15");
	assert.equal(times.at(-1), "21:00");
	assert.equal(times.length, 14 * 4 + 1);
	assert.ok(times.includes("19:15"));
	assert.ok(!times.includes("19:10"));
	assert.equal(minutesFromDayStart("19:15", ICE_CONFIG), 735);
	assert.equal(minutesFromDayStart("08:30", UG_CONFIG), 30);
	assert.equal(minutesFromDayStart("06:45", ICE_CONFIG), -15);
	// API times carry seconds.
	assert.equal(minutesFromDayStart("10:00:00", UG_CONFIG), 120);
});

test("isOutsideWindow uses the realm's window", () => {
	assert.equal(isOutsideWindow("19:15", "20:45", ICE_CONFIG), false);
	assert.equal(isOutsideWindow("19:15", "20:45", UG_CONFIG), true);
	assert.equal(isOutsideWindow("06:45", "08:00", ICE_CONFIG), true);
	assert.equal(isOutsideWindow("20:00", "21:15", ICE_CONFIG), true);
	assert.equal(isOutsideWindow("07:00", "21:00", ICE_CONFIG), false);
});

test("lecture days and exam dates follow the config", () => {
	assert.equal(isAllowedLectureDay("Sunday", ICE_CONFIG), true);
	assert.equal(isAllowedLectureDay("Monday", ICE_CONFIG), false);
	assert.equal(isAllowedLectureDay("Monday", UG_CONFIG), true);
	assert.equal(isAllowedLectureDay("Sunday", UG_CONFIG), false);
	// 2026-10-09 is a Friday.
	assert.equal(isAllowedExamDate("2026-10-09", ICE_CONFIG), true);
	assert.equal(isAllowedExamDate("2026-10-11", ICE_CONFIG), true);
	assert.equal(isAllowedExamDate("2026-10-12", ICE_CONFIG), false);
	assert.equal(isAllowedExamDate("2026-10-11", UG_CONFIG), false);
	assert.equal(isAllowedExamDate("", ICE_CONFIG), false);
});

test("weekdayOf reads the date as written, in any timezone", () => {
	const original = process.env.TZ;
	try {
		for (const tz of ["Africa/Lagos", "America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
			process.env.TZ = tz;
			assert.equal(weekdayOf("2026-10-09"), "Friday", tz);
			assert.equal(weekdayOf("2026-10-11"), "Sunday", tz);
			assert.equal(weekdayOf("2026-03-01"), "Sunday", tz);
		}
	} finally {
		if (original === undefined) delete process.env.TZ;
		else process.env.TZ = original;
	}
	assert.equal(weekdayOf("2026-10-10T00:00:00"), "Saturday");
	assert.equal(weekdayOf(""), null);
	assert.equal(weekdayOf(null), null);
});

test("portal links", () => {
	assert.equal(loginPath("ICE"), "/login?realm=ICE");
	assert.equal(loginPath(), "/login?realm=UG");
	// No localStorage under node: falls back to UG instead of throwing.
	assert.equal(lastRealm(), "UG");
	assert.ok(FALLBACK_REALMS.some((r) => r.key === "UG" && r.is_live));
	assert.ok(FALLBACK_REALMS.filter((r) => r.key !== "UG").every((r) => !r.is_live));
});

test("splitRealmLink strips the realm and keeps the rest", () => {
	assert.deepEqual(splitRealmLink("/requests?realm=ICE"), { path: "/requests", realm: "ICE" });
	assert.deepEqual(splitRealmLink("/requests?tab=open&realm=UG"), { path: "/requests?tab=open", realm: "UG" });
	assert.deepEqual(splitRealmLink("/timetable/lectures"), { path: "/timetable/lectures", realm: null });
	assert.deepEqual(splitRealmLink("/a?x=1#top"), { path: "/a?x=1#top", realm: null });
});
