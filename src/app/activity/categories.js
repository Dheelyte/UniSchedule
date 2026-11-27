// The action categories of the Activity Logs page and its export. Mirrors
// backend/modules/audit/categories.py.
//
// A category is an action-code prefix. "Schedule items (all)" contains "Lecture
// timetable" and "Exam timetable": choosing it replaces them (they show as
// ticked, locked and "included"), and each action counts under one category
// only, the one with the longest matching prefix, so nothing is counted twice.
//
// No path aliases, so `node --test` can import it.

export const CATEGORIES = [
	{ key: "course", label: "Courses", prefix: "course." },
	{ key: "schedule_item", label: "Schedule items (all)", prefix: "schedule_item." },
	{ key: "schedule_item.lecture", label: "Lecture timetable", prefix: "schedule_item.lecture.", parent: "schedule_item" },
	{ key: "schedule_item.exam", label: "Exam timetable", prefix: "schedule_item.exam.", parent: "schedule_item" },
	{ key: "timetable", label: "Timetable locks / requests", prefix: "timetable." },
	{ key: "change_request", label: "Change requests", prefix: "change_request." },
	{ key: "blocked_slot", label: "Blocked slots", prefix: "blocked_slot." },
	{ key: "calendar", label: "Academic sessions", prefix: "calendar." },
	{ key: "faculty", label: "Faculties", prefix: "faculty." },
	{ key: "department", label: "Departments", prefix: "department." },
	{ key: "room", label: "Rooms", prefix: "room." },
	{ key: "user", label: "Users / invitations", prefix: "user." },
	{ key: "editor_access", label: "Editor access handovers", prefix: "editor_access." },
	{ key: "auth", label: "Auth", prefix: "auth." },
	{ key: "conflict", label: "Conflicts", prefix: "conflict." },
	{ key: "realm", label: "Portal settings", prefix: "realm." },
	{ key: "activity_log", label: "Exports", prefix: "activity_log." },
];

export const OTHER = { key: "other", label: "Other", prefix: "" };

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));
const BY_SPECIFICITY = [...CATEGORIES].sort((a, b) => b.prefix.length - a.prefix.length);

export const isCategory = (key) => BY_KEY.has(key);

export function categoryLabel(key) {
	return BY_KEY.get(key)?.label ?? OTHER.label;
}

/** The chosen keys in display order, a parent replacing its children; unknown keys dropped. */
export function normalizeCategories(keys) {
	const chosen = new Set((keys || []).filter(isCategory));
	return CATEGORIES.filter((c) => chosen.has(c.key) && !(c.parent && chosen.has(c.parent))).map((c) => c.key);
}

/** The one category an action is counted under. */
export function categoryOf(action) {
	return BY_SPECIFICITY.find((c) => String(action || "").startsWith(c.prefix)) ?? OTHER;
}

/** The children a chosen parent includes (shown ticked and locked). */
export function includedBy(chosen) {
	const set = new Set(chosen || []);
	return CATEGORIES.filter((c) => c.parent && set.has(c.parent)).map((c) => c.key);
}

/** Whether an action code falls inside the chosen categories (none chosen: every action). */
export function inCategories(action, chosen) {
	const keys = normalizeCategories(chosen);
	if (keys.length === 0) return true;
	return keys.some((key) => String(action).startsWith(BY_KEY.get(key).prefix));
}
