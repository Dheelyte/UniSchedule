// "Mask emails" for the Activity Logs export: every address in the file, wherever
// it appears (users, inviters, descriptions, details), becomes w***m@domain.
// Grouping and counting happen on the server with the real addresses, so
// masking never merges two people.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** "wisdom@unilag.edu.ng" -> "w***m@unilag.edu.ng"; a one- or two-letter name keeps its first letter only. */
export function maskEmail(email) {
	const at = email.lastIndexOf("@");
	const local = email.slice(0, at);
	const domain = email.slice(at);
	if (local.length <= 2) return `${local[0] || ""}***${domain}`;
	return `${local[0]}***${local[local.length - 1]}${domain}`;
}

/** Every email in a string masked; anything that isn't a string unchanged. */
export function maskText(value) {
	return typeof value === "string" ? value.replace(EMAIL, (m) => maskEmail(m)) : value;
}

/** Every string inside a value (objects and arrays included) masked. Keys are left alone. */
export function maskDeep(value) {
	if (typeof value === "string") return maskText(value);
	if (Array.isArray(value)) return value.map(maskDeep);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
	}
	return value;
}
