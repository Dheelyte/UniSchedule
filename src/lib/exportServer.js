// Helpers for the export routes under src/app/api/export. Server only.

/** The backend's API address as the frontend server reaches it. */
export function apiBase() {
	return (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
}

/** A JSON error the download page (or a browser) can show, never cached. */
export function problem(message, status) {
	return new Response(JSON.stringify({ detail: message }), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

// A rendered FINAL timetable is cached at the edge, so repeat downloads of the
// same filters don't re-render. An hour keeps a re-locked timetable from being
// served stale for long; links from /download carry the version code anyway.
export const CACHE_FINAL = "public, max-age=0, s-maxage=3600, stale-while-revalidate=600";

// How long the frontend server reuses a public backend read. Timetables change
// only when they are locked or unlocked, so a few minutes is safe, and it means
// the database is read at most once per timetable per window, however many
// people download.
export const BACKEND_CACHE_SECONDS = 300;

/** Headers on every read this server makes for others: the key the backend asks for. */
function serverHeaders() {
	return process.env.PUBLIC_EXPORT_KEY ? { "X-Export-Key": process.env.PUBLIC_EXPORT_KEY } : {};
}

/**
 * GET a public backend read as JSON; null for a 404. Throws on other failures.
 * Sends PUBLIC_EXPORT_KEY: the backend answers its public reads only for this server.
 */
export async function getPublic(path) {
	const headers = serverHeaders();
	const response = await fetch(`${apiBase()}${path}`, { headers, next: { revalidate: BACKEND_CACHE_SECONDS } });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`${path}: ${response.status}`);
	return response.json();
}

/** JSON for the download page, cached at the edge like the backend reads behind it. */
export function jsonResponse(data) {
	return new Response(JSON.stringify(data), {
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": `public, max-age=60, s-maxage=${BACKEND_CACHE_SECONDS}`,
		},
	});
}

const PUBLISHED = "/public/timetables";

/** Every FINAL timetable in a live programme. */
export function getPublished() {
	return getPublic(PUBLISHED);
}

/** A published timetable's filter choices, or null if it isn't published. */
export function getOptions(realm, semesterId, kind) {
	return getPublic(`${PUBLISHED}/${encodeURIComponent(realm)}/${semesterId}/${kind}/options`);
}

/**
 * A signed-in user's export bundle, read with the ticket their page got from
 * the backend (POST /export/ticket). Never cached: drafts change, and signed
 * copies carry the signature and stamp.
 *
 * @returns {{ status: number, bundle?: object, detail?: string }}
 */
export async function getStaffBundle(semesterId, timetableType, ticket) {
	const response = await fetch(
		`${apiBase()}/export/staff-bundle?semester_id=${semesterId}&timetable_type=${timetableType}`,
		{ headers: { ...serverHeaders(), "X-Export-Ticket": ticket }, cache: "no-store" },
	);
	if (response.ok) return { status: 200, bundle: await response.json() };
	const detail = await response.json().then((b) => b?.detail).catch(() => null);
	return { status: response.status, detail: typeof detail === "string" ? detail : null };
}

/** A file download response. */
export function fileResponse({ data, contentType, fileName }, extraHeaders = {}) {
	const body = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": contentType,
			// Header values must be plain ASCII: anything else in a name becomes "_".
			"Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.-]+/g, "_")}"`,
			"Content-Length": String(body.byteLength),
			"Cache-Control": CACHE_FINAL,
			...extraHeaders,
		},
	});
}
