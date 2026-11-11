import { lastRealm, loginPath } from "./realm.js";

function getApiBaseUrl() {
	if (process.env.NEXT_PUBLIC_API_URL) {
		return process.env.NEXT_PUBLIC_API_URL;
	}

	// Keep local requests on the same site so SameSite=Lax session cookies
	// work whether the frontend is opened via localhost or 127.0.0.1.
	if (typeof window !== "undefined") {
		const { hostname } = window.location;
		if (hostname === "localhost" || hostname === "127.0.0.1") {
			return `http://${hostname}:8000/api/v1`;
		}
	}

	return "http://127.0.0.1:8000/api/v1";
}

// Reads are kept for a few minutes, so moving between sections doesn't load
// the same data again. Any write (POST, PUT, PATCH, DELETE: saving, signing in
// or out, switching realm) clears every kept read, so your own changes always
// show at once; a browser refresh starts clean. Someone else's edits show
// within READ_CACHE_MS, or on refresh. Sign-in checks and notifications
// (which are polled) are never kept.
const READ_CACHE_MS = 5 * 60 * 1000;
const NEVER_KEPT = ["/auth", "/notifications"];
const readCache = new Map(); // endpoint -> { at, promise }

export function clearReadCache() {
	readCache.clear();
}

function keepable(endpoint) {
	return typeof window !== "undefined" && !NEVER_KEPT.some((p) => endpoint.startsWith(p));
}

// Each caller gets its own copy: pages sort and edit what they're given.
const copy = (data) => (data == null ? data : structuredClone(data));

export const apiClient = {
	async request(endpoint, options = {}) {
		const url = `${getApiBaseUrl()}${endpoint}`;
		// A FormData body sets its own multipart Content-Type, boundary included.
		const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
		const headers = {
			...(isForm ? {} : { "Content-Type": "application/json" }),
			...options.headers,
		};

		const config = {
			...options,
			headers,
			credentials: "include",
		};

		const method = (options.method || "GET").toUpperCase();
		// Export tickets are POSTs but change nothing.
		const writes = method !== "GET" && !endpoint.startsWith("/export/");
		if (writes) clearReadCache();

		const response = await fetch(url, config);
		// A write that finished after a read started may have changed what that
		// read returns; drop anything kept in the meantime.
		if (writes) clearReadCache();

		if (!response.ok) {
			if (response.status === 401) clearReadCache();
			if (response.status === 401 && typeof window !== "undefined") {
				// Pages open to signed-out visitors (publicPaths and standalonePaths
				// in ClientLayout): their sign-in check is expected to 401.
				const path = window.location.pathname;
				if (
					!["/", "/login", "/register", "/forgot-password", "/realms", "/contributors", "/verify", "/download"].includes(path) &&
					!path.startsWith("/verify/")
				) {
					window.location.href = loginPath(lastRealm());
				}
			}

			let errorMsg = "An error occurred while communicating with the backend";
			try {
				const errorData = await response.json();
				errorMsg = errorData.detail || errorMsg;
			} catch (err) {}
			throw new Error(errorMsg);
		}

		if (response.status === 204) {
			return null;
		}

		return await response.json();
	},

	// `fresh: true` skips the kept copy (and replaces it).
	get(endpoint, { fresh = false, ...options } = {}) {
		if (!keepable(endpoint) || options.headers) {
			return this.request(endpoint, { method: "GET", ...options });
		}
		const kept = readCache.get(endpoint);
		if (!fresh && kept && Date.now() - kept.at < READ_CACHE_MS) {
			return kept.promise.then(copy);
		}
		const entry = { at: Date.now(), promise: null };
		entry.promise = this.request(endpoint, { method: "GET", ...options }).catch((error) => {
			// Never keep a failure.
			if (readCache.get(endpoint) === entry) readCache.delete(endpoint);
			throw error;
		});
		readCache.set(endpoint, entry);
		return entry.promise.then(copy);
	},

	post(endpoint, data, options = {}) {
		return this.request(endpoint, {
			method: "POST",
			body: JSON.stringify(data),
			...options,
		});
	},

	postForm(endpoint, formData, options = {}) {
		return this.request(endpoint, { method: "POST", body: formData, ...options });
	},

	put(endpoint, data, options = {}) {
		return this.request(endpoint, {
			method: "PUT",
			body: JSON.stringify(data),
			...options,
		});
	},

	patch(endpoint, data, options = {}) {
		return this.request(endpoint, {
			method: "PATCH",
			body: data ? JSON.stringify(data) : undefined,
			...options,
		});
	},

	delete(endpoint, options = {}) {
		return this.request(endpoint, { method: "DELETE", ...options });
	},
};
