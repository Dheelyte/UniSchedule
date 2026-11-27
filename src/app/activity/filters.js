// The Activity Logs filters: one state shape for the page and the export modal.
// Mirrors backend/modules/audit/filters.py, which uses the same parameter names.
//
//   URL  <->  state  ->  API query (/audit/logs, /audit/export/preview)
//                    ->  chips above the table
//                    ->  the export's Filters sheet and PDF header
//
// The server resolves presets to dates in Lagos time, so nothing here works out
// what "Last 7 days" means; the options endpoint says what each preset covers.
// No path aliases, so `node --test` can import it.
import { categoryLabel, normalizeCategories } from "./categories.js";

export const LAGOS_TZ = "Africa/Lagos";
export const TIMEZONE_NOTE = "All times Africa/Lagos (WAT, UTC+01:00)";

export const PRESETS = [
	{ value: "today", label: "Today" },
	{ value: "yesterday", label: "Yesterday" },
	{ value: "this_week", label: "This week" },
	{ value: "last_7_days", label: "Last 7 days" },
	{ value: "this_month", label: "This month" },
	{ value: "last_30_days", label: "Last 30 days" },
	{ value: "session", label: "Current academic session" },
	{ value: "all", label: "All time" },
	{ value: "custom", label: "Custom range" },
];
const PRESET_VALUES = new Set(PRESETS.map((p) => p.value));

export const TIMETABLE_TYPES = [
	{ value: "all", label: "All timetables" },
	{ value: "lecture", label: "Lecture timetable" },
	{ value: "exam", label: "Exam timetable" },
];

export const PORTAL_SCOPES = [
	{ value: "both", label: "This portal + cross-portal" },
	{ value: "this", label: "This portal only" },
	{ value: "cross", label: "Cross-portal events only" },
];

/** The page opens on the last 30 days; "Clear all" returns here. */
export const DEFAULT_FILTERS = Object.freeze({
	range: "last_30_days",
	from: "",
	to: "",
	time: "",
	type: "all",
	cat: [],
	action: [],
	user: [],
	role: [],
	faculty: "",
	dept: "",
	q: "",
	portal: "both",
});

const LIST_KEYS = ["cat", "action", "user", "role"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_WINDOW = /^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$/;
const ACTION_CODE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

function splitList(values) {
	const out = [];
	for (const value of values) {
		for (const part of String(value).split(",")) {
			const item = part.trim();
			if (item && !out.includes(item)) out.push(item);
		}
	}
	return out;
}

/** "8:00-17:00" -> "08:00-17:00"; anything else -> "". Equal times are refused. */
export function normalizeTimeWindow(text) {
	const m = TIME_WINDOW.exec(text || "");
	if (!m) return "";
	const [h1, m1, h2, m2] = m.slice(1).map(Number);
	if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return "";
	const pad = (n) => String(n).padStart(2, "0");
	const start = `${pad(h1)}:${pad(m1)}`;
	const end = `${pad(h2)}:${pad(m2)}`;
	return start === end ? "" : `${start}-${end}`;
}

/** Whether a time window runs past midnight ("22:00-06:00"). */
export function crossesMidnight(window) {
	const [start, end] = (window || "").split("-");
	return Boolean(start && end && start > end);
}

/** State from a query string, URLSearchParams or plain object. Bad values fall back to the defaults. */
export function parseFilters(input) {
	const params = input instanceof URLSearchParams ? input : new URLSearchParams(input || "");
	const one = (key) => (params.get(key) || "").trim();
	const state = { ...DEFAULT_FILTERS };

	const range = one("range");
	if (PRESET_VALUES.has(range)) state.range = range;
	if (state.range === "custom") {
		const from = one("from");
		const to = one("to");
		if (DATE.test(from) && DATE.test(to)) {
			state.from = from <= to ? from : to;
			state.to = from <= to ? to : from;
			state.time = normalizeTimeWindow(one("time"));
		} else {
			state.range = DEFAULT_FILTERS.range;
		}
	}
	const type = one("type");
	if (TIMETABLE_TYPES.some((t) => t.value === type)) state.type = type;
	const portal = one("portal");
	if (PORTAL_SCOPES.some((p) => p.value === portal)) state.portal = portal;

	state.cat = normalizeCategories(splitList(params.getAll("cat")));
	state.action = splitList(params.getAll("action")).filter((a) => ACTION_CODE.test(a));
	state.user = splitList(params.getAll("user")).map((u) => u.toLowerCase());
	state.role = splitList(params.getAll("role")).filter((r) => /^[A-Z_]+$/.test(r));
	const faculty = one("faculty");
	state.faculty = /^[\w-]{1,64}$/.test(faculty) ? faculty : "";
	const dept = one("dept");
	state.dept = /^\d{1,9}$/.test(dept) ? dept : "";
	state.q = one("q").slice(0, 200);
	return state;
}

function setAll(params, state, { includeRange }) {
	if (includeRange || state.range !== DEFAULT_FILTERS.range) params.set("range", state.range);
	if (state.range === "custom") {
		if (state.from) params.set("from", state.from);
		if (state.to) params.set("to", state.to);
		if (state.time) params.set("time", state.time);
	}
	if (state.type !== "all") params.set("type", state.type);
	for (const key of LIST_KEYS) {
		const values = key === "cat" ? normalizeCategories(state.cat) : state[key] || [];
		if (values.length) params.set(key, values.join(","));
	}
	if (state.faculty) params.set("faculty", state.faculty);
	if (state.dept) params.set("dept", String(state.dept));
	if (state.q) params.set("q", state.q);
	if (state.portal !== "both") params.set("portal", state.portal);
	return params;
}

/** The page's URL query: defaults left out, so a plain /activity is the default view. */
export function toSearchParams(state) {
	return setAll(new URLSearchParams(), state, { includeRange: false });
}

/** The API query. Always names the range: the API's own default is "all". */
export function toApiParams(state) {
	return setAll(new URLSearchParams(), state, { includeRange: true });
}

/** The filters as the export request's JSON (the same names as the query). */
export function toExportFilters(state) {
	const out = {};
	for (const [key, value] of toApiParams(state)) out[key] = LIST_KEYS.includes(key) ? value.split(",") : value;
	return out;
}

export function isDefault(state) {
	return toSearchParams(state).toString() === "";
}

// ---------- Labels ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-01" -> "1 Mar 2026", with no time zone involved. */
export function formatDay(iso) {
	if (!DATE.test(iso || "")) return iso || "";
	const [y, m, d] = iso.split("-").map(Number);
	return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function presetLabel(value) {
	return PRESETS.find((p) => p.value === value)?.label ?? value;
}

/** "08:00–17:00", or "22:00–06:00 (overnight)" when it runs past midnight. */
export function timeWindowLabel(window) {
	if (!window) return "";
	const text = window.replace("-", "–");
	return crossesMidnight(window) ? `${text} (overnight)` : text;
}

/** The timeframe in words; with the options, a preset also shows the days it covers. */
export function rangeLabel(state, options) {
	if (state.range === "custom") {
		const days = state.from === state.to ? formatDay(state.from) : `${formatDay(state.from)} – ${formatDay(state.to)}`;
		return state.time ? `${days}, ${timeWindowLabel(state.time)}` : days;
	}
	const covered = options?.presets?.[state.range];
	if (covered) {
		const days = covered.start === covered.end ? formatDay(covered.start) : `${formatDay(covered.start)} – ${formatDay(covered.end)}`;
		return `${presetLabel(state.range)} (${days})`;
	}
	return presetLabel(state.range);
}

const named = (list, id, key = "id") => list?.find((item) => String(item[key]) === String(id))?.name;

/**
 * The active filters as removable chips: [{ id, label, next }] where `next` is
 * the state without that filter. Defaults make no chip.
 */
export function filterChips(state, { options, roleLabels = {} } = {}) {
	const chips = [];
	const without = (patch) => ({ ...state, ...patch });
	if (state.range !== DEFAULT_FILTERS.range) {
		chips.push({ id: "range", label: rangeLabel(state, options), next: without({ range: DEFAULT_FILTERS.range, from: "", to: "", time: "" }) });
	}
	if (state.type !== "all") {
		chips.push({ id: "type", label: TIMETABLE_TYPES.find((t) => t.value === state.type).label, next: without({ type: "all" }) });
	}
	for (const key of normalizeCategories(state.cat)) {
		const label = key === "schedule_item" ? "Schedule items (all), incl. Lecture and Exam" : categoryLabel(key);
		chips.push({ id: `cat:${key}`, label: `Category: ${label}`, next: without({ cat: state.cat.filter((c) => c !== key) }) });
	}
	for (const code of state.action) {
		chips.push({ id: `action:${code}`, label: `Action: ${code}`, next: without({ action: state.action.filter((a) => a !== code) }) });
	}
	for (const email of state.user) {
		chips.push({ id: `user:${email}`, label: `User: ${email}`, next: without({ user: state.user.filter((u) => u !== email) }) });
	}
	for (const role of state.role) {
		chips.push({ id: `role:${role}`, label: `Role: ${roleLabels[role] || role}`, next: without({ role: state.role.filter((r) => r !== role) }) });
	}
	if (state.faculty) {
		chips.push({ id: "faculty", label: `Faculty: ${named(options?.faculties, state.faculty) || state.faculty}`, next: without({ faculty: "", dept: "" }) });
	}
	if (state.dept) {
		chips.push({ id: "dept", label: `Department: ${named(options?.departments, state.dept) || state.dept}`, next: without({ dept: "" }) });
	}
	if (state.q) chips.push({ id: "q", label: `Keyword: “${state.q}”`, next: without({ q: "" }) });
	if (state.portal !== "both") {
		chips.push({ id: "portal", label: PORTAL_SCOPES.find((p) => p.value === state.portal).label, next: without({ portal: "both" }) });
	}
	return chips;
}

/**
 * Every filter in words, for the export's Filters sheet and PDF header,
 * including the ones left at "all".
 */
export function describeFilters(state, { options, roleLabels = {} } = {}) {
	const list = (values, fallback, fmt = (v) => v) => (values.length ? values.map(fmt).join(", ") : fallback);
	return [
		["Timeframe", rangeLabel(state, options)],
		["Time of day", state.time ? timeWindowLabel(state.time) : "Any time"],
		["Timetable type", TIMETABLE_TYPES.find((t) => t.value === state.type).label],
		["Categories", list(normalizeCategories(state.cat), "All categories", (k) => (k === "schedule_item" ? "Schedule items (all, incl. Lecture and Exam)" : categoryLabel(k)))],
		["Specific actions", list(state.action, "All actions in those categories")],
		["Users", list(state.user, "All users")],
		["Roles (as acted)", list(state.role, "All roles", (r) => roleLabels[r] || r)],
		["Faculty", state.faculty ? named(options?.faculties, state.faculty) || state.faculty : "All faculties"],
		["Department", state.dept ? named(options?.departments, state.dept) || state.dept : "All departments"],
		["Keyword", state.q ? `“${state.q}”` : "None"],
		["Portal", PORTAL_SCOPES.find((p) => p.value === state.portal).label],
	];
}

// ---------- The export's range ----------

export const SHORTENED_NOTE = "“All time” was shortened to the last 12 months, the most one export can cover.";

/**
 * The filters an export modal opens with: the page's, except that "All time"
 * becomes the last 12 months (exports are capped), with a note saying so.
 */
export function exportStartFilters(state, options) {
	if (state.range !== "all") return { filters: { ...state }, note: null };
	const range = options?.last_12_months;
	if (!range) return { filters: { ...state, range: "last_30_days" }, note: SHORTENED_NOTE };
	return { filters: { ...state, range: "custom", from: range.start, to: range.end, time: "" }, note: SHORTENED_NOTE };
}

// ---------- Lagos time ----------

let lagosFormat;

/** An instant as Lagos wall-clock time: "26 Nov 2026, 14:05:03". */
export function formatLagos(iso) {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return String(iso);
	lagosFormat ??= new Intl.DateTimeFormat("en-GB", {
		timeZone: LAGOS_TZ,
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	return lagosFormat.format(date);
}

/** "2026-11-26T14:05:03+01:00" (as the export API sends) -> "2026-11-26 14:05". */
export function lagosStamp(iso) {
	if (!iso) return "";
	const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
	return m ? `${m[1]} ${m[2]}` : String(iso);
}
