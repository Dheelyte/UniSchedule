// The PDF report of an Activity Logs export (jsPDF, A4 portrait). Loaded only
// when PDF is chosen. It draws the same report model as the workbook
// (report.js), plus charts: categories and users as bars, events over time as
// columns, and a day × hour heatmap.
//
// The header lists every filter, who generated the file, when, and the time
// zone. The Members part shows the overview and the flagged members (the full
// list is in the Excel file). The raw appendix stops at 2,000 rows.
// No DOM, relative imports only: it also runs in `node --test`.
import { jsPDF } from "jspdf";
import { robotoCondensedBold, robotoCondensedRegular } from "../../lib/fonts/robotoCondensed.js";
import { unilagLogoBase64 } from "../../lib/logo.js";
import { categoryLabel } from "./categories.js";
import { TIMEZONE_NOTE, formatDay } from "./filters.js";
import { PDF_APPENDIX_LIMIT } from "./report.js";

const FONT = "RobotoCondensed";
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 16;
const NAVY = [12, 61, 145];
const INK = [17, 24, 39];
const MUTED = [100, 116, 139];
const BORDER = [203, 213, 225];
const ZEBRA = [244, 246, 251];
const BAR = [99, 102, 241];
const WARN = [185, 28, 28];
const TABLE_ROWS = 30;

class Writer {
	constructor(pdf) {
		this.pdf = pdf;
		this.y = MARGIN;
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
		this.y = MARGIN;
	}

	heading(text) {
		this.ensure(16);
		this.y += 3;
		this.font("bold", 13, NAVY);
		this.pdf.text(text, MARGIN, this.y + 4);
		this.y += 7;
		this.pdf.setDrawColor(...NAVY);
		this.pdf.setLineWidth(0.4);
		this.pdf.line(MARGIN, this.y, MARGIN + CONTENT_W, this.y);
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
		const drawHeader = () => drawRow(columns, { style: "bold", fill: [226, 232, 240] });
		this.ensure(10);
		if (header) drawHeader();
		shown.forEach((row, i) => drawRow(row, { fill: i % 2 ? ZEBRA : null, firstBold: boldFirst }));
		this.y += 2;
		const more = rows.length - shown.length;
		if (more > 0) this.paragraph(`Showing the first ${shown.length.toLocaleString()} of ${rows.length.toLocaleString()} rows. The Excel export holds them all.`);
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
		this.paragraph(`Darkest cell: ${top.toLocaleString()} events. Hours are Lagos time.`);
	}
}

/**
 * The PDF for a report (report.js). `appendix` holds the first raw rows when
 * the Raw data section was ticked. Returns the jsPDF document.
 */
export function buildPdfReport(report, { appendix = [], compress = true } = {}) {
	const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress });
	pdf.addFileToVFS("RobotoCondensed-Regular.ttf", robotoCondensedRegular);
	pdf.addFont("RobotoCondensed-Regular.ttf", FONT, "normal");
	pdf.addFileToVFS("RobotoCondensed-Bold.ttf", robotoCondensedBold);
	pdf.addFont("RobotoCondensed-Bold.ttf", FONT, "bold");
	pdf.setProperties({ title: `${report.title} · ${report.subtitle}`, creator: "UniSchedule" });
	const w = new Writer(pdf);
	const a = report.analysis;
	const sheet = (key, name) => report.sheets.find((s) => s.key === key && (!name || s.name === name));
	// A section is drawn when it was ticked and the server answered for it.
	const has = (key) => report.sections.includes(key) && Boolean(a[key]) && Boolean(sheet(key));

	// ---------- Header ----------
	try {
		pdf.addImage(unilagLogoBase64, "PNG", MARGIN, w.y, 16, 16);
	} catch {
		// The report is still complete without the crest.
	}
	w.font("bold", 16, NAVY);
	pdf.text("UniSchedule · Activity log analysis", MARGIN + 20, w.y + 7);
	w.font("normal", 9.5, INK);
	pdf.text(report.subtitle, MARGIN + 20, w.y + 13);
	w.y += 20;
	w.paragraph(TIMEZONE_NOTE, { color: NAVY, style: "bold", size: 9 });
	w.keyValues(report.meta.filter(([k]) => k !== "Time zone"));
	w.subheading("Filters applied");
	w.keyValues(report.filters);
	for (const note of report.notes) w.paragraph(note, { color: WARN });

	// ---------- Sections ----------
	if (has("summary")) {
		w.heading("Summary");
		w.keyValues(sheet("summary").blocks[0].rows);
	}
	if (has("categories")) {
		w.heading("By category & action");
		w.bars(a.categories.categories.map((c) => ({ label: c.label, value: c.count })), { title: "Events by category" });
		const blocks = sheet("categories").blocks;
		if (blocks.length === 2) {
			w.table(blocks[0].columns, blocks[0].rows, { widths: [0.6, 0.2, 0.2] });
			w.subheading("Most common actions");
			const actions = [...blocks[1].rows].sort((x, y) => y[2] - x[2]);
			w.table(blocks[1].columns, actions, { widths: [0.3, 0.4, 0.15, 0.15], maxRows: TABLE_ROWS });
		} else {
			w.paragraph(blocks[0].rows[0][0]);
		}
	}
	if (has("users")) {
		w.heading("By user");
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
		w.heading("By role & portal");
		for (const block of sheet("roles_portals").blocks) {
			w.subheading(block.title);
			w.table(block.columns, block.rows, { maxRows: TABLE_ROWS });
		}
	}
	if (has("over_time")) {
		w.heading("Over time");
		const o = a.over_time;
		w.columns(o.buckets, { title: o.granularity === "day" ? "Events per day" : "Events per week (weeks start on Monday)" });
		const busiest = [...o.categories]
			.map((k) => ({ label: categoryLabel(k), value: o.buckets.reduce((n, b) => n + (b.by_category[k] || 0), 0) }))
			.sort((x, y) => y.value - x.value);
		w.paragraph(`Categories in this period: ${busiest.map((x) => `${x.label} (${x.value})`).join(", ") || "none"}. Per-category counts for each ${o.granularity} are in the Excel file.`);
		w.heatmap(o.heatmap, { title: "Day × hour (Lagos time)" });
	}
	if (has("impersonation")) {
		w.heading("Impersonation sessions");
		const block = sheet("impersonation").blocks[0];
		w.paragraph(`${a.impersonation.total} session(s), ${a.impersonation.flagged} flagged with no stop recorded.`, { color: a.impersonation.flagged ? WARN : MUTED });
		w.table(
			["Admin", "Acted as", "Faculty", "Started", "Ended", "Ended by", "Min", "Actions", "Flag"],
			block.rows.map((r) => (r.length > 1 ? [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[9]] : r)),
			{ widths: [0.17, 0.12, 0.08, 0.12, 0.12, 0.11, 0.06, 0.08, 0.14], maxRows: 200, note: block.note },
		);
	}
	if (has("sensitive")) {
		w.heading("Sensitive actions");
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
	if (has("change_requests")) {
		w.heading("Change requests");
		const [figures, outcomes] = sheet("change_requests").blocks;
		w.keyValues(figures.rows);
		w.table(outcomes.columns, outcomes.rows);
	}
	if (has("members")) {
		w.heading("Members");
		const overview = sheet("members", "Members overview").blocks;
		w.keyValues(overview[0].rows);
		w.subheading("By role");
		w.table(overview[1].columns, overview[1].rows, { widths: [0.7, 0.3] });
		w.subheading("By faculty");
		w.table(overview[2].columns, overview[2].rows, { widths: [0.7, 0.3] });
		w.subheading("Invitations not yet accepted");
		w.table(overview[3].columns, overview[3].rows);
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
		w.heading("Appendix: raw log");
		const rows = appendix.slice(0, PDF_APPENDIX_LIMIT).map((e) => {
			const r = report.raw.row(e);
			return [r[0], r[1], r[2] + (e.impersonating ? ` (real: ${r[3]})` : ""), r[8], r[12]];
		});
		if (rows.length === 0) w.paragraph("No events match the filters in this period.");
		else w.table(["When", "User", "Role (as acted)", "Action", "Description"], rows, { widths: [0.13, 0.21, 0.15, 0.18, 0.33], size: 6.8 });
		if (report.events > PDF_APPENDIX_LIMIT) {
			w.paragraph(`The appendix stops at ${PDF_APPENDIX_LIMIT.toLocaleString()} of ${report.events.toLocaleString()} entries. The Excel export holds every entry.`, { color: WARN });
		}
	}

	// ---------- Footer on every page ----------
	const pages = pdf.getNumberOfPages();
	for (let i = 1; i <= pages; i++) {
		pdf.setPage(i);
		pdf.setFont(FONT, "normal");
		pdf.setFontSize(7);
		pdf.setTextColor(...MUTED);
		pdf.text(`${report.subtitle} · ${TIMEZONE_NOTE}`, MARGIN, PAGE_H - 8);
		pdf.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: "right" });
	}
	return pdf;
}
