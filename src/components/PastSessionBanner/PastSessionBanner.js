"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { TERMS_CHANGED_EVENT, newerSessionThan } from "@/lib/terms";
import styles from "./PastSessionBanner.module.css";

// Shown on every page while the current session is older than the newest one,
// so nobody edits an archived timetable thinking it is the live one.
export default function PastSessionBanner() {
	const { user } = useAuth();
	const [state, setState] = useState(null);

	useEffect(() => {
		if (!user) return;
		let mounted = true;
		const load = () =>
			apiClient
				.get("/calendar/sessions")
				.then((sessions) => {
					if (!mounted) return;
					const current = (sessions || []).find((s) => s.is_current);
					const newest = newerSessionThan(current, sessions || []);
					setState(newest ? { current, newest } : null);
				})
				.catch(() => {});
		load();
		window.addEventListener(TERMS_CHANGED_EVENT, load);
		return () => {
			mounted = false;
			window.removeEventListener(TERMS_CHANGED_EVENT, load);
		};
	}, [user]);

	if (!state) return null;

	return (
		<div className={styles.banner} role="alert">
			<span className={styles.icon} aria-hidden>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round">
					<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
					<line x1="12" y1="9" x2="12" y2="13" />
					<line x1="12" y1="17" x2="12.01" y2="17" />
				</svg>
			</span>
			<span className={styles.text}>
				<strong>{state.current.name}</strong> is a past session and is
				currently active. Its timetables are final — only change them to
				correct the archive. <strong>{state.newest.name}</strong> is the
				latest session.
			</span>
			{user?.role === "SUPER_ADMIN" && (
				<Link href="/terms" className={styles.action}>
					Manage terms
				</Link>
			)}
		</div>
	);
}
