// The index of faculties: one PDF that lists every faculty of every programme
// for a session, semester and timetable type, each linking to a download of
// that faculty's own timetable. Built on the server for staff (src/lib/exportIndex.js).
//
// Laid out like the office's printed index: crest, university name and motto,
// a gold rule, the title, then one bordered table per programme.
import { jsPDF } from "jspdf";
import { unilagLogoBase64 } from "./logo.js";

const NAVY = [12, 61, 145];
const LINK = [37, 99, 235];
const INK = [17, 24, 39];
const MUTED = [107, 114, 128];
const PENDING = [156, 163, 175];
const GOLD = [212, 175, 55];
const BORDER = [203, 213, 225];
const ZEBRA = [241, 245, 251];
const WARN = [185, 28, 28];

export const STAFF_NOTICE = "STAFF COPY: for internal use only. Do not share, forward or post this index.";

/** A faint diagonal "STAFF COPY · DO NOT SHARE" across the page, over the content. */
function drawStaffWatermark(pdf, pageW, pageH) {
	const lines = [
		{ text: "STAFF COPY", size: 64, offset: 0 },
		{ text: "DO NOT SHARE", size: 30, offset: 16 },
	];
	const angle = 35;
	const rad = (angle * Math.PI) / 180;
	let saved = false;
	try {
		pdf.saveGraphicsState();
		saved = true;
		pdf.setGState(new pdf.GState({ opacity: 0.07 }));
	} catch {
		// Without transparency it is drawn solid; still light grey.
	}
	pdf.setFont("helvetica", "bold");
	pdf.setTextColor(185, 28, 28);
	for (const l of lines) {
		pdf.setFontSize(l.size);
		const w = pdf.getTextWidth(l.text);
		// Centred on the page (jsPDF rotates text about its start point).
		const cx = pageW / 2 + Math.sin(rad) * l.offset;
		const cy = pageH / 2 + Math.cos(rad) * l.offset;
		pdf.text(l.text, cx - (w / 2) * Math.cos(rad), cy + (w / 2) * Math.sin(rad), { angle });
	}
	if (saved) pdf.restoreGraphicsState();
}

/** The printed name: General Studies is known by its course prefix. */
export function facultyLabel(name) {
	const clean = String(name || "").trim();
	return /^general studies$/i.test(clean) ? "General Studies (GST)" : clean;
}

/**
 * Alphabetical by subject ("Faculty of" ignored, so "Communications & Media
 * Studies" sits with "Faculty of Creative Arts"); special units such as DLI
 * and General Studies after the faculties.
 */
export function orderFaculties(faculties) {
	const key = (f) => f.label.replace(/^faculty of\s+/i, "").toLowerCase();
	return faculties
		.map((f) => ({ ...f, label: facultyLabel(f.name) }))
		.sort((a, b) => Number(!!a.is_special) - Number(!!b.is_special) || key(a).localeCompare(key(b)));
}

const fileSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/**
 * @param title     e.g. "2026/2027 First Semester Lecture Timetable"
 * @param sections  [{ heading, allUrl, code, verifyUrl, rows: [{ label, url | null }] }]
 *                  A row without a url is listed as not published.
 * @param siteUrl   the site's address, for the "download page" link
 * @returns jsPDF with `fileName` set
 */
export function buildIndexPDF({ title, sections, siteUrl, compress = true }) {
	const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress });
	const pageW = 210;
	const pageH = 297;
	const m = 22;
	const tableW = pageW - 2 * m;
	const colSnW = 17;
	const colLinkW = 51;
	const colNameW = tableW - colSnW - colLinkW;
	const xSn = m;
	const xName = m + colSnW;
	const xLink = xName + colNameW;
	const pad = 3;
	const bottom = pageH - 22;
	const site = siteUrl.replace(/\/$/, "");
	let y = 18;

	// ---- Masthead: crest, name, motto, gold rule, title ----
	const crest = 30;
	pdf.addImage(unilagLogoBase64, "PNG", (pageW - crest) / 2, y, crest, crest);
	y += crest + 9;
	pdf.setFont("times", "bold");
	pdf.setFontSize(22);
	pdf.setTextColor(...NAVY);
	pdf.text("UNIVERSITY OF LAGOS", pageW / 2, y, { align: "center" });
	y += 6;
	pdf.setFont("times", "italic");
	pdf.setFontSize(10.5);
	pdf.setTextColor(...MUTED);
	pdf.text("In Deed and In Truth", pageW / 2, y, { align: "center" });
	y += 5;
	pdf.setDrawColor(...GOLD);
	pdf.setLineWidth(0.7);
	pdf.line(m, y, pageW - m, y);
	y += 11;
	pdf.setFont("times", "bold");
	pdf.setFontSize(16);
	pdf.setTextColor(...INK);
	pdf.text(title.toUpperCase(), pageW / 2, y, { align: "center", maxWidth: tableW });
	y += 8;
	pdf.text("FINAL", pageW / 2, y, { align: "center" });
	y += 10;

	// ---- Intro, with the download page linked ----
	pdf.setFont("times", "normal");
	pdf.setFontSize(11.5);
	pdf.setTextColor(...INK);
	const lead = `This document presents the FINAL ${title.toLowerCase().replace(/ timetable$/, " timetables")}, as published on `
		+ "UniSchedule, the University's timetable platform. Each faculty below links to its timetable, which "
		+ "carries a QR code to check it. Every timetable can also be filtered by department and level on the";
	const lines = pdf.splitTextToSize(lead, tableW);
	pdf.text(lines, m, y, { lineHeightFactor: 1.35 });
	y += (lines.length - 1) * 5.6;
	// The link closes the last line of the paragraph, or starts a new one.
	const tail = "download page";
	const lastW = pdf.getTextWidth(lines[lines.length - 1] + " ");
	let linkX = m + lastW;
	if (linkX + pdf.getTextWidth(tail + ".") > pageW - m) {
		y += 5.6;
		linkX = m;
	}
	pdf.setTextColor(...LINK);
	pdf.textWithLink(tail, linkX, y, { url: `${site}/download` });
	const tw = pdf.getTextWidth(tail);
	pdf.setDrawColor(...LINK);
	pdf.setLineWidth(0.2);
	pdf.line(linkX, y + 0.9, linkX + tw, y + 0.9);
	pdf.setTextColor(...INK);
	pdf.text(".", linkX + tw, y);
	y += 12;

	// ---- Tables ----
	const headH = 9;
	const drawHead = () => {
		pdf.setFillColor(...NAVY);
		pdf.setDrawColor(...NAVY);
		pdf.setLineWidth(0.2);
		pdf.rect(m, y, tableW, headH, "FD");
		pdf.setDrawColor(255, 255, 255);
		pdf.line(xName, y, xName, y + headH);
		pdf.line(xLink, y, xLink, y + headH);
		pdf.setFont("times", "bold");
		pdf.setFontSize(11);
		pdf.setTextColor(255, 255, 255);
		pdf.text("S/N", xSn + colSnW / 2, y + 6, { align: "center" });
		pdf.text("Faculty / Unit", xName + pad, y + 6);
		pdf.text("Timetable", xLink + colLinkW / 2, y + 6, { align: "center" });
		y += headH;
	};

	const drawRow = (index, label, url, { zebra }) => {
		pdf.setFont("times", "normal");
		pdf.setFontSize(11);
		const nameLines = pdf.splitTextToSize(label, colNameW - 2 * pad);
		const h = Math.max(8.5, nameLines.length * 4.7 + 3.8);
		if (y + h > bottom) {
			pdf.addPage();
			y = 20;
			drawHead();
			pdf.setFont("times", "normal");
			pdf.setFontSize(11);
		}
		if (zebra) {
			pdf.setFillColor(...ZEBRA);
			pdf.rect(m, y, tableW, h, "F");
		}
		pdf.setDrawColor(...BORDER);
		pdf.setLineWidth(0.2);
		pdf.rect(m, y, tableW, h, "S");
		pdf.line(xName, y, xName, y + h);
		pdf.line(xLink, y, xLink, y + h);

		const mid = y + h / 2;
		const firstLine = mid - ((nameLines.length - 1) * 4.7) / 2 + 1.4;
		pdf.setTextColor(...INK);
		pdf.text(String(index), xSn + colSnW / 2, mid + 1.4, { align: "center" });
		if (url) {
			pdf.setTextColor(...LINK);
			pdf.text(nameLines, xName + pad, firstLine, { lineHeightFactor: 1.2 });
			pdf.link(xName, y, colNameW, h, { url });
			const text = "View timetable";
			const w = pdf.getTextWidth(text);
			const x = xLink + (colLinkW - w) / 2;
			pdf.text(text, x, mid + 1.4);
			pdf.setDrawColor(...LINK);
			pdf.line(x, mid + 2.3, x + w, mid + 2.3);
			pdf.link(xLink, y, colLinkW, h, { url });
		} else {
			pdf.text(nameLines, xName + pad, firstLine, { lineHeightFactor: 1.2 });
			pdf.setTextColor(...PENDING);
			pdf.text("Not published", xLink + colLinkW / 2, mid + 1.4, { align: "center" });
		}
		y += h;
	};

	sections.forEach((section, si) => {
		// A heading keeps at least its table header and two rows with it.
		if (y + 36 > bottom) {
			pdf.addPage();
			y = 20;
		}
		pdf.setFont("times", "bold");
		pdf.setFontSize(14);
		pdf.setTextColor(...NAVY);
		pdf.text(`${String.fromCharCode(65 + si)}. ${section.heading}`, m, y);
		y += 4;

		// FINAL version code and the all-faculties PDF, under the heading.
		pdf.setFont("times", "italic");
		pdf.setFontSize(9.5);
		let x = m;
		const piece = (text, url) => {
			pdf.setTextColor(...(url ? LINK : MUTED));
			if (url) pdf.textWithLink(text, x, y + 2.5, { url });
			else pdf.text(text, x, y + 2.5);
			x += pdf.getTextWidth(text);
		};
		if (section.allUrl) piece("All faculties in one PDF", section.allUrl);
		if (section.allUrl && section.code) piece("   ·   ", null);
		if (section.code) {
			piece("FINAL version ", null);
			piece(section.code, section.verifyUrl);
		}
		y += 6;

		if (!section.rows.length) {
			pdf.setFont("times", "italic");
			pdf.setFontSize(11);
			pdf.setTextColor(...MUTED);
			pdf.text("Not published yet.", m, y + 3);
			y += 12;
			return;
		}
		drawHead();
		section.rows.forEach((row, i) => drawRow(i + 1, row.label, row.url, { zebra: i % 2 === 1 }));
		y += 11;
	});

	// ---- Watermark and footer on every page ----
	// The index is for staff (the public download page has its own); the mark
	// says so on every page, so a forwarded or posted copy is plainly not for
	// circulation.
	const pages = pdf.getNumberOfPages();
	for (let p = 1; p <= pages; p++) {
		pdf.setPage(p);
		drawStaffWatermark(pdf, pageW, pageH);
		pdf.setFont("times", "italic");
		pdf.setFontSize(9);
		pdf.setTextColor(...MUTED);
		pdf.text(`University of Lagos · ${title} (FINAL) · UniSchedule`, m, pageH - 12);
		pdf.text(`Page ${p}`, pageW - m, pageH - 12, { align: "right" });
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(7.5);
		pdf.setTextColor(...WARN);
		pdf.text(STAFF_NOTICE, pageW / 2, pageH - 7, { align: "center" });
	}

	pdf.fileName = `${fileSlug(title)}_index.pdf`;
	return pdf;
}
