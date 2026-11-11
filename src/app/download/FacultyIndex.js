'use client';

// The index of faculties, as a page: one row per faculty, with a download link
// for each programme (Undergraduate, ICE, ...) that has a FINAL timetable for
// it. The same faculty is named a little differently in each programme
// ("Faculty of Management Sciences" / "Faculty of Management Science"), so rows
// are matched by a normalised name rather than repeated per programme.
//
// Staff also have the printed index (a PDF, from the export window).
import { useEffect, useState } from 'react';
import { indexId } from './entries';
import styles from './download.module.css';

const KIND_TITLE = { lecture: 'Lecture', exam: 'Examination', cbt: 'CBT examination' };

/** "Faculty of Management Sciences" and "Management Science" give the same key. */
export function facultyKey(name) {
	return String(name || '')
		.toLowerCase()
		.replace(/^faculty of\s+/, '')
		.replace(/&/g, ' and ')
		.replace(/[^a-z\s]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
		.join(' ');
}

const displayName = (name) => (/^general studies$/i.test(String(name).trim()) ? 'General Studies (GST)' : name);

function downloadHref(entry, facultyId) {
	const q = new URLSearchParams({ realm: entry.realm_key, semester: String(entry.semester_id), type: entry.kind });
	if (facultyId) q.set('faculty', facultyId);
	if (entry.code) q.set('code', entry.code);
	return `/api/export?${q}`;
}

/**
 * @param entries  the published timetables for one session, semester and kind,
 *                 one per programme (from the download page's list)
 * @param initial  { id, optionsByRealm } read by the server for the page's
 *                 first selection, so the index is in the HTML search engines see
 */
export default function FacultyIndex({ entries, initial = null }) {
	const id = indexId(entries);
	const [optionsByRealm, setOptionsByRealm] = useState(() =>
		initial && initial.id === id ? initial.optionsByRealm : null,
	);
	const [failed, setFailed] = useState(false);
	const [loadedId, setLoadedId] = useState(() => (initial && initial.id === id ? id : null));

	useEffect(() => {
		if (!entries.length || loadedId === id) return;
		let cancelled = false;
		setOptionsByRealm(null);
		setFailed(false);
		Promise.all(
			entries.map((e) => {
				const q = new URLSearchParams({ realm: e.realm_key, semester: String(e.semester_id), type: e.kind });
				return fetch(`/api/export/options?${q}`)
					.then((r) => (r.ok ? r.json() : null))
					.catch(() => null);
			}),
		).then((all) => {
			if (cancelled) return;
			if (all.every((o) => !o)) setFailed(true);
			setOptionsByRealm(Object.fromEntries(entries.map((e, i) => [e.realm_key, all[i]])));
			setLoadedId(id);
		});
		return () => { cancelled = true; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [id]);

	if (!entries.length) return null;

	// Undergraduate first, then the other programmes by name.
	const programmes = [...entries].sort(
		(a, b) => Number(b.realm_key === 'UG') - Number(a.realm_key === 'UG') || a.realm_name.localeCompare(b.realm_name),
	);

	// One row per faculty, across programmes. Only faculties with something to
	// download are listed; a programme without that faculty shows a dash.
	const rows = new Map();
	for (const entry of programmes) {
		for (const f of optionsByRealm?.[entry.realm_key]?.faculties || []) {
			const key = facultyKey(f.name);
			if (!rows.has(key)) rows.set(key, { name: displayName(f.name), special: !!f.is_special, cells: {} });
			rows.get(key).cells[entry.realm_key] = f.id;
		}
	}
	const sorted = [...rows.entries()]
		.sort(([ka, a], [kb, b]) => Number(a.special) - Number(b.special) || ka.localeCompare(kb))
		.map(([, row]) => row);

	const first = entries[0];
	// e.g. "Faculty of Engineering, Undergraduate, 2026/2027 First Semester lecture timetable (PDF)"
	const describe = (who, p) =>
		`${who}, ${p.realm_name}, ${first.session_name} ${first.semester_name} ${KIND_TITLE[first.kind].toLowerCase()} timetable (PDF)`;
	return (
		<section className={styles.indexCard} aria-labelledby="faculty-index-heading">
			<h2 id="faculty-index-heading" className={styles.heading}>Index of faculties</h2>
			<p className={styles.body}>
				{first.session_name} {first.semester_name} {KIND_TITLE[first.kind]} timetable. Click a programme to
				download that faculty&apos;s timetable.
			</p>

			{optionsByRealm === null && <p className={styles.muted}>Loading faculties…</p>}
			{failed && <p className={styles.notice}>The faculties couldn&apos;t be loaded. Try again shortly.</p>}

			{optionsByRealm !== null && !failed && (
				<div className={styles.tableWrap}>
					<table className={styles.indexTable}>
						<thead>
							<tr>
								<th scope="col">Faculty</th>
								{programmes.map((p) => <th scope="col" key={p.realm_key}>{p.realm_name}</th>)}
							</tr>
						</thead>
						<tbody>
							<tr className={styles.allRow}>
								<th scope="row">All faculties</th>
								{programmes.map((p) => (
									<td key={p.realm_key}>
										<a href={downloadHref(p)} download title={describe('All faculties', p)}>Download</a>
									</td>
								))}
							</tr>
							{sorted.map((row) => (
								<tr key={row.name}>
									<th scope="row">{row.name}</th>
									{programmes.map((p) => (
										<td key={p.realm_key}>
											{row.cells[p.realm_key] ? (
												<a href={downloadHref(p, row.cells[p.realm_key])} download title={describe(row.name, p)}>
													Download
												</a>
											) : (
												<span className={styles.none} aria-label="Not available">—</span>
											)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
