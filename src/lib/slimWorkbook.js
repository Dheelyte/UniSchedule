// Some faculty workbooks carry tens of thousands of formatted but empty cells
// (one Law timetable is 10 MB zipped, 85 MB unzipped, for 170 filled cells).
// Before uploading an import, drop those cells and the rows they leave empty
// so the file fits the API's upload limit. Values, merges and sheets stay.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const SHEET = /^xl\/worksheets\/[^/]+\.xml$/;

export function slimSheetXml(xml) {
	return xml
		.replace(/<c\b[^>]*\/>/g, "")
		.replace(/<c\b[^>]*>\s*<\/c>/g, "")
		.replace(/<row\b[^>]*\/>/g, "")
		.replace(/<row\b[^>]*>\s*<\/row>/g, "");
}

// Bytes of an .xlsx in, bytes of the slimmed .xlsx out.
export function slimWorkbook(bytes) {
	const files = unzipSync(bytes);
	for (const [name, data] of Object.entries(files)) {
		if (SHEET.test(name)) files[name] = strToU8(slimSheetXml(strFromU8(data)));
	}
	return zipSync(files, { level: 6 });
}
