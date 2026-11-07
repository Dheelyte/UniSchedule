"use client";

import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { apiClient } from "@/lib/apiClient";
import { getRealmConfig, rememberRealm } from "@/lib/realm";
import { SESSION_HINT_KEY } from "@/lib/site";
import { useRouter } from "next/navigation";

const AuthContext = createContext(null);

// Remembers in this browser whether someone was signed in, so the homepage can
// hide the landing page from them before React loads (see app/layout.js).
function setSessionHint(signedIn) {
	try {
		if (signedIn) {
			localStorage.setItem(SESSION_HINT_KEY, "1");
		} else {
			localStorage.removeItem(SESSION_HINT_KEY);
			document.documentElement.removeAttribute("data-session");
		}
	} catch {
		// Storage blocked (private mode): the landing page may flash; harmless.
	}
}

export function AuthProvider({ children }) {
	const [user, setUser] = useState(null);
	const [loading, setLoading] = useState(true);
	const router = useRouter();

	useEffect(() => {
		let mounted = true;
		apiClient
			.get("/auth/me")
			.then((res) => {
				if (mounted) {
					rememberRealm(res?.realm);
					setSessionHint(true);
					setUser(res);
					setLoading(false);
				}
			})
			.catch(() => {
				if (mounted) {
					setSessionHint(false);
					setUser(null);
					setLoading(false);
				}
			});
		return () => {
			mounted = false;
		};
	}, []);

	const login = async (email, password, realm) => {
		await apiClient.post("/auth/login", { email, password, realm });
		const user = await apiClient.get("/auth/me");
		rememberRealm(user?.realm);
		setSessionHint(true);
		setUser(user);
		router.push("/");
	};

	// Back to the public homepage. A full page load, so the layout can't first
	// redirect a protected page to the login screen, and no cached data from
	// the old session survives.
	const logout = async () => {
		await apiClient.post("/auth/logout", {});
		setSessionHint(false);
		window.location.href = "/";
	};

	// Super-admin impersonation. A hard navigation to the dashboard resets all
	// client-side data caches so every page re-fetches under the new scope.
	const assumeRole = async (role, facultyId = null) => {
		await apiClient.post("/auth/impersonate", { role, faculty_id: facultyId });
		window.location.href = "/";
	};

	const stopImpersonating = async () => {
		await apiClient.post("/auth/impersonate/stop", {});
		window.location.href = "/";
	};

	// Cross-realm roles only. Like assumeRole, a hard navigation drops every
	// client-side cache so nothing from the previous realm stays on screen.
	const switchRealm = async (key, redirectTo = "/") => {
		await apiClient.post("/auth/switch-realm", { realm: key });
		rememberRealm(key);
		window.location.href = redirectTo;
	};

	const realmConfig = useMemo(() => getRealmConfig(user), [user]);

	return (
		<AuthContext.Provider
			value={{
				user,
				loading,
				realm: user?.realm ?? null,
				realmName: user?.realm_name ?? null,
				realmConfig,
				login,
				logout,
				assumeRole,
				stopImpersonating,
				switchRealm,
			}}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	return useContext(AuthContext);
}
