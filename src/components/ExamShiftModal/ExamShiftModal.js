"use client";

import { useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { SHIFT_MODES, buildShiftRequest, describeShift, shortDate } from "@/lib/examShift";
import styles from "./ExamShiftModal.module.css";

const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

/**
 * Super admins move many exams at once (e.g. when exams are postponed).
 * The server skips Sundays, holidays and blocked slots; the admin always sees a
 * preview first, and the shift is applied in one go or not at all.
 */
export default function ExamShiftModal({ semesterId, faculties = [], onClose, onApplied }) {
	const [mode, setMode] = useState("days");
	const [amount, setAmount] = useState("1");
	const [direction, setDirection] = useState("later");
	const [newStartDate, setNewStartDate] = useState("");
	const [onlySome, setOnlySome] = useState(false);
	const [facultyIds, setFacultyIds] = useState([]);
	const [fromDate, setFromDate] = useState("");
	const [toDate, setToDate] = useState("");

	const [preview, setPreview] = useState(null);
	const [previewedBody, setPreviewedBody] = useState(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const request = useMemo(
		() =>
			buildShiftRequest({
				semesterId,
				mode,
				amount,
				direction,
				newStartDate,
				facultyIds: onlySome ? facultyIds : [],
				fromDate: onlySome ? fromDate : "",
				toDate: onlySome ? toDate : "",
			}),
		[semesterId, mode, amount, direction, newStartDate, onlySome, facultyIds, fromDate, toDate],
	);
	// A preview only counts for the exact choices it was made with.
	const previewIsCurrent = preview && previewedBody && JSON.stringify(previewedBody) === JSON.stringify(request.body);
	const canApply = previewIsCurrent && preview.moving > 0 && preview.clashes.length === 0 && !busy;

	const sortedFaculties = useMemo(
		() => [...faculties].sort((a, b) => a.name.localeCompare(b.name)),
		[faculties],
	);

	const toggleFaculty = (id) =>
		setFacultyIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

	const runPreview = async () => {
		if (request.error) return setError(request.error);
		setBusy(true);
		setError("");
		try {
			const result = await apiClient.post("/timetable/exams/shift/preview", request.body);
			setPreview(result);
			setPreviewedBody(request.body);
		} catch (e) {
			setPreview(null);
			setError(e?.message || "The preview couldn't be made.");
		} finally {
			setBusy(false);
		}
	};

	const apply = async () => {
		if (!canApply) return;
		setBusy(true);
		setError("");
		try {
			const result = await apiClient.post("/timetable/exams/shift", previewedBody);
			onApplied?.(result);
		} catch (e) {
			setError(e?.message || "The exams couldn't be moved. Nothing was changed.");
			setBusy(false);
		}
	};

	return (
		<>
			<div className={styles.overlay} onClick={busy ? undefined : onClose} />
			<div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="exam-shift-title">
				<div className={styles.header}>
					<h3 className={styles.title} id="exam-shift-title">
						Shift exams <span className="badge badge-primary" style={{ marginLeft: 6, fontSize: "0.65rem" }}>Beta</span>
					</h3>
					<button className={styles.closeBtn} onClick={onClose} aria-label="Close" disabled={busy}>
						✕
					</button>
				</div>

				<div className={styles.body}>
					<p className={styles.intro}>
						Move many exams at once, for example when exams are postponed. Sundays, holidays and blocked
						slots are skipped. Times and venues stay the same. You&apos;ll see a preview before anything changes.
					</p>

					<div className={styles.formGroup}>
						<span className={styles.label}>How far</span>
						<div className={styles.segmented} role="radiogroup" aria-label="How far">
							{SHIFT_MODES.map((m) => (
								<button
									key={m.key}
									type="button"
									role="radio"
									aria-checked={mode === m.key}
									className={`${styles.segment} ${mode === m.key ? styles.segmentActive : ""}`}
									onClick={() => setMode(m.key)}
									disabled={busy}>
									{m.label}
								</button>
							))}
						</div>
					</div>

					{mode === "start_date" ? (
						<div className={styles.formGroup}>
							<label className={styles.label} htmlFor="shift-start">
								New date for the first exam
							</label>
							<input
								id="shift-start"
								type="date"
								className={styles.input}
								value={newStartDate}
								onChange={(e) => setNewStartDate(e.target.value)}
								disabled={busy}
							/>
							<span className={styles.hint}>The other exams keep the same number of exam days between them.</span>
						</div>
					) : (
						<div className={styles.row}>
							<div className={styles.formGroup} style={{ flex: 1 }}>
								<label className={styles.label} htmlFor="shift-amount">
									{mode === "days" ? "Exam days" : "Weeks"}
								</label>
								<input
									id="shift-amount"
									type="number"
									min={1}
									max={60}
									inputMode="numeric"
									className={styles.input}
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									disabled={busy}
								/>
							</div>
							<div className={styles.formGroup} style={{ flex: 1 }}>
								<span className={styles.label}>Direction</span>
								<div className={styles.segmented} role="radiogroup" aria-label="Direction">
									{[
										["later", "Later"],
										["earlier", "Earlier"],
									].map(([key, label]) => (
										<button
											key={key}
											type="button"
											role="radio"
											aria-checked={direction === key}
											className={`${styles.segment} ${direction === key ? styles.segmentActive : ""}`}
											onClick={() => setDirection(key)}
											disabled={busy}>
											{label}
										</button>
									))}
								</div>
							</div>
						</div>
					)}
					{mode === "weeks" && (
						<span className={styles.hint}>Each exam keeps its weekday, unless that day is a holiday.</span>
					)}

					<label className={styles.checkRow}>
						<input type="checkbox" checked={onlySome} onChange={(e) => setOnlySome(e.target.checked)} disabled={busy} />
						Only shift some exams
					</label>

					{onlySome && (
						<div className={styles.filters}>
							<div className={styles.row}>
								<div className={styles.formGroup} style={{ flex: 1 }}>
									<label className={styles.label} htmlFor="shift-from">
										From
									</label>
									<input id="shift-from" type="date" className={styles.input} value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={busy} />
								</div>
								<div className={styles.formGroup} style={{ flex: 1 }}>
									<label className={styles.label} htmlFor="shift-to">
										To
									</label>
									<input id="shift-to" type="date" className={styles.input} value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={busy} />
								</div>
							</div>
							<span className={styles.hint}>Leave a date empty to include everything before or after.</span>

							<div className={styles.formGroup}>
								<span className={styles.label}>
									Faculties {facultyIds.length ? `(${facultyIds.length} chosen)` : "(all)"}
								</span>
								<div className={styles.facultyList}>
									{sortedFaculties.map((f) => (
										<label key={f.id} className={styles.checkRow}>
											<input type="checkbox" checked={facultyIds.includes(f.id)} onChange={() => toggleFaculty(f.id)} disabled={busy} />
											{f.name}
										</label>
									))}
								</div>
							</div>
						</div>
					)}

					{error && (
						<p className={styles.error} role="alert">
							{error}
						</p>
					)}

					{preview && (
						<div className={`${styles.preview} ${previewIsCurrent ? "" : styles.previewStale}`} aria-live="polite">
							{!previewIsCurrent && <p className={styles.hint}>You changed the choices. Preview again before applying.</p>}
							<p className={styles.summary}>{describeShift(preview)}</p>
							{preview.moving > 0 && (
								<p className={styles.hint}>
									First exam {shortDate(preview.first_date_before)} → {shortDate(preview.first_date_after)} · last exam{" "}
									{shortDate(preview.last_date_before)} → {shortDate(preview.last_date_after)}
								</p>
							)}

							{preview.clashes.length > 0 && (
								<div className={styles.problem}>
									<strong>
										{preview.clashes.length} exam{preview.clashes.length === 1 ? "" : "s"} would clash with another programme in a shared hall.
									</strong>{" "}
									Change the shift and preview again.
									<ul>
										{preview.clashes.slice(0, 5).map((c, i) => (
											<li key={i}>
												{c.course_code} on {shortDate(c.date)} {hhmm(c.start_time)}–{hhmm(c.end_time)} in {c.room} ({c.other_realm}: {c.other_course})
											</li>
										))}
									</ul>
								</div>
							)}

							{preview.pushed.length > 0 && (
								<div className={styles.note}>
									<strong>
										{preview.pushed.length} exam{preview.pushed.length === 1 ? "" : "s"} moved further to avoid a blocked time:
									</strong>
									<ul>
										{preview.pushed.slice(0, 5).map((p, i) => (
											<li key={i}>
												{p.course_code} {hhmm(p.start_time)}–{hhmm(p.end_time)}: {shortDate(p.from_date)} → {shortDate(p.to_date)} (avoids {p.reason})
											</li>
										))}
										{preview.pushed.length > 5 && <li>and {preview.pushed.length - 5} more</li>}
									</ul>
								</div>
							)}

							{preview.date_changes.length > 0 && (
								<details className={styles.changes}>
									<summary>Every date change ({preview.date_changes.length})</summary>
									<ul>
										{preview.date_changes.map((c, i) => (
											<li key={i}>
												{shortDate(c.from_date)} → {shortDate(c.to_date)}: {c.exams} exam{c.exams === 1 ? "" : "s"}
											</li>
										))}
									</ul>
								</details>
							)}

							{preview.undated > 0 && (
								<p className={styles.hint}>
									{preview.undated} older exam{preview.undated === 1 ? " has" : "s have"} no date and won&apos;t move.
								</p>
							)}
						</div>
					)}

					<div className={styles.footer}>
						<button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
							Cancel
						</button>
						<button type="button" className="btn btn-secondary" onClick={runPreview} disabled={busy}>
							{busy && !preview ? "Checking…" : previewIsCurrent ? "Preview again" : "Preview"}
						</button>
						<button type="button" className="btn btn-primary" onClick={apply} disabled={!canApply}>
							{busy && preview ? "Moving…" : canApply ? `Move ${preview.moving} exam${preview.moving === 1 ? "" : "s"}` : "Move exams"}
						</button>
					</div>
				</div>
			</div>
		</>
	);
}
