import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { flattenDetails, DETAILS_COLUMN, OTHER_COLUMN } from "./flatten.js";
import { maskDeep, maskEmail, maskText } from "./mask.js";
import { parseFilters } from "./filters.js";
import { buildReport, rawWriter, writeSheet } from "./report.js";
import { buildExportFile, needsBackground, requestExport } from "./exportRunner.js";
import { columnName, concatChunks, createWorkbook, escapeFormula } from "./xlsx.js";
import { buildPdfReport } from "./pdfReport.js";

// ---------- A stand-in API with answers shaped like the backend's ----------

const FILTERS = parseFilters("range=custom&from=2026-03-01&to=2026-03-31&time=22:00-06:00&type=exam&cat=schedule_item");

function startedFor(format, overrides = {}) {
	return {
		token: "tok",
		first: "2026-03-01",
		last: "2026-03-31",
		clamped: false,
		events: 3,
		members: 2,
		invitations: 1,
		file_name: `unischedule-activity-analysis_2026-03-01_2026-03-31.${format}`,
		format,
		sections: ["summary", "categories", "users", "roles_portals", "over_time", "impersonation", "sensitive", "change_requests", "members", "raw"],
		generated_by: "boss@unilag.edu.ng",
		generated_at: "2026-11-26T14:05:03+01:00",
		timezone: "Africa/Lagos",
		portal_key: "UG",
		portal_name: "Undergraduate",
		first_entry_at: "2025-09-01T08:00:00+01:00",
		...overrides,
	};
}

const ANALYSIS = {
	summary: {
		total_events: 3, unique_users: 2, first_event_at: "2026-03-02T09:00:00+01:00", last_event_at: "2026-03-03T23:30:00+01:00",
		days: 31, events_per_day: 0.1, busiest_day: { date: "2026-03-02", count: 2 }, busiest_hour: { hour: 9, count: 2 },
		most_common_action: { action: "schedule_item.exam.create", count: 2 }, impersonated_events: 1, cross_portal_events: 0,
	},
	categories: {
		total: 3,
		categories: [{ key: "schedule_item.exam", label: "Exam timetable", count: 3, pct: 100, actions: [{ action: "schedule_item.exam.create", count: 2, pct: 66.7 }, { action: "schedule_item.exam.delete", count: 1, pct: 33.3 }] }],
	},
	users: {
		total: 3,
		users: [
			{ email: "ada@unilag.edu.ng", deleted: false, roles: ["FACULTY_EDITOR"], count: 2, pct: 66.7, impersonated: 0, top_actions: [{ action: "schedule_item.exam.create", count: 2 }], last_active_at: "2026-03-02T10:00:00+01:00" },
			{ email: "boss@unilag.edu.ng", deleted: false, roles: ["HOD"], count: 1, pct: 33.3, impersonated: 1, top_actions: [{ action: "schedule_item.exam.delete", count: 1 }], last_active_at: "2026-03-03T23:30:00+01:00" },
		],
	},
	roles_portals: {
		total: 3,
		roles: [{ role: "FACULTY_EDITOR", count: 2, pct: 66.7 }, { role: "HOD", count: 1, pct: 33.3 }],
		portals: [{ scope: "this", count: 3, pct: 100 }],
		switches: [{ email: "boss@unilag.edu.ng", count: 2, to: { ICE: 1, UG: 1 } }],
	},
	over_time: {
		granularity: "day",
		categories: ["schedule_item.exam"],
		buckets: Array.from({ length: 31 }, (_, i) => ({ start: `2026-03-${String(i + 1).padStart(2, "0")}`, total: i === 1 ? 2 : i === 2 ? 1 : 0, by_category: i === 1 ? { "schedule_item.exam": 2 } : i === 2 ? { "schedule_item.exam": 1 } : {} })),
		heatmap: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 0 && h === 9 ? 2 : d === 1 && h === 23 ? 1 : 0))),
	},
	impersonation: {
		total: 1, flagged: 1,
		sessions: [{ admin_email: "boss@unilag.edu.ng", acting_role: "HOD", acting_faculty_id: "SCI", started_at: "2026-03-03T23:00:00+01:00", ended_at: null, ended_by: null, duration_minutes: null, flagged: true, flag: "No stop recorded", action_count: 1, actions: [{ action: "schedule_item.exam.delete", count: 1 }] }],
	},
	sensitive: {
		total: 1, shown: 1,
		by_action: [{ action: "schedule_item.exam.delete", count: 1 }],
		entries: [{ id: 3, created_at: "2026-03-03T23:30:00+01:00", user_email: "boss@unilag.edu.ng", user_role: "HOD", real_role: "SUPER_ADMIN", impersonating: true, action: "schedule_item.exam.delete", description: "boss@unilag.edu.ng deleted PHY101 exam", entity_type: "schedule_item", entity_id: "9", extra: null }],
	},
	change_requests: { created: 2, approved: 1, rejected: 0, still_pending: 1, decisions_timed: 1, median_hours: 2, mean_hours: 2, by_outcome: [{ outcome: "Approved", timed: 1, median_hours: 2 }] },
	members: {
		rows: [
			{ kind: "member", email: "ada@unilag.edu.ng", role: "FACULTY_EDITOR", faculty_id: "SCI", faculty: "Faculty of Science", invited_at: "2025-09-02T10:00:00+01:00", invited_at_recorded: true, invited_by: "boss@unilag.edu.ng", onboarded_at: "2025-09-03T10:00:00+01:00", last_login_at: "2026-03-02T08:00:00+01:00", last_login_via: "Sign-in", days_since_last_login: 269, sign_ins_in_period: 1, switches_in_period: 0, total_activities: 2, by_category: { "schedule_item.exam": 2 }, top_actions: [{ action: "schedule_item.exam.create", count: 2 }], last_activity_at: "2026-03-02T10:00:00+01:00", portals_used: ["UG"], flags: ["Inactive 90+ days"] },
			{ kind: "member", email: "never@unilag.edu.ng", role: "DEO", faculty_id: null, faculty: null, invited_at: null, invited_at_recorded: false, invited_by: null, onboarded_at: "2025-10-01T10:00:00+01:00", last_login_at: null, last_login_via: null, days_since_last_login: null, sign_ins_in_period: 0, switches_in_period: 0, total_activities: 0, by_category: {}, top_actions: [], last_activity_at: null, portals_used: ["UG"], flags: ["Never logged in"] },
			{ kind: "invitation", email: "pending@unilag.edu.ng", role: "HOD", faculty_id: "SCI", faculty: "Faculty of Science", invited_at: "2026-11-24T10:00:00+01:00", invited_at_recorded: true, invited_by: "boss@unilag.edu.ng", onboarded_at: null, last_login_at: null, last_login_via: null, days_since_last_login: null, sign_ins_in_period: 0, switches_in_period: 0, total_activities: 0, by_category: {}, top_actions: [], last_activity_at: null, portals_used: [], flags: ["Pending invitation"], invitation_status: "Pending", invitation_age_days: 2, expires_at: "2026-12-01T10:00:00+01:00" },
		],
		overview: { members: 2, by_role: [["DEO", 1], ["FACULTY_EDITOR", 1]], by_faculty: [["Faculty of Science", 1], ["No faculty", 1]], active_30_days: 0, inactive: 1, never_logged_in: 1, pending_invitations: 1, expired_invitations: 0, invitations: [{ email: "pending@unilag.edu.ng", role: "HOD", status: "Pending", invited_at: "2026-11-24T10:00:00+01:00", age_days: 2 }] },
		notes: ["Logins are recorded but logouts aren't, so last login is the only login measure and session lengths aren't shown.", "Names and departments aren't recorded for accounts yet."],
	},
	detail_keys: ["course_id", "impersonation.real_role", "note"],
};

const ROWS = [
	{ id: 1, created_at: "2026-03-02T09:00:00+01:00", user_email: "ada@unilag.edu.ng", user_role: "FACULTY_EDITOR", real_role: "FACULTY_EDITOR", impersonating: false, user_faculty_id: "SCI", portal: "UG", action: "schedule_item.exam.create", category: "schedule_item.exam", timetable_type: "exam", entity_type: "schedule_item", entity_id: "7", description: "=HYPERLINK(\"http://evil\",\"x\")", extra: { course_id: 4 } },
	{ id: 2, created_at: "2026-03-02T10:00:00+01:00", user_email: "ada@unilag.edu.ng", user_role: "FACULTY_EDITOR", real_role: "FACULTY_EDITOR", impersonating: false, user_faculty_id: "SCI", portal: "UG", action: "schedule_item.exam.create", category: "schedule_item.exam", timetable_type: "exam", entity_type: "schedule_item", entity_id: "8", description: "Added exam for ada@unilag.edu.ng", extra: "legacy text from an older version" },
	{ id: 3, created_at: "2026-03-03T23:30:00+01:00", user_email: "boss@unilag.edu.ng", user_role: "HOD", real_role: "SUPER_ADMIN", impersonating: true, user_faculty_id: "SCI", portal: "UG", action: "schedule_item.exam.delete", category: "schedule_item.exam", timetable_type: "exam", entity_type: "schedule_item", entity_id: "9", description: "@SUM(1)", extra: { impersonation: { real_role: "SUPER_ADMIN", acting_as_role: "HOD" }, note: "-1+1" } },
];

function fakeApi({ rows = ROWS, analysis = ANALYSIS, pageSize } = {}) {
	const calls = [];
	return {
		calls,
		async post(path, body) {
			calls.push({ method: "POST", path, body });
			return startedFor(body.format, { sections: body.format === "xlsx" && !body.sections.includes("raw") ? [...body.sections, "raw"] : body.sections });
		},
		async get(path, headers) {
			calls.push({ method: "GET", path, headers });
			assert.equal(headers["X-Export-Token"], "tok");
			if (path === "/audit/export/analysis") return analysis;
			const url = new URL(path, "http://x");
			const limit = Number(url.searchParams.get("limit"));
			const after = Number(url.searchParams.get("after") || 0);
			const size = Math.min(limit, pageSize ?? limit);
			const page = rows.slice(after, after + size);
			const next = after + size < rows.length && page.length === size ? String(after + size) : null;
			return { rows: page, next };
		},
	};
}

function sheetsOf(file) {
	const files = unzipSync(concatChunks(file.chunks));
	const workbook = strFromU8(files["xl/workbook.xml"]);
	const names = [...workbook.matchAll(/<sheet name="([^"]+)" sheetId="(\d+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
	const xml = Object.fromEntries(names.map((name, i) => [name, strFromU8(files[`xl/worksheets/sheet${i + 1}.xml`])]));
	return { names, xml, files };
}

const cellsOf = (xml) => [...xml.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => m[1]);

// ---------- Small pieces ----------

test("masking every email, wherever it is", () => {
	assert.equal(maskEmail("wisdom@unilag.edu.ng"), "w***m@unilag.edu.ng");
	assert.equal(maskEmail("ab@x.com"), "a***@x.com");
	assert.equal(maskText("Invited ada@x.com and BOB.smith@unilag.edu.ng"), "Invited a***a@x.com and B***h@unilag.edu.ng");
	assert.deepEqual(maskDeep({ inviter: "ada@x.com", nested: [{ email: "zed@x.com" }], n: 4 }), { inviter: "a***a@x.com", nested: [{ email: "z***d@x.com" }], n: 4 });
});

test("details flatten into the server's columns; older shapes go to one column", () => {
	const keys = ["after.title", "after.units", "before", "course_id", "ids"];
	assert.deepEqual(flattenDetails({ course_id: 4, after: { title: "Physics", units: { min: 2 } }, before: {}, ids: [1, 2] }, keys), {
		course_id: 4,
		"after.title": "Physics",
		"after.units": '{"min":2}',
		before: "{}",
		ids: "[1,2]",
	});
	assert.deepEqual(flattenDetails("legacy text", keys), { [DETAILS_COLUMN]: "legacy text" });
	assert.deepEqual(flattenDetails([1, 2], keys), { [DETAILS_COLUMN]: "[1,2]" });
	assert.deepEqual(flattenDetails(null, keys), {});
	// A key past the column limit isn't lost.
	assert.deepEqual(flattenDetails({ course_id: 1, surprise: { a: 1 } }, keys), { course_id: 1, [OTHER_COLUMN]: '{"surprise.a":1}' });
});

test("formula escaping and column names", () => {
	for (const risky of ["=1+1", "+1", "-1", "@SUM(1)", "\tx", "\rx"]) assert.equal(escapeFormula(risky), `'${risky}`);
	assert.equal(escapeFormula("plain"), "plain");
	assert.deepEqual([0, 25, 26, 701, 702].map(columnName), ["A", "Z", "AA", "ZZ", "AAA"]);
	assert.ok(needsBackground({ format: "xlsx", events: 50001 }));
	assert.ok(!needsBackground({ format: "xlsx", events: 50000 }));
	assert.ok(!needsBackground({ format: "pdf", events: 900000 }));
});

test("the request carries the filters under the page's names", async () => {
	const api = fakeApi();
	await requestExport(api, { filters: FILTERS, format: "pdf", sections: ["summary"], mask: true });
	assert.deepEqual(api.calls[0].body, {
		filters: { range: "custom", from: "2026-03-01", to: "2026-03-31", time: "22:00-06:00", type: "exam", cat: ["schedule_item"] },
		format: "pdf",
		sections: ["summary"],
		mask_emails: true,
	});
});

// ---------- The workbook ----------

test("XLSX: a sheet per section, Members, Raw data and Filters; never a formula", async () => {
	const api = fakeApi({ pageSize: 2 });
	const progress = [];
	const file = await buildExportFile(api, {
		started: startedFor("xlsx"),
		filters: FILTERS,
		options: null,
		roleLabels: { HOD: "Faculty Viewer (HOD)" },
		onProgress: (done, total) => progress.push([done, total]),
	});
	assert.equal(file.fileName, "unischedule-activity-analysis_2026-03-01_2026-03-31.xlsx");
	const { names, xml } = sheetsOf(file);
	assert.deepEqual(names, [
		"Summary", "By category & action", "By user", "By role & portal", "Over time", "Impersonation",
		"Sensitive actions", "Change requests", "Members overview", "Members", "Raw data", "Filters",
	]);
	// Raw data came in pages and was written as it arrived.
	assert.equal(api.calls.filter((c) => c.path.startsWith("/audit/export/rows")).length, 2);
	assert.deepEqual(progress, [[2, 3], [3, 3]]);

	const all = Object.values(xml).join("");
	assert.ok(!all.includes("<f>") && !all.includes("<f "), "no formulas anywhere");
	const raw = cellsOf(xml["Raw data"]);
	assert.ok(raw.includes(`'=HYPERLINK(&quot;http://evil&quot;,&quot;x&quot;)`));
	assert.ok(raw.includes("'@SUM(1)") && raw.includes("'-1+1"));
	// Detail columns from the server, then the older shape in "details".
	assert.ok(raw.includes("course_id") && raw.includes("impersonation.real_role") && raw.includes("details"));
	assert.ok(raw.includes("legacy text from an older version"));
	assert.ok(raw.includes("Yes"), "impersonated rows say so");

	const members = cellsOf(xml.Members);
	for (const hidden of ["Name", "Department", "Status"]) assert.ok(!members.includes(hidden), `${hidden} column is hidden`);
	for (const col of ["Last login via", "Sign-ins in period", "Portal switches in period", "Flags", "Never logged in", "Pending invitation", "Exam timetable"]) {
		assert.ok(members.includes(col), col);
	}
	const overview = cellsOf(xml["Members overview"]);
	assert.ok(overview.some((c) => c.includes("logouts aren&apos;t") || c.includes("logouts aren't")));
	assert.ok(overview.some((c) => c.includes("Names and departments")));

	const filters = cellsOf(xml.Filters);
	for (const expected of ["Timetable type", "Exam timetable", "Time of day", "22:00–06:00 (overnight)", "All times Africa/Lagos (WAT, UTC+01:00)", "boss@unilag.edu.ng", "2026-11-26 14:05 (Lagos)"]) {
		assert.ok(filters.includes(expected), expected);
	}
	assert.ok(cellsOf(xml.Impersonation).includes("No stop recorded"));
});

test("XLSX: Mask emails leaves no address anywhere in the file", async () => {
	const file = await buildExportFile(fakeApi(), { started: startedFor("xlsx"), filters: FILTERS, mask: true });
	const { xml } = sheetsOf(file);
	const all = Object.values(xml).join("");
	for (const email of ["ada@unilag.edu.ng", "boss@unilag.edu.ng", "never@unilag.edu.ng", "pending@unilag.edu.ng"]) {
		assert.ok(!all.includes(email), `${email} is masked`);
	}
	assert.ok(all.includes("a***a@unilag.edu.ng") && all.includes("b***s@unilag.edu.ng"));
	assert.ok(cellsOf(xml.Filters).includes("Yes"), "the Filters sheet says emails are masked");
});

test("XLSX: Raw data moves to a new sheet at the row limit, and empty exports say so", () => {
	const report = buildReport({ started: startedFor("xlsx"), analysis: ANALYSIS, filters: FILTERS });
	const workbook = createWorkbook();
	const raw = rawWriter(workbook, report, { maxRows: 3 }); // header + 2 rows per sheet
	raw.add(ROWS);
	raw.end();
	const names = sheetsOf({ chunks: workbook.finish() }).names;
	assert.deepEqual(names, ["Raw data", "Raw data (2)"]);

	const membersOnly = buildReport({
		started: startedFor("xlsx", { events: 0, sections: ["summary", "members", "raw"] }),
		analysis: { summary: { ...ANALYSIS.summary, total_events: 0, busiest_day: null, busiest_hour: null, most_common_action: null }, members: ANALYSIS.members },
		filters: FILTERS,
	});
	assert.ok(membersOnly.notes.some((n) => n.includes("Only the member list has content")));
	const wb = createWorkbook();
	for (const sheet of membersOnly.sheets) writeSheet(wb, sheet);
	assert.deepEqual(wb.sheetNames, ["Summary", "Members overview", "Members"]);
});

// ---------- The PDF ----------

test("PDF: builds a multi-page report, and the appendix stops at 2,000 rows", async () => {
	const many = Array.from({ length: 2600 }, (_, i) => ({ ...ROWS[i % 3], id: i + 1 }));
	const api = fakeApi({ rows: many });
	const file = await buildExportFile(api, {
		started: startedFor("pdf", { events: 2600 }),
		filters: FILTERS,
		mask: true,
		loadPdf: async () => ({ buildPdfReport }),
	});
	assert.equal(file.type, "application/pdf");
	const bytes = file.chunks[0];
	assert.equal(strFromU8(bytes.slice(0, 5)), "%PDF-");
	// Only the first 2,000 rows were read for the appendix.
	const rowCalls = api.calls.filter((c) => c.path.startsWith("/audit/export/rows"));
	assert.deepEqual(rowCalls.map((c) => new URL(c.path, "http://x").searchParams.get("limit")), ["2000"]);

	const report = buildReport({ started: startedFor("pdf", { events: 2600 }), analysis: ANALYSIS, filters: FILTERS });
	const pdf = buildPdfReport(report, { appendix: many.slice(0, 2000), compress: false });
	assert.ok(pdf.getNumberOfPages() > 5);
	// Without the raw section there's no appendix and no row reads.
	const lean = fakeApi();
	await buildExportFile(lean, { started: startedFor("pdf", { sections: ["summary", "members"] }), filters: FILTERS, loadPdf: async () => ({ buildPdfReport }) });
	assert.equal(lean.calls.filter((c) => c.path.startsWith("/audit/export/rows")).length, 0);
});

test("a cancelled export stops between pages", async () => {
	const controller = new AbortController();
	const api = fakeApi({ pageSize: 1 });
	const promise = buildExportFile(api, {
		started: startedFor("xlsx"),
		filters: FILTERS,
		signal: controller.signal,
		onProgress: (done) => done === 1 && controller.abort(),
	});
	await assert.rejects(promise, { name: "AbortError" });
	assert.equal(api.calls.filter((c) => c.path.startsWith("/audit/export/rows")).length, 1);
});
