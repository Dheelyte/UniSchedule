// Realm (programme) helpers: the weekly shape of a timetable comes from the
// active realm's config, never from constants. Kept free of path aliases so
// it can be unit-tested directly with `node --test`.

export const DEFAULT_REALM = "UG";

/** The UG realm's config: the values that used to be hardcoded. */
export const UG_CONFIG = {
	lecture_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
	exam_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
	day_start: "08:00",
	day_end: "18:00",
	slot_minutes: 30,
	exam_slots: [
		{ label: "9am - 12pm", start: "09:00", end: "12:00" },
		{ label: "12pm - 3pm", start: "12:00", end: "15:00" },
		{ label: "3pm - 6pm", start: "15:00", end: "18:00" },
	],
	levels: [100, 200, 300, 400, 500, 600, 700],
	semester_names: ["First Semester", "Second Semester"],
	strict: false,
};

/** Shown on /realms and /login until (or if) GET /realms can't be reached. */
export const FALLBACK_REALMS = [
	{ key: "UG", name: "Undergraduate", is_live: true },
	{ key: "PG", name: "Postgraduate", is_live: false },
	{ key: "ICE", name: "ICE", is_live: false },
	{ key: "FOUNDATION", name: "Foundation", is_live: false },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The signed-in user's realm config (from /auth/me), or UG's. */
export function getRealmConfig(user) {
	return user?.realm_config || UG_CONFIG;
}

function toMinutes(time) {
	const [h, m] = String(time).split(":").map(Number);
	return h * 60 + (m || 0);
}

function toTime(minutes) {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Whole hours from day_start up to and including day_end, e.g. 8..18. */
export function hourRange(config = UG_CONFIG) {
	const start = Math.floor(toMinutes(config.day_start) / 60);
	const end = Math.ceil(toMinutes(config.day_end) / 60);
	return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/** Every selectable "HH:MM" from day_start to day_end, in slot_minutes steps. */
export function timeOptions(config = UG_CONFIG) {
	const end = toMinutes(config.day_end);
	const options = [];
	for (let t = toMinutes(config.day_start); t <= end; t += config.slot_minutes) {
		options.push(toTime(t));
	}
	return options;
}

/** Minutes between day_start and `time` (negative before the day starts). */
export function minutesFromDayStart(time, config = UG_CONFIG) {
	return toMinutes(time) - toMinutes(config.day_start);
}

/** Whether a start–end range leaves the realm's day window. */
export function isOutsideWindow(start, end, config = UG_CONFIG) {
	return toMinutes(start) < toMinutes(config.day_start) || toMinutes(end) > toMinutes(config.day_end);
}

export function isAllowedLectureDay(day, config = UG_CONFIG) {
	return config.lecture_days.includes(day);
}

/**
 * Weekday name of a "YYYY-MM-DD" date. Built from the date's parts in local
 * time: `new Date("YYYY-MM-DD")` is UTC midnight, which is the previous day
 * in timezones behind UTC.
 */
export function weekdayOf(dateStr) {
	const [y, m, d] = String(dateStr || "").slice(0, 10).split("-").map(Number);
	if (!y || !m || !d) return null;
	return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

export function isAllowedExamDate(dateStr, config = UG_CONFIG) {
	const day = weekdayOf(dateStr);
	return day !== null && config.exam_days.includes(day);
}

// ── Portal links ────────────────────────────────────────────────────────────

const LAST_REALM_KEY = "unischedule:lastRealm";

/** The login page of a realm's portal. */
export function loginPath(realmKey) {
	return `/login?realm=${encodeURIComponent(realmKey || DEFAULT_REALM)}`;
}

/** Remember the portal last signed in to, so a 401 returns to its login page. */
export function rememberRealm(realmKey) {
	if (!realmKey) return;
	try {
		globalThis.localStorage?.setItem(LAST_REALM_KEY, realmKey);
	} catch {}
}

export function lastRealm() {
	try {
		return globalThis.localStorage?.getItem(LAST_REALM_KEY) || DEFAULT_REALM;
	} catch {
		return DEFAULT_REALM;
	}
}

/**
 * Split an in-app link such as "/requests?tab=open&realm=ICE" into the realm
 * it belongs to and the path without that parameter.
 */
export function splitRealmLink(link) {
	const url = new URL(link || "/", "http://local");
	const realm = url.searchParams.get("realm");
	url.searchParams.delete("realm");
	return { path: `${url.pathname}${url.search}${url.hash}`, realm: realm || null };
}
