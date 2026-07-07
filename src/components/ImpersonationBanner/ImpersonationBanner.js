"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { ROLE_LABELS } from "@/lib/roles";
import styles from "./ImpersonationBanner.module.css";

export default function ImpersonationBanner() {
	const { user, stopImpersonating } = useAuth();
	const [facultyName, setFacultyName] = useState(null);
	const [busy, setBusy] = useState(false);

	const impersonating = !!user?.impersonating;
	const facultyId = user?.faculty_id;

	// Resolve a friendly faculty name for the scope label. Impersonation
	// changes trigger a full reload, so this component always mounts fresh.
	useEffect(() => {
		if (!impersonating || !facultyId) return;
		let mounted = true;
		apiClient
			.get("/timetable/faculties?all=true")
			.then((res) => {
				if (!mounted) return;
				setFacultyName((res || []).find((f) => f.id === facultyId)?.name || null);
			})
			.catch(() => {});
		return () => {
			mounted = false;
		};
	}, [impersonating, facultyId]);

	if (!impersonating) return null;

	const handleExit = async () => {
		setBusy(true);
		try {
			await stopImpersonating();
		} catch {
			setBusy(false);
		}
	};

	return (
		<div className={styles.banner} role="status">
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
					<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
					<circle cx="12" cy="12" r="3" />
				</svg>
			</span>
			<span className={styles.text}>
				You are acting as{" "}
				<strong>{ROLE_LABELS[user.role] || user.role}</strong>
				{facultyId ? (
					<>
						{" "}
						for <strong>{facultyName || facultyId}</strong>
					</>
				) : null}
				. Actions are scoped to this role.
			</span>
			<button
				type="button"
				className={styles.exit}
				onClick={handleExit}
				disabled={busy}>
				{busy ? "Exiting…" : "Exit"}
			</button>
		</div>
	);
}
