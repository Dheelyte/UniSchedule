// Runs one Activity Logs export: POST /audit/export (logged, rate-limited, returns
// a token), then the analysis, then the raw rows page by page, each page written
// straight into the file. The API is passed in ({ post, get }), so the same code
// runs against apiClient in the browser and a stand-in in `node --test`.
import { toExportFilters } from "./filters.js";
import { PDF_APPENDIX_LIMIT, buildReport, rawWriter, writeFiltersSheet, writeSheet } from "./report.js";
import { createWorkbook } from "./xlsx.js";

/** XLSX exports over this many rows run as a background job in the tab. */
export const BACKGROUND_THRESHOLD = 50000;
export const ROWS_PAGE = 5000;
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function needsBackground({ format, events }) {
	return format === "xlsx" && events > BACKGROUND_THRESHOLD;
}

function abortError() {
	const error = new Error("The export was cancelled.");
	error.name = "AbortError";
	return error;
}

function check(signal) {
	if (signal?.aborted) throw abortError();
}

/** Ask for the export: the server validates it, logs it and returns its token. */
export function requestExport(api, { filters, format, sections, mask }) {
	return api.post("/audit/export", { filters: toExportFilters(filters), format, sections, mask_emails: Boolean(mask) });
}

/** Read raw rows page by page (oldest first), up to `limit`. */
async function eachPage(api, headers, onRows, { signal, limit = Infinity }) {
	let after = null;
	let total = 0;
	do {
		check(signal);
		const params = new URLSearchParams({ limit: String(Math.min(ROWS_PAGE, limit - total)) });
		if (after) params.set("after", after);
		const page = await api.get(`/audit/export/rows?${params}`, headers);
		check(signal);
		onRows(page.rows);
		total += page.rows.length;
		after = page.next;
	} while (after && total < limit);
	return total;
}

/**
 * Build the file for a requested export.
 * Returns { fileName, type, chunks } (new Blob(chunks, { type }) in the browser).
 */
export async function buildExportFile(api, { started, filters, options, roleLabels, mask, note, onProgress = () => {}, signal, loadPdf }) {
	const headers = { "X-Export-Token": started.token };
	const analysis = await api.get("/audit/export/analysis", headers);
	check(signal);
	const report = buildReport({ started, analysis, filters, options, roleLabels, mask, note });
	const hasRaw = started.sections.includes("raw");

	if (started.format === "xlsx") {
		const workbook = createWorkbook();
		for (const sheet of report.sheets) writeSheet(workbook, sheet);
		const raw = rawWriter(workbook, report);
		if (hasRaw && started.events > 0) {
			let done = 0;
			await eachPage(api, headers, (rows) => {
				raw.add(rows);
				done += rows.length;
				onProgress(done, started.events);
			}, { signal });
		}
		raw.end();
		writeFiltersSheet(workbook, report);
		return { fileName: started.file_name, type: XLSX_TYPE, chunks: workbook.finish() };
	}

	const appendix = [];
	if (hasRaw && started.events > 0) {
		await eachPage(api, headers, (rows) => {
			appendix.push(...rows);
			onProgress(appendix.length, Math.min(started.events, PDF_APPENDIX_LIMIT));
		}, { signal, limit: PDF_APPENDIX_LIMIT });
	}
	check(signal);
	const { buildPdfReport } = await (loadPdf ? loadPdf() : import("./pdfReport.js"));
	const pdf = buildPdfReport(report, { appendix });
	return { fileName: started.file_name, type: "application/pdf", chunks: [new Uint8Array(pdf.output("arraybuffer"))] };
}
