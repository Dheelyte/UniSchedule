'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { cleanScan } from '@/lib/scanCleanup';
import { useToast } from '@/components/Toast/Toast';
import styles from './signoffs.module.css';

const TYPES = [
	{ key: 'lecture', label: 'Lecture timetables', note: 'Printed on FINAL lecture timetable PDFs.' },
	{ key: 'exam', label: 'Exam timetables', note: 'Printed on FINAL exam and CBT timetable PDFs.' },
];
const FIELDS = ['signatory_name', 'signatory_title', 'signature_image', 'stamp_image'];

function changedFields(value, saved) {
	return Object.fromEntries(FIELDS.filter((f) => (value[f] ?? null) !== (saved[f] ?? null)).map((f) => [f, value[f] ?? null]));
}

function ImageField({ label, hint, value, onChange, maxSize, disabled }) {
	const inputRef = useRef(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [removeBackground, setRemoveBackground] = useState(true);

	const pick = async (e) => {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file) return;
		setBusy(true);
		setError('');
		try {
			onChange(await cleanScan(file, { maxSize, removeBackground }));
		} catch (err) {
			setError(err?.message || "Couldn't read that image.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={styles.imageField}>
			<span className={styles.label}>{label}</span>
			<div className={`${styles.imageBox} ${value ? '' : styles.imageBoxEmpty}`}>
				{value ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={value} alt={label} className={styles.imagePreview} />
				) : (
					<span className={styles.imagePlaceholder}>{busy ? 'Cleaning up the scan…' : 'No image yet'}</span>
				)}
			</div>
			<div className={styles.imageActions}>
				<button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()} disabled={busy || disabled}>
					{value ? 'Replace' : 'Upload scan'}
				</button>
				{value && (
					<button type="button" className="btn btn-secondary" onClick={() => onChange(null)} disabled={busy || disabled}>
						Remove
					</button>
				)}
				<input ref={inputRef} type="file" accept="image/png,image/jpeg" hidden onChange={pick} />
			</div>
			<label className={styles.checkbox}>
				<input type="checkbox" checked={removeBackground} onChange={(e) => setRemoveBackground(e.target.checked)} />
				Remove the paper background
			</label>
			<p className={styles.hint}>{hint}</p>
			{error && <p className={styles.error}>{error}</p>}
		</div>
	);
}

// A to-scale-ish preview of the strip printed at the bottom of each page.
function StripPreview({ value }) {
	return (
		<div className={styles.strip} aria-label="Preview of the PDF sign-off">
			<div className={styles.stripLeft}>
				<div className={styles.qr} aria-hidden="true">
					<span /><span /><span /><span />
				</div>
				<div>
					<div className={styles.stripFinal}>FINAL TIMETABLE</div>
					<div className={styles.stripVerify}>
						Verify this copy: <strong>www.unilagtimetable.com/verify/UG-XXXX-XXXX</strong>
					</div>
					<div className={styles.stripSmall}>Scan the code or visit the link to confirm this copy is genuine and current.</div>
				</div>
			</div>
			<div className={styles.stripRight}>
				{value.stamp_image && (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={value.stamp_image} alt="" className={styles.stripStamp} />
				)}
				<div className={styles.stripSign}>
					<div className={styles.stripSignature}>
						{value.signature_image && (
							// eslint-disable-next-line @next/next/no-img-element
							<img src={value.signature_image} alt="" />
						)}
					</div>
					<div className={styles.stripName}>{value.signatory_name || ' '}</div>
					<div className={styles.stripTitle}>{value.signatory_title}</div>
				</div>
			</div>
		</div>
	);
}

function SignoffCard({ type, value, saved, onChange, onSave, saving, copyTo }) {
	const dirty = Object.keys(changedFields(value, saved)).length > 0;
	const set = (field) => (v) => onChange({ ...value, [field]: v });
	return (
		<section className={styles.card}>
			<header className={styles.cardHeader}>
				<div>
					<h3 className={styles.cardTitle}>{type.label}</h3>
					<p className={styles.cardNote}>{type.note}</p>
				</div>
				{copyTo && (
					<button type="button" className="btn btn-secondary" onClick={copyTo.onCopy} disabled={saving}>
						Copy to {copyTo.label.toLowerCase()}
					</button>
				)}
			</header>

			<div className={styles.fields}>
				<label className={styles.field}>
					<span className={styles.label}>Signatory&apos;s name</span>
					<input
						className="form-input"
						value={value.signatory_name}
						maxLength={120}
						placeholder="e.g. Prof. A. B. Surname"
						onChange={(e) => set('signatory_name')(e.target.value)}
					/>
				</label>
				<label className={styles.field}>
					<span className={styles.label}>Title</span>
					<input
						className="form-input"
						value={value.signatory_title}
						maxLength={120}
						placeholder="e.g. Vice-Chancellor"
						onChange={(e) => set('signatory_title')(e.target.value)}
					/>
				</label>
			</div>

			<div className={styles.images}>
				<ImageField
					label="Signature"
					hint="Sign in dark ink on plain white paper, then scan or photograph it straight on."
					value={value.signature_image}
					onChange={set('signature_image')}
					maxSize={1000}
					disabled={saving}
				/>
				<ImageField
					label="Stamp"
					hint="Stamp on plain white paper. A round or square stamp prints best."
					value={value.stamp_image}
					onChange={set('stamp_image')}
					maxSize={700}
					disabled={saving}
				/>
			</div>

			<span className={styles.label}>Preview</span>
			<StripPreview value={value} />

			<footer className={styles.cardFooter}>
				{dirty && (
					<button type="button" className="btn btn-secondary" onClick={() => onChange(saved)} disabled={saving}>
						Discard changes
					</button>
				)}
				<button
					type="button"
					className="btn btn-primary"
					onClick={onSave}
					disabled={!dirty || saving || !value.signatory_title.trim()}
				>
					{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
				</button>
			</footer>
		</section>
	);
}

export default function SignoffsPage() {
	const router = useRouter();
	const { addToast } = useToast();
	const { user, loading: authLoading, realmName } = useAuth();
	const [saved, setSaved] = useState(null); // { lecture: {...}, exam: {...} }
	const [draft, setDraft] = useState(null);
	const [saving, setSaving] = useState(null);

	useEffect(() => {
		if (authLoading) return;
		if (!user) return;
		if (user.role !== 'SUPER_ADMIN') {
			router.push('/');
			addToast({ type: 'error', title: 'Unauthorized', message: 'Only Super Admins can manage signatures and stamps.' });
			return;
		}
		apiClient
			.get('/signoffs')
			.then((rows) => {
				const byType = Object.fromEntries(rows.map((r) => [r.timetable_type, r]));
				setSaved(byType);
				setDraft(byType);
			})
			.catch((e) => addToast({ type: 'error', title: 'Error', message: e?.message || 'Failed to load signatures and stamps.' }));
	}, [authLoading, user, router, addToast]);

	const save = async (key) => {
		const changes = changedFields(draft[key], saved[key]);
		setSaving(key);
		try {
			const row = await apiClient.put(`/signoffs/${key}`, changes);
			setSaved((s) => ({ ...s, [key]: row }));
			setDraft((d) => ({ ...d, [key]: row }));
			addToast({ type: 'success', title: 'Saved', message: `${TYPES.find((t) => t.key === key).label} will be signed with these from now on.` });
		} catch (e) {
			addToast({ type: 'error', title: "Couldn't save", message: e?.message || 'Nothing was changed.' });
		} finally {
			setSaving(null);
		}
	};

	if (!draft) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

	return (
		<div className={styles.page}>
			<div className={styles.intro}>
				<p>
					Every page of a <strong>FINAL</strong> (locked) {realmName || ''} timetable PDF carries the stamp, the
					signatory&apos;s signature, name and title, and a QR code anyone can scan to check the copy is genuine
					and current. Drafts get a <strong>DRAFT</strong> watermark instead. Changes apply to the next export;
					PDFs already downloaded keep what they were printed with.
				</p>
			</div>
			<div className={styles.cards}>
				{TYPES.map((type, i) => {
					const other = TYPES[1 - i];
					return (
						<SignoffCard
							key={type.key}
							type={type}
							value={draft[type.key]}
							saved={saved[type.key]}
							saving={saving === type.key}
							onChange={(v) => setDraft((d) => ({ ...d, [type.key]: v }))}
							onSave={() => save(type.key)}
							copyTo={{
								label: other.label,
								onCopy: () => setDraft((d) => ({
									...d,
									[other.key]: { ...d[other.key], ...Object.fromEntries(FIELDS.map((f) => [f, d[type.key][f]])) },
								})),
							}}
						/>
					);
				})}
			</div>
		</div>
	);
}
