'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { defaultSelection, downloadableEntries, KINDS } from './entries';
import styles from './download.module.css';

// The site's own routes: they read the backend with its key and are cached.
async function getJson(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return response.json();
}

const KIND_LABEL = { lecture: 'Lectures', exam: 'Exams', cbt: 'CBT exams' };
const unique = (values) => [...new Set(values)];

const entryKey = (e) => `${e.realm_key}:${e.semester_id}:${e.kind}`;

// Public copies are always an A3 PDF of the whole week, in black and white
// (src/lib/exportRequest.js); the page offers which timetable and filters only.
// `initialPublished` is the list the server read for the page, if it could.
// Starting from the first selection at once (rather than after an effect)
// means the page opens with its choices filled in.
export default function DownloadForm({ initialPublished = null }) {
	const [published, setPublished] = useState(() =>
		initialPublished ? downloadableEntries(initialPublished) : null, // null while loading
	);
	const [first] = useState(() => defaultSelection(published || []));
	const [loadError, setLoadError] = useState(false);
	const [session, setSession] = useState(first.session);
	const [semester, setSemester] = useState(first.semester);
	const [kind, setKind] = useState(first.kind);
	const [realm, setRealm] = useState(first.realm);
	const [options, setOptions] = useState(null);
	const [optionsError, setOptionsError] = useState(false);
	const [faculty, setFaculty] = useState('ALL');
	const [department, setDepartment] = useState('ALL');
	const [level, setLevel] = useState('ALL');

	useEffect(() => {
		if (initialPublished) return;
		getJson('/api/export/catalogue')
			.then((rows) => setPublished(downloadableEntries(rows || [])))
			.catch(() => { setPublished([]); setLoadError(true); });
	}, [initialPublished]);

	// Each choice narrows the next: session, semester, timetable, programme.
	const all = published || [];
	const sessions = unique(all.map((e) => e.session_name));
	const semesters = unique(all.filter((e) => e.session_name === session).map((e) => e.semester_name));
	const inSemester = all.filter((e) => e.session_name === session && e.semester_name === semester);
	const kinds = KINDS.filter((k) => inSemester.some((e) => e.kind === k));
	const forKind = inSemester.filter((e) => e.kind === kind);
	const realms = forKind.map((e) => ({ key: e.realm_key, name: e.realm_name }));
	const entry = forKind.find((e) => e.realm_key === realm) || null;

	// Keep every choice valid as the ones before it change, starting with the newest.
	useEffect(() => { if (sessions.length && !sessions.includes(session)) setSession(sessions[0]); }, [sessions, session]);
	useEffect(() => { if (semesters.length && !semesters.includes(semester)) setSemester(semesters[0]); }, [semesters, semester]);
	useEffect(() => { if (kinds.length && !kinds.includes(kind)) setKind(kinds[0]); }, [kinds, kind]);
	useEffect(() => {
		if (realms.length && !realms.some((r) => r.key === realm)) setRealm(realms[0].key);
	}, [realms, realm]);
	const entryId = entry ? entryKey(entry) : '';

	// The faculties, departments and levels this timetable has something for.
	useEffect(() => {
		if (!entry) return;
		let cancelled = false;
		setOptions(null);
		setOptionsError(false);
		setFaculty('ALL');
		setDepartment('ALL');
		setLevel('ALL');
		const q = new URLSearchParams({ realm: entry.realm_key, semester: String(entry.semester_id), type: entry.kind });
		getJson(`/api/export/options?${q}`)
			.then((o) => !cancelled && setOptions(o))
			.catch(() => !cancelled && setOptionsError(true));
		return () => { cancelled = true; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [entryId]);

	const departments = (options?.departments || []).filter((d) => faculty === 'ALL' || d.faculty_id === faculty);
	useEffect(() => {
		if (department !== 'ALL' && !departments.some((d) => String(d.id) === department)) setDepartment('ALL');
	}, [departments, department]);

	const href = useMemo(() => {
		if (!entry) return null;
		// In the order /api/export expects, defaults left out (it redirects anything else).
		const q = new URLSearchParams({ realm: entry.realm_key, semester: String(entry.semester_id), type: entry.kind });
		if (faculty !== 'ALL') q.set('faculty', faculty);
		if (department !== 'ALL') q.set('department', department);
		if (level !== 'ALL') q.set('level', level);
		if (entry.code) q.set('code', entry.code);
		return `/api/export?${q}`;
	}, [entry, faculty, department, level]);

	return (
		<section className={styles.card}>
			<p className={styles.slot}>Lectures · Exams · CBT · FINAL only</p>
			<h2 className={styles.heading}>Choose your timetable</h2>

			{published === null && <p className={styles.muted}>Loading published timetables…</p>}
			{published !== null && published.length === 0 && (
				<p className={styles.notice}>
					{loadError
						? "The timetables couldn't be loaded. Check your connection and try again."
						: 'No timetables have been published yet. Check back once the timetable office releases them.'}
				</p>
			)}

			{all.length > 0 && (
				<div className={styles.form}>
					<div className={styles.row}>
						<label className={styles.field}>
							<span>Session</span>
							<select value={session} onChange={(e) => setSession(e.target.value)}>
								{sessions.map((v) => <option key={v} value={v}>{v}</option>)}
							</select>
						</label>
						<label className={styles.field}>
							<span>Semester</span>
							<select value={semester} onChange={(e) => setSemester(e.target.value)}>
								{semesters.map((v) => <option key={v} value={v}>{v}</option>)}
							</select>
						</label>
					</div>

					<div className={styles.segment} role="radiogroup" aria-label="Timetable">
						{kinds.map((k) => (
							<button
								key={k}
								type="button"
								role="radio"
								aria-checked={kind === k}
								className={kind === k ? styles.segmentOn : undefined}
								onClick={() => setKind(k)}
							>
								{KIND_LABEL[k]}
							</button>
						))}
					</div>


					{realms.length > 1 && (
						<label className={styles.field}>
							<span>Programme</span>
							<select value={realm} onChange={(e) => setRealm(e.target.value)}>
								{realms.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
							</select>
						</label>
					)}

					{optionsError && (
						<p className={styles.notice}>The filters couldn&apos;t be loaded. You can still download the whole timetable.</p>
					)}

					<div className={styles.row}>
						<label className={styles.field}>
							<span>Faculty</span>
							<select value={faculty} onChange={(e) => setFaculty(e.target.value)}>
								<option value="ALL">All faculties</option>
								{(options?.faculties || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
							</select>
						</label>
						<label className={styles.field}>
							<span>Department</span>
							<select value={department} onChange={(e) => setDepartment(e.target.value)}>
								<option value="ALL">All departments</option>
								{departments.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
							</select>
						</label>
						<label className={styles.field}>
							<span>Level</span>
							<select value={level} onChange={(e) => setLevel(e.target.value)}>
								<option value="ALL">All levels</option>
								{(options?.levels || []).map((l) => <option key={l} value={String(l)}>{l} Level</option>)}
							</select>
						</label>
					</div>

					{href && (
						<a className={styles.button} href={href} download>
							Download PDF
						</a>
					)}

					{entry?.code && (
						<p className={styles.small}>
							FINAL version <code className={styles.code}>{entry.code}</code> ·{' '}
							<Link href={`/verify/${entry.code}`}>check a printed copy</Link>
						</p>
					)}
				</div>
			)}
		</section>
	);
}
