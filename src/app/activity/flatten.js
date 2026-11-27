// The JSON details (extra) of a log entry as Raw data columns.
//
// The server lists the columns first (detail_keys in /audit/export/analysis):
// each key, and each key of a nested object as "key.sub". This splits one
// entry's details the same way:
// - deeper values, arrays and empty objects stay as JSON in their column;
// - details that aren't an object (older entries) go to the "details" column;
// - keys past the column limit share the "details (other)" column.

export const DETAILS_COLUMN = "details";
export const OTHER_COLUMN = "details (other)";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function cell(value) {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return value;
}

/** { column: value } for one entry's details, given the export's detail columns. */
export function flattenDetails(extra, keys) {
	if (extra === null || extra === undefined) return {};
	if (!isPlainObject(extra)) return { [DETAILS_COLUMN]: typeof extra === "string" ? extra : JSON.stringify(extra) };
	const known = keys instanceof Set ? keys : new Set(keys || []);
	const out = {};
	const other = {};
	for (const [key, value] of Object.entries(extra)) {
		if (isPlainObject(value) && Object.keys(value).length > 0) {
			for (const [sub, subValue] of Object.entries(value)) {
				const path = `${key}.${sub}`;
				if (known.has(path)) out[path] = cell(subValue);
				else other[path] = subValue;
			}
		} else if (known.has(key)) {
			out[key] = cell(value);
		} else {
			other[key] = value;
		}
	}
	if (Object.keys(other).length > 0) out[OTHER_COLUMN] = JSON.stringify(other);
	return out;
}
