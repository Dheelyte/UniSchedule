'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './verify.module.css';

const CODE_RE = /^[A-Z]+-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function normaliseCode(raw) {
	return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function formatDate(iso) {
	if (!iso) return '';
	return new Date(iso).toLocaleString('en-GB', {
		day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
	});
}

export function CodeForm({ initial = '' }) {
	const router = useRouter();
	const [code, setCode] = useState(initial);
	const valid = CODE_RE.test(normaliseCode(code));
	return (
		<form
			className={styles.form}
			onSubmit={(e) => {
				e.preventDefault();
				if (valid) router.push(`/verify/${normaliseCode(code)}`);
			}}
		>
			<label className={styles.formLabel} htmlFor="verify-code">Code printed on the timetable</label>
			<div className={styles.formRow}>
				<input
					id="verify-code"
					className={styles.input}
					value={code}
					onChange={(e) => setCode(e.target.value)}
					placeholder="e.g. UG-7K3P-92QD"
					autoCapitalize="characters"
					autoComplete="off"
					spellCheck={false}
				/>
				<button type="submit" className={styles.button} disabled={!valid}>Check</button>
			</div>
		</form>
	);
}

/** The column the verify pages sit in, under an introduction. */
export function Shell({ children }) {
	return (
		<div className={styles.shell}>
			<div className={styles.intro}>
				<p className={styles.slot}>Open to everyone · no sign-in</p>
				<p className={styles.introTitle}>
					Check a printed timetable, <mark>before you rely on it.</mark>
				</p>
			</div>
			{children}
		</div>
	);
}

const STATUS = {
	current: {
		tone: 'ok',
		heading: 'Genuine and current',
		body: (r) => `This is the current FINAL ${r.kind} for ${r.realm_name}, ${r.session_name} session, ${r.semester_name}.`,
	},
	reopened: {
		tone: 'warn',
		heading: 'Genuine, but may be out of date',
		body: (r) => `This was a FINAL ${r.kind}, but it was reopened for changes on ${formatDate(r.reopened_at)}. The printed copy may no longer match. Check with the timetable office or download the latest version.`,
	},
	superseded: {
		tone: 'warn',
		heading: 'Out of date',
		body: (r) => `This was a FINAL ${r.kind}, but a newer FINAL version was issued on ${formatDate(r.superseded_at)}. Use the newer version instead.`,
	},
};

export function Result({ code, result, error }) {
	if (error) {
		return (
			<section className={`${styles.card} ${styles.bad}`}>
				<span className={styles.badge}>Not recognised</span>
				<h1 className={styles.heading}>No FINAL timetable has this code</h1>
				<p className={styles.body}>
					<code className={styles.code}>{code}</code> doesn&apos;t match any timetable issued through UniSchedule.
					Check the code was typed exactly as printed. If it was, the document may not be genuine.
				</p>
				<CodeForm initial={code} />
			</section>
		);
	}
	const s = STATUS[result.status];
	const r = { ...result, kind: result.timetable_type === 'exam' ? 'examination timetable' : 'lecture timetable' };
	return (
		<section className={`${styles.card} ${s.tone === 'ok' ? styles.ok : styles.warn}`}>
			<span className={styles.badge}>{s.tone === 'ok' ? 'Verified' : 'Check needed'}</span>
			<h1 className={styles.heading}>{s.heading}</h1>
			<p className={styles.body}>{s.body(r)}</p>
			<dl className={styles.details}>
				<div><dt>Programme</dt><dd>{result.realm_name}</dd></div>
				<div><dt>Timetable</dt><dd>{result.timetable_type === 'exam' ? 'Examination' : 'Lecture'}</dd></div>
				<div><dt>Session</dt><dd>{result.session_name}</dd></div>
				<div><dt>Semester</dt><dd>{result.semester_name}</dd></div>
				<div><dt>Marked FINAL</dt><dd>{formatDate(result.locked_at)}</dd></div>
				<div><dt>Code</dt><dd><code className={styles.code}>{result.code}</code></dd></div>
			</dl>
			<p className={styles.small}>
				This check confirms which timetable the code belongs to and whether it is still the current version.
				Compare the details above with the printed copy.
			</p>
		</section>
	);
}
