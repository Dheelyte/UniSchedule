"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { TERMS_CHANGED_EVENT, newerSessionInUse } from "@/lib/terms";
import styles from "./PastSessionBanner.module.css";

// Shown on every page while a newer session than the current one is in use,
// so nobody edits an archived timetable thinking it is the live one.
export default function PastSessionBanner() {
	const { user } = useAuth();
	const [state, setState] = useState(null);

	useEffect(() => {
		if (!user) return;
		let mounted = true;
		const load = async () => {
			try {
				const sessions = (await apiClient.get("/calendar/sessions")) || [];
				const current = sessions.find((s) => s.is_current);
				const newest = await newerSessionInUse(current, sessions, (id) =>
					apiClient.get(`/calendar/sessions/${id}/semesters`),
				);
				if (mounted) setState(newest ? { current, newest } : null);
			} catch {
				// The banner is advisory; leave it hidden if the calendar can't load.
			}
		};
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
					Manage sessions
				</Link>
			)}
		</div>
	);
}
