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

export const apiClient = {
	async request(endpoint, options = {}) {
		const url = `${getApiBaseUrl()}${endpoint}`;
		const headers = {
			"Content-Type": "application/json",
			...options.headers,
		};

		const config = {
			...options,
			headers,
			credentials: "include",
		};

		const response = await fetch(url, config);
		// fetch(url, {
		// 	cre,
		// });

		if (!response.ok) {
			if (response.status === 401 && typeof window !== "undefined") {
				if (
					!["/", "/login", "/register", "/forgot-password", "/realms"].includes(
						window.location.pathname,
					)
				) {
					window.location.href = "/login";
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

	get(endpoint, options = {}) {
		return this.request(endpoint, { method: "GET", ...options });
	},

	post(endpoint, data, options = {}) {
		return this.request(endpoint, {
			method: "POST",
			body: JSON.stringify(data),
			...options,
		});
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
