"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { isCrossRealmRole } from "@/lib/roles";
import styles from "./RealmSwitcher.module.css";

export default function RealmSwitcher() {
	const { user, realm, realmName, switchRealm } = useAuth();
	const [open, setOpen] = useState(false);
	const [realms, setRealms] = useState([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const rootRef = useRef(null);

	// Judged by the real role: an assumed role keeps the realm it started in,
	// and switching ends the impersonation.
	const canSwitch = isCrossRealmRole(user?.real_role);

	// Load the realm list the first time the menu opens.
	useEffect(() => {
		if (!open || realms.length > 0) return;
		let mounted = true;
		apiClient
			.get("/realms")
			.then((res) => mounted && setRealms(res || []))
			.catch(() => mounted && setError("Could not load programmes."));
		return () => {
			mounted = false;
		};
	}, [open, realms.length]);

	// Close on outside click.
	useEffect(() => {
		if (!open) return;
		const onClick = (e) => {
			if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
		};
		document.addEventListener("mousedown", onClick);
		return () => document.removeEventListener("mousedown", onClick);
	}, [open]);

	if (!canSwitch) return null;

	const handleSwitch = async (key) => {
		if (key === realm) {
			setOpen(false);
			return;
		}
		setError("");
		setBusy(true);
		try {
			await switchRealm(key);
			// switchRealm hard-navigates on success; nothing else to do.
		} catch (e) {
			setError(e?.message || "Could not switch programme.");
			setBusy(false);
		}
	};

	return (
		<div className={styles.root} ref={rootRef}>
			<button
				type="button"
				className={styles.trigger}
				onClick={() => setOpen((v) => !v)}
				title="Switch programme">
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round">
					<polyline points="17 1 21 5 17 9" />
					<path d="M3 11V9a4 4 0 0 1 4-4h14" />
					<polyline points="7 23 3 19 7 15" />
					<path d="M21 13v2a4 4 0 0 1-4 4H3" />
				</svg>
				<span className={styles.triggerLabel}>{realmName || realm}</span>
			</button>

			{open && (
				<div className={styles.menu} role="dialog" aria-label="Switch programme">
					<span className={styles.menuLabel}>Programme</span>
					{realms.map((r) => (
						<button
							key={r.key}
							type="button"
							className={`${styles.option} ${r.key === realm ? styles.optionActive : ""}`}
							onClick={() => handleSwitch(r.key)}
							disabled={busy}>
							<span>{r.name}</span>
							{r.key === realm ? (
								<span className={styles.tag}>Current</span>
							) : (
								!r.is_live && <span className={styles.tag}>Not live</span>
							)}
						</button>
					))}
					{user?.impersonating && (
						<div className={styles.note}>Switching returns you to your own role.</div>
					)}
					{error && <div className={styles.error}>{error}</div>}
				</div>
			)}
		</div>
	);
}
