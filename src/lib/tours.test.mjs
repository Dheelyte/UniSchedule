// Every preview step must point at a feature that exists: a data-tour name
// used somewhere in the app. Catches a renamed or mistyped target, which would
// otherwise just be skipped silently.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TOURS, guideHref, stepsFor, tourFor } from "./tours.js";

function sources(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.(js|jsx)$/.test(name) && !name.includes(".test.") ? [readFileSync(path, "utf8")] : [];
	});
}

const code = sources(new URL("..", import.meta.url).pathname).join("\n");
// data-tour="name", data-tour={cond ? 'name' : …}, and the sidebar's nav-<path> names.
const names = new Set();
for (const m of code.matchAll(/data-tour=(?:"([a-z-]+)"|\{([^}]*)\})/g)) {
	if (m[1]) names.add(m[1]);
	else for (const q of m[2].matchAll(/'([a-z-]+)'/g)) names.add(q[1]);
}
for (const path of ["/faculties", "/courses", "/rooms", "/timetable/lectures", "/timetable/exams", "/timetable/cbt", "/terms", "/staff", "/requests", "/activity", "/signoffs", "/help"]) {
	names.add(`nav${path.replace(/\//g, "-")}`);
}

test("every step points at a data-tour name used in the app", () => {
	const missing = Object.entries(TOURS).flatMap(([key, tour]) =>
		tour.steps.filter((s) => s.target && !names.has(s.target)).map((s) => `${key}: ${s.target}`),
	);
	assert.deepEqual(missing, []);
});

test("every step has a title and an explanation", () => {
	for (const [key, tour] of Object.entries(TOURS)) {
		assert.ok(tour.title, key);
		for (const s of tour.steps) assert.ok(s.title && s.body && s.body.length > 10, `${key}: ${s.title}`);
	}
});

test("only the app's own pages have a preview: the home page is the dashboard, and public pages have none", () => {
	assert.equal(tourFor("/", true).key, "dashboard");
	for (const path of ["/", "/login", "/realms", "/register", "/forgot-password", "/download", "/verify", "/faq", "/contributors"]) {
		assert.equal(tourFor(path, false), null, `${path} signed out`);
	}
	for (const path of ["/download", "/verify", "/faq", "/contributors"]) assert.equal(tourFor(path, true), null, `${path} signed in`);
	assert.equal(tourFor("/timetable/exams", true).key, "timetable-exams");
	assert.equal(tourFor("/nowhere", true), null);
});

test("role-limited steps only show for those roles", () => {
	const staff = tourFor("/staff", true);
	const titles = (role) => stepsFor(staff, { role }).map((s) => s.title);
	assert.ok(titles("SUPER_ADMIN").includes("Editor access handovers"));
	assert.ok(!titles("FACULTY_EDITOR").includes("Editor access handovers"));
});

// ---------- The user guide (docs/guide) ----------

const guideDir = new URL("../../backend/guide/", import.meta.url).pathname;
const guide = Object.fromEntries(
	readdirSync(guideDir).filter((f) => f.endsWith(".md")).map((f) => [f, readFileSync(join(guideDir, f), "utf8")]),
);
const anchorsIn = (text) => new Set([...text.matchAll(/<a id="([a-z0-9-]+)"(?: data-roles="[^"]*")?><\/a>|^#+ (.+)$/gm)].map((m) => m[1] || m[2].toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ +/g, "-")));

test("every preview step's Learn more goes to a guide page and section that exist", () => {
	const broken = [];
	for (const key of Object.keys(TOURS)) {
		const tour = { key, guide: key, ...TOURS[key] };
		assert.ok(guide[`${tour.guide}.md`], `${key}: no docs/guide/${tour.guide}.md`);
		for (const step of tour.steps) {
			const [path, anchor] = guideHref(tour, step).split("#");
			const file = path === "/help" ? "README.md" : `${path.replace("/help/", "")}.md`;
			if (!guide[file]) broken.push(`${key}: ${step.title} -> ${path} (no ${file})`);
			else if (anchor && !anchorsIn(guide[file]).has(anchor)) broken.push(`${key}: ${step.title} -> ${file} has no <a id="${anchor}">`);
		}
	}
	assert.deepEqual(broken, [], "add <a id=\"name\"></a> before the feature's section in that guide page");
});

test("every guide page is listed on the guide's index, so it appears in the Help centre menu", () => {
	const listed = new Set([...guide["README.md"].matchAll(/\]\(([a-z0-9-]+)\.md\)/g)].map((m) => m[1]));
	const unlisted = Object.keys(guide).map((f) => f.replace(/\.md$/, "")).filter((p) => p !== "README" && !listed.has(p));
	assert.deepEqual(unlisted, []);
});

test("links between guide pages go to a page and section that exist", () => {
	const broken = [];
	for (const [file, text] of Object.entries(guide)) {
		for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
			if (/^[a-z]+:/.test(target) || target.startsWith("/")) continue;
			const [page, anchor] = target.split("#");
			const goal = page ? page : file;
			if (!guide[goal]) broken.push(`${file}: ${target}`);
			else if (anchor && !anchorsIn(guide[goal]).has(anchor)) broken.push(`${file}: ${target}`);
		}
	}
	assert.deepEqual(broken, []);
});
