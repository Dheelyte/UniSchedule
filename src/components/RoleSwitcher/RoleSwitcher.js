"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/lib/apiClient";
import {
	ROLE_LABELS,
	IMPERSONABLE_ROLES,
	isFacultyScopedRole,
} from "@/lib/roles";
import styles from "./RoleSwitcher.module.css";

export default function RoleSwitcher() {
	const { user, assumeRole, stopImpersonating } = useAuth();
	const [open, setOpen] = useState(false);
	const [role, setRole] = useState(IMPERSONABLE_ROLES[0]);
	const [facultyId, setFacultyId] = useState("");
	const [faculties, setFaculties] = useState([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const rootRef = useRef(null);

	// Only real super admins can assume roles.
	const isSuperAdmin = user?.real_role === "SUPER_ADMIN";
	const impersonating = !!user?.impersonating;

	// Load the full faculty list (unscoped) the first time the menu opens.
	useEffect(() => {
		if (!open || faculties.length > 0) return;
		let mounted = true;
		apiClient
			.get("/timetable/faculties?all=true")
			.then((res) => mounted && setFaculties(res || []))
			.catch(() => mounted && setFaculties([]));
		return () => {
			mounted = false;
		};
	}, [open, faculties.length]);

	// Close on outside click.
	useEffect(() => {
		if (!open) return;
		const onClick = (e) => {
			if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
		};
		document.addEventListener("mousedown", onClick);
		return () => document.removeEventListener("mousedown", onClick);
	}, [open]);

	if (!isSuperAdmin) return null;

	const needsFaculty = isFacultyScopedRole(role);

	const handleAssume = async () => {
		setError("");
		if (needsFaculty && !facultyId) {
			setError("Select a faculty to continue.");
			return;
		}
		setBusy(true);
		try {
			await assumeRole(role, needsFaculty ? facultyId : null);
			// assumeRole hard-navigates on success; nothing else to do.
		} catch (e) {
			setError(e?.message || "Could not switch role.");
			setBusy(false);
		}
	};

	const handleStop = async () => {
		setBusy(true);
		try {
			await stopImpersonating();
		} catch (e) {
			setError(e?.message || "Could not exit.");
			setBusy(false);
		}
	};

	const currentFacultyName =
		faculties.find((f) => f.id === user?.faculty_id)?.name || user?.faculty_id;

	const triggerLabel = impersonating
		? `Acting as ${ROLE_LABELS[user.role] || user.role}${
				user.faculty_id ? ` · ${currentFacultyName}` : ""
		  }`
		: "View as…";

	return (
		<div className={styles.root} ref={rootRef}>
			<button
				type="button"
				className={`${styles.trigger} ${impersonating ? styles.triggerActive : ""}`}
				onClick={() => setOpen((v) => !v)}
				title="Assume another role">
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round">
					<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
					<circle cx="9" cy="7" r="4" />
					<path d="M22 21v-2a4 4 0 0 0-3-3.87" />
					<path d="M16 3.13a4 4 0 0 1 0 7.75" />
				</svg>
				<span className={styles.triggerLabel}>{triggerLabel}</span>
			</button>

			{open && (
				<div className={styles.menu} role="dialog" aria-label="Assume role">
					{impersonating && (
						<div className={styles.currentRow}>
							<span className={styles.currentText}>
								Currently acting as{" "}
								<strong>{ROLE_LABELS[user.role] || user.role}</strong>
								{user.faculty_id ? ` · ${currentFacultyName}` : ""}
							</span>
							<button
								type="button"
								className={styles.exitBtn}
								onClick={handleStop}
								disabled={busy}>
								Return to Super Admin
							</button>
						</div>
					)}

					<label className={styles.field}>
						<span className={styles.fieldLabel}>Assume role</span>
						<select
							className={styles.select}
							value={role}
							onChange={(e) => {
								setRole(e.target.value);
								setError("");
							}}>
							{IMPERSONABLE_ROLES.map((r) => (
								<option key={r} value={r}>
									{ROLE_LABELS[r] || r}
								</option>
							))}
						</select>
					</label>

					{needsFaculty && (
						<label className={styles.field}>
							<span className={styles.fieldLabel}>Faculty</span>
							<select
								className={styles.select}
								value={facultyId}
								onChange={(e) => {
									setFacultyId(e.target.value);
									setError("");
								}}>
								<option value="">Select a faculty…</option>
								{faculties.map((f) => (
									<option key={f.id} value={f.id}>
										{f.name}
									</option>
								))}
							</select>
						</label>
					)}

					{error && <div className={styles.error}>{error}</div>}

					<button
						type="button"
						className={styles.assumeBtn}
						onClick={handleAssume}
						disabled={busy}>
						{busy ? "Switching…" : "Assume role"}
					</button>
				</div>
			)}
		</div>
	);
}
