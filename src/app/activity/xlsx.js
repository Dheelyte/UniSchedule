// A small streaming .xlsx writer on fflate (already a dependency), for the
// Activity Logs export. Rows go into the zip as they arrive, so a large Raw data
// sheet never has to sit in memory as one string.
//
// Text is always written as an inline string, never as a formula, and text that
// starts with = + - @, a tab or a carriage return gets a leading ' so it can't
// turn into a formula if the sheet is later saved as CSV and reopened.
//
// No DOM, no path aliases: it runs in the browser and in `node --test`.
import { Zip, ZipDeflate, strToU8 } from "fflate";

export const MAX_SHEET_ROWS = 1048576; // Excel's limit, header included
const MAX_CELL_TEXT = 32767;
const FORMULA_START = /^[=+\-@\t\r]/;
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Text that would start a formula, with a leading ' so it stays text. */
export function escapeFormula(text) {
	return FORMULA_START.test(text) ? `'${text}` : text;
}

function xmlEscape(text) {
	return text.replace(BAD_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnName(index) {
	let n = index + 1;
	let name = "";
	while (n > 0) {
		const r = (n - 1) % 26;
		name = String.fromCharCode(65 + r) + name;
		n = Math.floor((n - 1) / 26);
	}
	return name;
}

function cellXml(value, ref, style) {
	if (value === null || value === undefined || value === "") return "";
	if (typeof value === "number") {
		return Number.isFinite(value) ? `<c r="${ref}"${style}><v>${value}</v></c>` : "";
	}
	let text = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
	if (text.length > MAX_CELL_TEXT) text = `${text.slice(0, MAX_CELL_TEXT - 1)}…`;
	return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(escapeFormula(text))}</t></is></c>`;
}

/** A sheet name Excel accepts: at most 31 characters, none of []:*?/\, unique. */
function sheetName(name, taken) {
	const base = String(name).replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
	let candidate = base;
	for (let i = 2; taken.has(candidate.toLowerCase()); i++) {
		const suffix = ` (${i})`;
		candidate = base.slice(0, 31 - suffix.length) + suffix;
	}
	taken.add(candidate.toLowerCase());
	return candidate;
}

const STYLES = `${HEAD}<styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * A workbook written sheet by sheet: open a sheet, add rows, end it, open the
 * next. finish() returns the file as an array of byte chunks (new Blob(chunks)
 * in the browser).
 */
export function createWorkbook() {
	const chunks = [];
	let failure = null;
	const zip = new Zip((err, data) => {
		if (err) failure = err;
		else chunks.push(data);
	});
	const sheets = [];
	const taken = new Set();
	let open = null;

	function addFile(path, text) {
		const file = new ZipDeflate(path, { level: 6 });
		zip.add(file);
		file.push(strToU8(text), true);
	}

	function sheet(name, { widths = [], freezeHeader = false } = {}) {
		if (open) open.end();
		const index = sheets.length + 1;
		sheets.push({ name: sheetName(name, taken), index });
		const file = new ZipDeflate(`xl/worksheets/sheet${index}.xml`, { level: 6 });
		zip.add(file);
		let buffer = `${HEAD}<worksheet ${NS} ${NS_R}>`;
		if (freezeHeader) {
			buffer += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
		}
		if (widths.length) {
			buffer += `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
		}
		buffer += "<sheetData>";
		let rows = 0;
		const flush = (final) => {
			file.push(strToU8(buffer), final);
			buffer = "";
		};
		const handle = {
			get rows() {
				return rows;
			},
			get full() {
				return rows >= MAX_SHEET_ROWS;
			},
			addRow(cells, { bold = false } = {}) {
				if (rows >= MAX_SHEET_ROWS) throw new Error("This sheet is full.");
				rows += 1;
				const style = bold ? ' s="1"' : "";
				let xml = `<row r="${rows}">`;
				for (let i = 0; i < cells.length; i++) xml += cellXml(cells[i], `${columnName(i)}${rows}`, style);
				buffer += `${xml}</row>`;
				if (buffer.length > 1 << 20) flush(false);
			},
			end() {
				if (open !== handle) return;
				buffer += "</sheetData></worksheet>";
				flush(true);
				open = null;
			},
		};
		open = handle;
		return handle;
	}

	function finish() {
		if (open) open.end();
		if (sheets.length === 0) sheet("Sheet1").end();
		const overrides = sheets
			.map((s) => `<Override PartName="/xl/worksheets/sheet${s.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
			.join("");
		addFile(
			"[Content_Types].xml",
			`${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`,
		);
		addFile(
			"_rels/.rels",
			`${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		);
		addFile(
			"xl/workbook.xml",
			`${HEAD}<workbook ${NS} ${NS_R}><sheets>${sheets
				.map((s) => `<sheet name="${xmlEscape(s.name)}" sheetId="${s.index}" r:id="rId${s.index}"/>`)
				.join("")}</sheets></workbook>`,
		);
		addFile(
			"xl/_rels/workbook.xml.rels",
			`${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
				.map((s) => `<Relationship Id="rId${s.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.index}.xml"/>`)
				.join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
		);
		addFile("xl/styles.xml", STYLES);
		zip.end();
		if (failure) throw failure;
		return chunks;
	}

	return { sheet, finish, get sheetNames() { return sheets.map((s) => s.name); } };
}

/** The chunks as one Uint8Array (tests, and anywhere without Blob). */
export function concatChunks(chunks) {
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}
