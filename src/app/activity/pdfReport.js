// The PDF report of an Activity Logs export (jsPDF, A4 portrait). Loaded only
// when PDF is chosen. It draws the same report model as the workbook
// (report.js), plus charts: categories and users as bars, events over time as
// columns, and a day × hour heatmap.
//
// Set in Inter with the platform's colours. Page 1 is the letterhead (the
// University of Lagos crest and name), the contents, and the audit record:
// reference, portal, period, who generated it and when, the data snapshot,
// sections and classification. The filters follow, then one numbered section
// per page, and a review and sign-off page. Every page after the first has a
// running header; every page has the reference, CONFIDENTIAL and "Page x of y".
// The Members part shows the overview and the flagged members (the full list is
// in the Excel file). The raw appendix stops at 2,000 rows.
// No DOM, relative imports only: it also runs in `node --test`.
import { jsPDF } from "jspdf";
import { interBold, interRegular, interSemiBold } from "../../lib/fonts/inter.js";
import { unilagLogoBase64 } from "../../lib/logo.js";
import { categoryLabel } from "./categories.js";
import { formatDay } from "./filters.js";
import { CLASSIFICATION, PDF_APPENDIX_LIMIT, SECTIONS } from "./report.js";

// The platform's typeface and colours (globals.css): Inter, indigo, slate.
const FONT = "Inter";
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 18;
// Pages after the first carry a running header, so their content starts lower.
const TOP = 22;
const INDIGO = [67, 56, 202]; // --color-primary-dark
const INK = [15, 23, 42]; // --color-text
const MUTED = [100, 116, 139];
const BORDER = [226, 232, 240]; // --color-border
const ZEBRA = [248, 250, 252];
const HEAD_FILL = [238, 240, 254]; // --color-primary-bg on white
const PANEL = [248, 250, 252];
const BAR = [99, 102, 241]; // --color-primary
const WARN = [220, 38, 38]; // --color-danger
// Sections flow on: a gap between them, and a new page when less than about a third is left.
const SECTION_GAP = 8;
const SECTION_MIN_SPACE = 85;
const TIME_NOTE = "All times are in Lagos time (WAT, UTC+1).";
const TABLE_ROWS = 30;

class Writer {
	constructor(pdf) {
		this.pdf = pdf;
		this.y = MARGIN;
		this.count = 0;
		// { number, title, page } for the contents list on page 1.
		this.toc = [];
	}

	font(style = "normal", size = 9, color = INK) {
		this.pdf.setFont(FONT, style);
		this.pdf.setFontSize(size);
		this.pdf.setTextColor(...color);
	}

	ensure(height) {
		if (this.y + height > BOTTOM) this.newPage();
	}

	newPage() {
		this.pdf.addPage();
		this.y = TOP;
	}

	/**
	 * A numbered section, listed in the contents. It follows on from the one
	 * before, unless `newPage` is set, or less than a third of a page is left (so
	 * a heading is never stranded at the bottom without its content).
	 */
	section(text, { newPage = false } = {}) {
		this.count += 1;
		const number = this.count;
		if (this.y > TOP + 1) {
			// The first section starts after the cover page.
			if (newPage || number === 1 || this.y + SECTION_MIN_SPACE > BOTTOM) this.newPage();
			else this.y += SECTION_GAP;
		}
		this.toc.push({ number, title: text, page: this.pdf.getNumberOfPages() });
		this.heading(`${number}. ${text}`);
	}

	heading(text) {
		this.ensure(16);
		this.y += 2;
		this.font("heavy", 14, INDIGO);
		this.pdf.text(text, MARGIN, this.y + 5);
		this.y += 8;
		this.pdf.setDrawColor(...BAR);
		this.pdf.setLineWidth(0.5);
		this.pdf.line(MARGIN, this.y, MARGIN + 24, this.y);
		this.pdf.setDrawColor(...BORDER);
		this.pdf.setLineWidth(0.2);
		this.pdf.line(MARGIN + 24, this.y, MARGIN + CONTENT_W, this.y);
		this.y += 5;
	}

	/** A labelled panel of key/value rows on a light background (the audit record, the filters). */
	panel(title, rows) {
		const pdf = this.pdf;
		const labelW = 46;
		const valueW = CONTENT_W - labelW - 8;
		const size = 8;
		const lineH = size * 0.42;
		const laid = rows.map(([k, v]) => {
			this.font("normal", size);
			const lines = pdf.splitTextToSize(v === null || v === undefined || v === "" ? "Not recorded" : String(v), valueW);
			return { k: String(k), lines, h: Math.max(1, lines.length) * lineH + 2.2 };
		});
		const titleH = 8;
		const total = titleH + laid.reduce((n, r) => n + r.h, 0) + 3;
		this.ensure(Math.min(total, 60));
		let top = this.y;
		const startBox = (height) => {
			pdf.setFillColor(...PANEL);
			pdf.setDrawColor(...BORDER);
			pdf.setLineWidth(0.25);
			pdf.roundedRect(MARGIN, top, CONTENT_W, height, 1.5, 1.5, "FD");
			pdf.setFillColor(...BAR);
			pdf.rect(MARGIN, top + 1.5, 0.9, height - 3, "F");
		};
		// Draw the box first (its height on this page), then the rows over it.
		const pageRows = [];
		let h = titleH;
		for (const r of laid) {
			if (top + h + r.h + 3 > BOTTOM) break;
			pageRows.push(r);
			h += r.h;
		}
		startBox(h + 3);
		this.font("bold", 9.5, INDIGO);
		pdf.text(title, MARGIN + 5, top + 5.6);
		let y = top + titleH;
		const drawRows = (list) => {
			for (const r of list) {
				this.font("bold", size, MUTED);
				pdf.text(r.k, MARGIN + 5, y + lineH + 0.4);
				this.font("normal", size, INK);
				r.lines.forEach((line, j) => pdf.text(line, MARGIN + 5 + labelW, y + lineH * (j + 1) + 0.4));
				y += r.h;
			}
		};
		drawRows(pageRows);
		let rest = laid.slice(pageRows.length);
		this.y = y + 3;
		while (rest.length) {
			this.newPage();
			top = this.y;
			const more = [];
			let hh = 4;
			for (const r of rest) {
				if (top + hh + r.h + 3 > BOTTOM) break;
				more.push(r);
				hh += r.h;
			}
			startBox(hh + 3);
			y = top + 4;
			drawRows(more);
			rest = rest.slice(more.length);
			this.y = y + 3;
		}
		this.y += 4;
	}

	subheading(text) {
		this.ensure(10);
		this.font("bold", 10, INK);
		this.pdf.text(text, MARGIN, this.y + 3.5);
		this.y += 6;
	}

	paragraph(text, { size = 8.5, color = MUTED, style = "normal" } = {}) {
		this.font(style, size, color);
		const lines = this.pdf.splitTextToSize(String(text), CONTENT_W);
		const lineH = size * 0.42;
		for (const line of lines) {
			this.ensure(lineH + 1);
			this.pdf.text(line, MARGIN, this.y + lineH);
			this.y += lineH;
		}
		this.y += 2;
	}

	keyValues(rows) {
		this.table(["", ""], rows.map(([k, v]) => [k, v]), { widths: [0.38, 0.62], header: false, boldFirst: true });
	}

	/** A table that wraps text and repeats its header on each new page. */
	table(columns, rows, { widths, header = true, boldFirst = false, size = 7.5, maxRows = Infinity, note = null } = {}) {
		const pdf = this.pdf;
		const fractions = widths || columns.map(() => 1 / columns.length);
		const colW = fractions.map((f) => f * CONTENT_W);
		const lineH = size * 0.4;
		const shown = rows.slice(0, maxRows);
		const layout = (cells, style) => {
			this.font(style, size);
			const wrapped = cells.map((cell, i) => {
				const lines = pdf.splitTextToSize(cell === null || cell === undefined ? "" : String(cell), colW[i] - 2.4);
				return lines.length > 6 ? [...lines.slice(0, 5), `${lines[5]}…`] : lines;
			});
			return { wrapped, height: Math.max(1, ...wrapped.map((l) => l.length)) * lineH + 2.4 };
		};
		const drawRow = (cells, { style = "normal", fill = null, firstBold = false } = {}) => {
			const { wrapped, height } = layout(cells, style);
			if (this.y + height > BOTTOM) {
				this.newPage();
				if (header && style !== "bold") drawHeader();
			}
			if (fill) {
				pdf.setFillColor(...fill);
				pdf.rect(MARGIN, this.y, CONTENT_W, height, "F");
			}
			let x = MARGIN;
			wrapped.forEach((lines, i) => {
				this.font(style === "bold" || (firstBold && i === 0) ? "bold" : "normal", size, INK);
				lines.forEach((line, j) => pdf.text(line, x + 1.2, this.y + 1.2 + lineH * (j + 0.8)));
				x += colW[i];
			});
			pdf.setDrawColor(...BORDER);
			pdf.setLineWidth(0.15);
			pdf.line(MARGIN, this.y + height, MARGIN + CONTENT_W, this.y + height);
			this.y += height;
		};
		const drawHeader = () => drawRow(columns, { style: "bold", fill: HEAD_FILL });
		this.ensure(10);
		if (header) drawHeader();
		shown.forEach((row, i) => drawRow(row, { fill: i % 2 ? ZEBRA : null, firstBold: boldFirst }));
		this.y += 2;
		const more = rows.length - shown.length;
		if (more > 0) this.paragraph(`First ${shown.length.toLocaleString()} of ${rows.length.toLocaleString()} rows shown. The Excel export has the full list.`);
		if (note) this.paragraph(note);
		this.y += 2;
	}

	/** Horizontal bars, labelled, largest first. */
	bars(items, { title, max = 12 } = {}) {
		const shown = items.slice(0, max);
		if (!shown.length) return;
		const rowH = 5.2;
		this.ensure(rowH * shown.length + 10);
		if (title) this.subheading(title);
		const labelW = 58;
		const barW = CONTENT_W - labelW - 18;
		const top = Math.max(...shown.map((i) => i.value), 1);
		for (const item of shown) {
			this.font("normal", 7.5, INK);
			const label = this.pdf.splitTextToSize(String(item.label), labelW - 2)[0];
			this.pdf.text(label, MARGIN, this.y + 3.6);
			const w = Math.max(0.6, (item.value / top) * barW);
			this.pdf.setFillColor(...BAR);
			this.pdf.rect(MARGIN + labelW, this.y + 0.8, w, rowH - 1.8, "F");
			this.font("bold", 7.5, INK);
			this.pdf.text(item.value.toLocaleString(), MARGIN + labelW + w + 1.5, this.y + 3.6);
			this.y += rowH;
		}
		this.y += 4;
	}

	/** Columns for a time series. */
	columns(buckets, { title } = {}) {
		if (!buckets.length) return;
		const h = 42;
		this.ensure(h + 18);
		if (title) this.subheading(title);
		const pdf = this.pdf;
		const top = Math.max(...buckets.map((b) => b.total), 1);
		const left = MARGIN + 10;
		const width = CONTENT_W - 10;
		const step = width / buckets.length;
		const base = this.y + h;
		pdf.setDrawColor(...BORDER);
		pdf.setLineWidth(0.2);
		pdf.line(left, base, left + width, base);
		this.font("normal", 6.5, MUTED);
		pdf.text(String(top), MARGIN, this.y + 2);
		pdf.text("0", MARGIN, base);
		buckets.forEach((b, i) => {
			const bh = (b.total / top) * (h - 2);
			pdf.setFillColor(...BAR);
			if (bh > 0) pdf.rect(left + i * step + step * 0.12, base - bh, Math.max(step * 0.76, 0.3), bh, "F");
		});
		const every = Math.max(1, Math.ceil(buckets.length / 8));
		this.font("normal", 6.5, MUTED);
		buckets.forEach((b, i) => {
			if (i % every === 0) pdf.text(formatDay(b.start), left + i * step, base + 4);
		});
		this.y = base + 8;
	}

	/** A 7 × 24 grid, darker for busier hours. */
	heatmap(matrix, { title } = {}) {
		const pdf = this.pdf;
		const cell = (CONTENT_W - 16) / 24;
		const rowH = 5;
		this.ensure(rowH * 7 + 18);
		if (title) this.subheading(title);
		const top = Math.max(1, ...matrix.flat());
		const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
		this.font("normal", 6, MUTED);
		for (let h = 0; h < 24; h++) pdf.text(String(h).padStart(2, "0"), MARGIN + 16 + h * cell + cell / 2 - 1.5, this.y + 2.5);
		this.y += 4;
		matrix.forEach((row, d) => {
			this.font("normal", 7, INK);
			pdf.text(days[d], MARGIN, this.y + 3.5);
			row.forEach((value, h) => {
				const shade = value === 0 ? 0 : 0.15 + 0.85 * (value / top);
				const colour = BAR.map((c) => Math.round(255 - (255 - c) * shade));
				pdf.setFillColor(...colour);
				pdf.setDrawColor(255, 255, 255);
				pdf.rect(MARGIN + 16 + h * cell, this.y, cell, rowH, "FD");
			});
			this.y += rowH;
		});
		this.y += 3;
		this.paragraph(`The darkest cell is ${top.toLocaleString()} ${top === 1 ? "event" : "events"}. Hours are in Lagos time.`);
	}
}

/**
 * The PDF for a report (report.js). `appendix` holds the first raw rows when
 * the Raw data section was ticked. Returns the jsPDF document.
 */
export function buildPdfReport(report, { appendix = [], qr = null, compress = true } = {}) {
	const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress });
	pdf.addFileToVFS("Inter-Regular.ttf", interRegular);
	pdf.addFont("Inter-Regular.ttf", FONT, "normal");
	pdf.addFileToVFS("Inter-SemiBold.ttf", interSemiBold);
	pdf.addFont("Inter-SemiBold.ttf", FONT, "bold");
	pdf.addFileToVFS("Inter-Bold.ttf", interBold);
	pdf.addFont("Inter-Bold.ttf", FONT, "heavy");
	pdf.setProperties({
		title: `University of Lagos, Activity Log Analysis Report, ${report.subtitle}`,
		subject: `Audit record ${report.reference}`,
		author: report.generatedBy || "",
		creator: "UniSchedule",
	});
	const w = new Writer(pdf);
	const a = report.analysis;
	const sheet = (key, name) => report.sheets.find((s) => s.key === key && (!name || s.name === name));
	// A section is drawn when it was ticked and the server answered for it.
	const has = (key) => report.sections.includes(key) && Boolean(a[key]) && Boolean(sheet(key));
	const center = PAGE_W / 2;

	// ---------- Letterhead: crest, university, title ----------
	const crest = 22;
	try {
		pdf.addImage(unilagLogoBase64, "PNG", center - crest / 2, w.y, crest, crest);
	} catch {
		// The report is still complete without the crest.
	}
	w.y += crest + 6;
	w.font("heavy", 16, INK);
	pdf.text("UNIVERSITY OF LAGOS", center, w.y, { align: "center", charSpace: 0.6 });
	w.y += 5.5;
	w.font("normal", 9, MUTED);
	pdf.text("UniSchedule Timetable Manager", center, w.y, { align: "center" });
	w.y += 13;
	w.font("heavy", 18, INDIGO);
	pdf.text("Activity Log Analysis Report", center, w.y, { align: "center" });
	w.y += 6.5;
	w.font("normal", 10, INK);
	pdf.text(report.subtitle, center, w.y, { align: "center" });
	w.y += 6;
	// The classification, as a small red tag.
	w.font("bold", 7.5, WARN);
	const tag = `CONFIDENTIAL. ${CLASSIFICATION.toUpperCase()}`;
	const tagW = pdf.getTextWidth(tag) + 6;
	pdf.setDrawColor(...WARN);
	pdf.setLineWidth(0.3);
	pdf.roundedRect(center - tagW / 2, w.y - 1, tagW, 5.6, 1.2, 1.2, "S");
	pdf.text(tag, center, w.y + 2.9, { align: "center" });
	w.y += 11;

	// ---------- Contents (page numbers filled in at the end) ----------
	const listed = SECTIONS.filter((x) => x.key !== "raw" && has(x.key)).length + (report.sections.includes("raw") ? 1 : 0) + 1;
	const tocTop = w.y;
	w.y += 9 + listed * 5.2 + 4;

	// ---------- Audit record and filters ----------
	w.panel("Audit record", report.meta.filter(([k]) => k !== "Time zone"));
	w.paragraph(TIME_NOTE, { color: INDIGO, style: "bold", size: 8.5 });
	w.panel("Filters applied", report.filters);
	for (const note of report.notes) w.paragraph(note, { color: WARN, style: "bold" });

	// ---------- Sections ----------
	if (has("summary")) {
		w.section("Summary");
		w.keyValues(sheet("summary").blocks[0].rows);
	}
	if (has("categories")) {
		w.section("By category & action");
		w.bars(a.categories.categories.map((c) => ({ label: c.label, value: c.count })), { title: "Events by category" });
		const blocks = sheet("categories").blocks;
		if (blocks.length === 2) {
			w.table(blocks[0].columns, blocks[0].rows, { widths: [0.4, 0.14, 0.14, 0.17, 0.15] });
			w.subheading("Most common actions");
			const actions = [...blocks[1].rows].sort((x, y) => y[2] - x[2]);
			w.table(blocks[1].columns, actions, { widths: [0.3, 0.4, 0.15, 0.15], maxRows: TABLE_ROWS, note: blocks[1].note });
		} else {
			w.paragraph(blocks[0].rows[0][0]);
		}
	}
	if (has("users")) {
		w.section("By user");
		const block = sheet("users").blocks[0];
		// The table rows follow the users' order, with emails already masked when asked.
		if (a.users.users.length) {
			w.bars(a.users.users.slice(0, 10).map((u, i) => ({ label: block.rows[i][0], value: u.count })), { title: "Busiest users" });
		}
		w.table(
			["User", "Roles (as acted)", "Events", "%", "Top actions", "Last active"],
			block.rows.map((r) => (r.length > 1 ? [r[0], r[2], r[3], r[4], r[6], r[7]] : r)),
			{ widths: [0.24, 0.17, 0.08, 0.07, 0.29, 0.15], maxRows: TABLE_ROWS },
		);
	}
	if (has("roles_portals")) {
		w.section("By role & portal");
		for (const block of sheet("roles_portals").blocks) {
			w.subheading(block.title);
			w.table(block.columns, block.rows, { maxRows: TABLE_ROWS });
		}
	}
	if (has("over_time")) {
		w.section("Over time");
		const o = a.over_time;
		w.columns(o.buckets, { title: o.granularity === "day" ? "Events per day" : "Events per week (weeks start on Monday)" });
		const busiest = [...o.categories]
			.map((k) => ({ label: categoryLabel(k), value: o.buckets.reduce((n, b) => n + (b.by_category[k] || 0), 0) }))
			.sort((x, y) => y.value - x.value);
		w.paragraph(`Categories in this period: ${busiest.map((x) => `${x.label} (${x.value})`).join(", ") || "none"}. The Excel file breaks these down by ${o.granularity}.`);
		w.heatmap(o.heatmap, { title: "Activity by day and hour (Lagos time)" });
	}
	if (has("out_of_hours")) {
		w.section("Out of hours");
		const [figures, byUser, entries] = sheet("out_of_hours").blocks;
		const oh = a.out_of_hours;
		w.paragraph(
			oh.total
				? `${oh.total} ${oh.total === 1 ? "event was" : "events were"} recorded out of hours, ${oh.pct}% of all events in this report.`
				: "Nothing was recorded out of hours in this period.",
			{ color: oh.total ? WARN : MUTED },
		);
		w.keyValues(figures.rows);
		if (oh.total) {
			w.subheading("By user");
			w.table(byUser.columns, byUser.rows, { widths: [0.75, 0.25], maxRows: 20 });
			w.subheading("Latest entries");
			w.table(
				["When", "Why", "User", "Action", "Description"],
				entries.rows.map((r) => [r[0], r[1], r[2], r[4], r[5]]),
				{ widths: [0.12, 0.14, 0.2, 0.25, 0.29], maxRows: 50, note: entries.note },
			);
		} else {
			w.paragraph(entries.note);
		}
	}
	if (has("unusual")) {
		w.section("Unusual activity");
		const un = a.unusual;
		w.paragraph(
			un.total ? `${un.total} ${un.total === 1 ? "pattern" : "patterns"} worth a second look.` : "Nothing unusual found in this period.",
			{ color: un.total ? WARN : MUTED },
		);
		const [deletions, bursts, faculty] = sheet("unusual").blocks;
		for (const block of [deletions, bursts]) {
			w.subheading(block.title);
			w.table(block.columns, block.rows, { widths: [0.34, 0.14, 0.26, 0.26], note: block.note });
		}
		w.subheading(faculty.title);
		w.table(
			["When", "User", "Theirs", "Item's", "Description"],
			faculty.rows.map((r) => (r.length > 1 ? [r[0], r[1], r[2], r[3], r[5]] : r)),
			{ widths: [0.13, 0.22, 0.09, 0.09, 0.47], maxRows: 50 },
		);
	}
	if (has("impersonation")) {
		w.section("Impersonation sessions");
		const block = sheet("impersonation").blocks[0];
		const sessions = a.impersonation.total;
		const flaggedSessions = a.impersonation.flagged;
		w.paragraph(
			`${sessions} ${sessions === 1 ? "session" : "sessions"}` +
				(flaggedSessions ? `, of which ${flaggedSessions} ${flaggedSessions === 1 ? "has" : "have"} no recorded end.` : ", all with a recorded end."),
			{ color: flaggedSessions ? WARN : MUTED },
		);
		w.table(
			["Admin", "Acted as", "Faculty", "Started", "Ended", "Ended by", "Min", "Actions", "Flag"],
			block.rows.map((r) => (r.length > 1 ? [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[9]] : r)),
			{ widths: [0.17, 0.12, 0.08, 0.12, 0.12, 0.11, 0.06, 0.08, 0.14], maxRows: 200, note: block.note },
		);
	}
	if (has("sensitive")) {
		w.section("Sensitive actions");
		const [byAction, entries] = sheet("sensitive").blocks;
		w.table(byAction.columns, byAction.rows, { widths: [0.7, 0.3] });
		if (entries.rows.length) {
			w.subheading("Latest entries");
			w.table(
				["When", "User", "As", "Action", "Description"],
				entries.rows.map((r) => [r[0], r[1], r[2], r[4], r[5]]),
				{ widths: [0.13, 0.2, 0.13, 0.17, 0.37], maxRows: 50 },
			);
		}
	}
	if (has("handovers")) {
		w.section("Editor access handovers");
		const [figures, list] = sheet("handovers").blocks;
		w.keyValues(figures.rows);
		w.table(
			["Faculty", "Given by", "Given to", "Started", "Ended", "How it ended", "Days"],
			list.rows.map((r) => (r.length > 1 ? [r[0], r[1], r[2], r[3], r[4], r[5] + (r[6] ? `, by ${r[6]}` : ""), r[7]] : r)),
			{ widths: [0.14, 0.17, 0.17, 0.12, 0.12, 0.21, 0.07], note: list.note },
		);
	}
	if (has("locks")) {
		w.section("Locked timetables");
		const [figures, reopenings, edits] = sheet("locks").blocks;
		const lk = a.locks;
		w.paragraph(
			lk.total
				? `FINAL timetables were reopened ${lk.total} ${lk.total === 1 ? "time" : "times"} in this period, with ${lk.edits} ${lk.edits === 1 ? "edit" : "edits"} made while open.`
				: "No FINAL timetable was reopened in this period.",
			{ color: lk.without_request || lk.still_open ? WARN : MUTED },
		);
		w.keyValues(figures.rows);
		if (lk.total) {
			w.subheading("Reopenings");
			w.table(
				["Timetable", "Unlocked", "By", "Request", "Edits", "Locked again", "Hours"],
				reopenings.rows.map((r) => [`${r[0]}, ${r[1]}`, r[2], r[3], r[4], r[5], r[7] + (r[8] ? `, ${r[8]}` : ""), r[9]]),
				{ widths: [0.15, 0.1, 0.2, 0.2, 0.06, 0.22, 0.07], note: reopenings.note },
			);
			w.subheading("Edits made while reopened");
			w.table(
				["When", "User", "Action", "Description"],
				edits.rows.map((r) => (r.length > 1 ? [r[1], r[2], r[4], r[5]] : r)),
				{ widths: [0.12, 0.2, 0.25, 0.43], maxRows: TABLE_ROWS, note: edits.note },
			);
		}
	}
	if (has("courses")) {
		w.section("Course history");
		const co = a.courses;
		const [byCourse, changes] = sheet("courses").blocks;
		w.paragraph(
			co.total_changes
				? `${co.total_changes} ${co.total_changes === 1 ? "change" : "changes"} to the schedules of ${co.total_courses} ${co.total_courses === 1 ? "course" : "courses"}.`
				: "No schedule changes in this period.",
			{ color: MUTED },
		);
		if (co.courses.length) {
			w.bars(co.courses.slice(0, 10).map((x) => ({ label: x.code, value: x.changes })), { title: "Most changed courses" });
			w.subheading("Changes");
			w.table(
				["Course", "When", "User", "Description"],
				changes.rows.map((r) => [r[0], r[1], r[2], r[5]]),
				{ widths: [0.1, 0.13, 0.2, 0.57], maxRows: TABLE_ROWS, note: changes.note || byCourse.note },
			);
		}
	}
	if (has("change_requests")) {
		w.section("Change requests");
		const [figures, outcomes] = sheet("change_requests").blocks;
		w.keyValues(figures.rows);
		w.table(outcomes.columns, outcomes.rows);
	}
	if (has("exports")) {
		w.section("Exports of this log");
		const block = sheet("exports").blocks[0];
		w.table(
			["When", "By", "Format", "Period", "Events", "Masked"],
			block.rows.map((r) => (r.length > 1 ? [r[0], r[1], r[2], r[3], r[4], r[5]] : r)),
			{ widths: [0.14, 0.26, 0.08, 0.32, 0.1, 0.1], maxRows: 100, note: block.note },
		);
	}
	if (has("members")) {
		w.section("Members");
		const overview = sheet("members", "Members overview").blocks;
		w.keyValues(overview[0].rows);
		w.subheading("By role");
		w.table(overview[1].columns, overview[1].rows, { widths: [0.7, 0.3] });
		w.subheading("By faculty");
		w.table(overview[2].columns, overview[2].rows, { widths: [0.7, 0.3] });
		w.subheading("Invitations not yet accepted");
		w.table(overview[3].columns, overview[3].rows);
		const review = overview.find((b) => b.title === "Accounts to review");
		if (review) {
			w.subheading(`Accounts to review (${review.rows[0]?.length > 1 ? review.rows.length : 0})`);
			w.table(review.columns, review.rows, { widths: [0.24, 0.15, 0.15, 0.16, 0.13, 0.17], note: review.note });
		}
		const members = sheet("members", "Members").blocks[0];
		const col = (name) => members.columns.indexOf(name);
		const flagged = members.rows.filter((r) => r[col("Flags")]);
		w.subheading(`Flagged members (${flagged.length})`);
		w.table(
			["Email", "Role", "Faculty", "Last login", "Via", "Flags"],
			flagged.map((r) => [r[col("Email")], r[col("Role")], r[col("Faculty")], r[col("Last login (Lagos)")], r[col("Last login via")], r[col("Flags")]]),
			{ widths: [0.25, 0.16, 0.17, 0.14, 0.1, 0.18] },
		);
		w.paragraph("The full list is in the Excel file.", { color: INK, style: "bold" });
		for (const note of report.memberNotes) w.paragraph(note);
	}
	if (report.sections.includes("raw")) {
		w.section("Appendix: raw log", { newPage: true });
		const rows = appendix.slice(0, PDF_APPENDIX_LIMIT).map((e) => {
			const r = report.raw.row(e);
			return [r[0], r[1], r[2] + (e.impersonating ? ` (real: ${r[3]})` : ""), r[8], r[12]];
		});
		if (rows.length === 0) w.paragraph("No events match the filters in this period.");
		else w.table(["When", "User", "Role (as acted)", "Action", "Description"], rows, { widths: [0.13, 0.21, 0.15, 0.18, 0.33], size: 6.8 });
		if (report.events > PDF_APPENDIX_LIMIT) {
			w.paragraph(`Only the first ${PDF_APPENDIX_LIMIT.toLocaleString()} of ${report.events.toLocaleString()} entries are listed here. The Excel export has all of them.`, { color: WARN });
		}
	}

	// ---------- Review and sign-off ----------
	w.section("Review and sign-off", { newPage: true });
	w.paragraph(
		"This report was generated from the UniSchedule activity log for the period and filters listed in the audit record. " +
			"The export was logged under the reference below. Running the same export again gives the same figures, " +
			"apart from any activity recorded after the snapshot.",
		{ color: INK, size: 9 },
	);
	w.y += 2;
	const signRows = [
		["Report reference", report.reference],
		...(report.verificationCode ? [["Verification code", report.verificationCode]] : []),
		["Prepared by", report.generatedBy || "Not recorded"],
		["Date generated", report.generatedAt],
		["Reviewed by", ""],
		["Position", ""],
		["Signature", ""],
		["Date", ""],
	];
	w.ensure(signRows.length * 11 + 10);
	for (const [label, value] of signRows) {
		w.font("bold", 8.5, MUTED);
		pdf.text(label, MARGIN, w.y + 6);
		if (value) {
			w.font("normal", 9, INK);
			pdf.text(pdf.splitTextToSize(value, CONTENT_W - 50)[0], MARGIN + 46, w.y + 6);
		} else {
			pdf.setDrawColor(...MUTED);
			pdf.setLineWidth(0.25);
			pdf.line(MARGIN + 46, w.y + 7, MARGIN + CONTENT_W, w.y + 7);
		}
		w.y += 11;
	}
	// ---------- Verification: a QR code to /verify/<code> ----------
	if (report.verificationCode && report.verifyUrl) {
		const size = 26;
		w.y += 4;
		w.ensure(size + 8);
		const top = w.y;
		if (qr) {
			try {
				pdf.addImage(qr, "PNG", MARGIN, top, size, size);
			} catch {
				// The code and the address below still let anyone check it.
			}
		}
		const tx = MARGIN + (qr ? size + 6 : 0);
		w.font("bold", 9, INDIGO);
		pdf.text("Check this report is genuine", tx, top + 5);
		w.font("normal", 8.5, INK);
		const lines = pdf.splitTextToSize(
			`Scan the code or open ${report.verifyUrl}. The page shows the reference, portal, period, number of events and when it was generated. Compare them with this copy.`,
			CONTENT_W - (tx - MARGIN),
		);
		pdf.text(lines, tx, top + 10.5);
		w.font("heavy", 11, INK);
		pdf.text(report.verificationCode, tx, top + 12 + lines.length * 4 + 3);
		w.y = top + size + 4;
	}
	w.y += 6;
	w.font("bold", 8.5, MUTED);
	pdf.text("End of report", center, w.y, { align: "center" });

	// ---------- Contents on page 1 ----------
	pdf.setPage(1);
	let ty = tocTop;
	w.font("bold", 9.5, INDIGO);
	pdf.text("Contents", MARGIN, ty + 4);
	ty += 9;
	for (const item of w.toc) {
		w.font("normal", 9, INK);
		const label = `${item.number}.  ${item.title}`;
		pdf.text(label, MARGIN + 2, ty);
		const page = String(item.page);
		pdf.text(page, MARGIN + CONTENT_W, ty, { align: "right" });
		// Dotted leader between the title and its page.
		const from = MARGIN + 4 + pdf.getTextWidth(label);
		const to = MARGIN + CONTENT_W - pdf.getTextWidth(page) - 2;
		pdf.setDrawColor(...BORDER);
		pdf.setLineWidth(0.3);
		pdf.setLineDashPattern([0.4, 1.2], 0);
		if (to > from) pdf.line(from, ty - 0.8, to, ty - 0.8);
		pdf.setLineDashPattern([], 0);
		ty += 5.2;
	}

	// ---------- Running header (after page 1) and footer on every page ----------
	const pages = pdf.getNumberOfPages();
	for (let i = 1; i <= pages; i++) {
		pdf.setPage(i);
		if (i > 1) {
			pdf.setFont(FONT, "bold");
			pdf.setFontSize(7.5);
			pdf.setTextColor(...INDIGO);
			pdf.text("University of Lagos", MARGIN, 11);
			const uniW = pdf.getTextWidth("University of Lagos");
			pdf.setFont(FONT, "normal");
			pdf.text("Activity Log Analysis Report", MARGIN + uniW + 4, 11);
			pdf.setFont(FONT, "normal");
			pdf.setTextColor(...MUTED);
			pdf.text(report.subtitle, PAGE_W - MARGIN, 11, { align: "right" });
			pdf.setDrawColor(...BORDER);
			pdf.setLineWidth(0.2);
			pdf.line(MARGIN, 13.5, PAGE_W - MARGIN, 13.5);
		}
		pdf.setDrawColor(...BORDER);
		pdf.setLineWidth(0.2);
		pdf.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
		pdf.setFont(FONT, "normal");
		pdf.setFontSize(7);
		pdf.setTextColor(...MUTED);
		pdf.text(`Ref: ${report.reference}`, MARGIN, PAGE_H - 8);
		pdf.setFont(FONT, "bold");
		pdf.setTextColor(...WARN);
		pdf.text("CONFIDENTIAL", center, PAGE_H - 8, { align: "center" });
		pdf.setFont(FONT, "normal");
		pdf.setTextColor(...MUTED);
		pdf.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: "right" });
	}
	return pdf;
}
