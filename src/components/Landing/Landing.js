'use client';

// The homepage for signed-out visitors (src/app/page.js shows the dashboard to
// staff). UniSchedule is a product built for the University of Lagos, not by
// it: the product is the brand here, and the university is who it serves.
//
// Bold and editorial, but everything on the page tells a visitor something or
// takes them somewhere: no particles, tickers, invented statistics or motion.
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Bricolage_Grotesque, JetBrains_Mono } from 'next/font/google';
import styles from './Landing.module.css';
import { loginPath } from '@/lib/realm';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';

// Display type for headings, and a monospace for the small labels.
const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '800'], variable: '--font-display', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['500'], variable: '--font-label', display: 'swap' });

/* ---------- Content ---------- */

// Real facts about what it covers, not marketing numbers.
const FACTS = [
	{ figure: '3', label: 'Timetable types', detail: 'Lectures, examinations and CBT.' },
	{ figure: '2', label: 'Programmes', detail: 'Undergraduate and ICE, each with its own calendar.' },
	{ figure: 'A3', label: 'Print-ready PDFs', detail: 'Every copy checkable by its QR code.' },
];

const FEATURES = [
	{
		title: 'Clash checks',
		description: 'Every lecture and exam is checked against rooms, courses and the students who take them, as it is placed. Exams may share a hall; lectures may not.',
	},
	{
		title: 'Course priority',
		description: 'University-wide and interfaculty courses take precedence, so a clash says which class has to move.',
	},
	{
		title: 'Protected dates',
		description: 'Holidays and blocked slots are set once for the semester, and nothing can be placed on them.',
	},
	{
		title: 'Imports',
		description: 'Bring in a faculty\'s Excel or Word timetable, or copy last semester\'s. Imports are previewed, checked for clashes and can be undone.',
	},
	{
		title: 'CBT timetables',
		description: 'Computer-based exams have their own timetable, run by CITS, with CBT centres checked like any other room.',
	},
	{
		title: 'Shared halls',
		description: 'Undergraduate and ICE keep their own rooms. A hall both use is checked across both, so it is never booked twice.',
	},
	{
		title: 'Public downloads',
		description: 'Anyone can download a FINAL timetable as an A3 PDF, by faculty, department and level, without an account.',
	},
	{
		title: 'Verified copies',
		description: 'A FINAL timetable carries the approving officer\'s name and a QR code that confirms a printed copy is genuine and current. Drafts are marked as drafts.',
	},
	{
		title: 'Access by office',
		description: 'Timetable officers, faculty editors, GS and CITS administrators and exam officers each change only what is theirs.',
	},
];

const STEPS = [
	{
		title: 'Set up the semester',
		description: 'Faculties, departments, courses and rooms, then import existing timetables or copy an earlier semester.',
	},
	{
		title: 'Set the rules',
		description: 'Each course\'s scope, the semester\'s holidays and blocked slots. Every timetable is checked against them.',
	},
	{
		title: 'Lock and publish',
		description: 'Place lectures and exams, fix what is flagged, then lock the FINAL version. It is available to download at once.',
	},
];

// Structured data for search engines: a web application for the University
// of Lagos (its audience), not one the university publishes.
const STRUCTURED_DATA = {
	'@context': 'https://schema.org',
	'@type': 'WebApplication',
	name: SITE_NAME,
	alternateName: 'UNILAG Timetable Manager',
	url: `${SITE_URL}/`,
	description: SITE_DESCRIPTION,
	applicationCategory: 'EducationalApplication',
	operatingSystem: 'Web',
	inLanguage: 'en',
	audience: {
		'@type': 'EducationalAudience',
		audienceType: 'Students and staff of the University of Lagos',
	},
};

const pad = (n) => String(n).padStart(2, '0');

/*
 * Below the hero, sections fade and rise a little the first time they scroll
 * into view. Nothing is hidden until this runs (so the page reads fine without
 * scripts), nothing already on screen is hidden, each item plays once, and it
 * is off for people who ask their device to reduce motion.
 */
function useReveal(rootRef) {
	useEffect(() => {
		const root = rootRef.current;
		if (!root || !('IntersectionObserver' in window)) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const items = [...root.querySelectorAll('[data-reveal]')];
		// What is on screen now stays visible: no flash on load.
		for (const el of items) {
			if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.revealed = '';
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					entry.target.dataset.revealed = '';
					observer.unobserve(entry.target);
				}
			},
			{ rootMargin: '0px 0px -8% 0px' },
		);
		for (const el of items) if (!('revealed' in el.dataset)) observer.observe(el);
		root.dataset.motion = '';
		return () => observer.disconnect();
	}, [rootRef]);
}

/*
 * What the product does, at a glance: a few lectures on a timetable grid with
 * one clash flagged, as an officer would see it. An illustration (the codes
 * and rooms are examples), so it is described for screen readers as one.
 */
const PREVIEW_DAYS = ['Mon', 'Tue', 'Wed'];
const PREVIEW_TIMES = ['8:00', '10:00', '12:00'];
const PREVIEW_CELLS = {
	'Mon-8:00': { code: 'CSC 201', room: 'LT 1' },
	'Mon-12:00': { code: 'MTH 203', room: 'Main Aud.' },
	'Tue-8:00': { code: 'PHY 211', room: 'LT 2' },
	'Tue-10:00': { code: 'STA 201 · CSC 203', room: 'Both in LT 1', clash: true },
	'Tue-12:00': { code: 'GST 201', room: 'Online' },
	'Wed-10:00': { code: 'CSC 203', room: 'LT 2' },
	'Wed-12:00': { code: 'CSC 205', room: 'Lab 3' },
};

function TimetablePreview() {
	return (
		<figure
			className={styles.preview}
			role="img"
			aria-label="Example: a lecture timetable grid with one clash flagged: STA 201 and CSC 203 both in LT 1 on Tuesday at 10:00."
		>
			<div className={styles.previewHead} aria-hidden="true">
				<span>Faculty of Science · Lectures</span>
				<span className={styles.previewDraft}>Draft</span>
			</div>
			<div className={styles.previewGrid} aria-hidden="true">
				<span />
				{PREVIEW_DAYS.map((d) => <span key={d} className={styles.previewDay}>{d}</span>)}
				{PREVIEW_TIMES.map((t) => (
					<div key={t} className={styles.previewRow}>
						<span className={styles.previewTime}>{t}</span>
						{PREVIEW_DAYS.map((d) => {
							const c = PREVIEW_CELLS[`${d}-${t}`];
							return (
								<span key={d} className={c ? (c.clash ? styles.previewClash : styles.previewCell) : styles.previewEmpty}>
									{c && <><b>{c.code}</b><small>{c.room}</small></>}
								</span>
							);
						})}
					</div>
				))}
			</div>
			<p className={styles.previewAlert} aria-hidden="true">
				<span className={styles.previewAlertMark}>!</span>
				STA 201 and CSC 203 are both in LT 1 on Tuesday at 10:00. Fix it before locking.
			</p>
		</figure>
	);
}

export default function Landing() {
	const pageRef = useRef(null);
	useReveal(pageRef);
	return (
		<div ref={pageRef} className={`${styles.page} ${display.variable} ${mono.variable}`}>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c') }}
			/>

			{/* ---------- Nav ---------- */}
			<header className={styles.nav}>
				<div className={styles.navInner}>
					<Link href="/" className={styles.wordmark}>
						UniSchedule<span className={styles.wordmarkDot}>.</span>
					</Link>
					<span className={styles.navFor}>For the University of Lagos</span>
					<nav className={styles.navLinks} aria-label="Main">
						<a href="#for">Who it&apos;s for</a>
						<a href="#features">Features</a>
						<a href="#how">How it works</a>
						<Link href="/contributors">Contributors</Link>
					</nav>
					<Link href="/realms" className={styles.navSignIn}>Staff sign in</Link>
				</div>
			</header>

			<main>
				{/* ---------- Hero ---------- */}
				<section className={styles.heroBand}>
					<div className={styles.hero}>
						<div className={styles.heroMeta}>
							<span>{'// Timetable manager for UNILAG'}</span>
							<span>Lectures · Exams · CBT</span>
						</div>
						<h1 className={styles.heroTitle}>
							<span className={styles.lineSolid}>Every timetable.</span>
							<span className={styles.lineOutline}>Every faculty.</span>
							<span className={styles.lineMark}>No clashes.</span>
						</h1>
						<div className={styles.heroFoot}>
							<div className={styles.heroCopy}>
								<p className={styles.heroText}>
									Timetable officers build each semester&apos;s lecture and exam timetables in
									UniSchedule, and every one is checked against rooms, courses and students as it
									is placed. When a timetable is FINAL, anyone can download it.
								</p>
								<div className={styles.heroActions}>
									<Link href="/download" className={styles.primary}>
										Download a timetable <span className={styles.arrow} aria-hidden="true">→</span>
									</Link>
									<Link href="/realms" className={styles.textLink}>
										Staff sign in <span className={styles.arrow} aria-hidden="true">→</span>
									</Link>
								</div>
							</div>
							<TimetablePreview />
						</div>
					</div>
				</section>

				{/* ---------- Facts ---------- */}
				<section className={styles.facts} aria-label="What it covers">
					<div className={styles.factsInner}>
						{FACTS.map((f, i) => (
							<div key={f.label} className={styles.fact} data-reveal style={{ '--delay': `${i * 90}ms` }}>
								<span className={styles.factFigure}>{f.figure}</span>
								<span className={styles.factLabel}>{f.label}</span>
								<span className={styles.factDetail}>{f.detail}</span>
							</div>
						))}
					</div>
				</section>

				{/* ---------- Who it's for ---------- */}
				<section id="for" className={`${styles.section} ${styles.tinted}`}>
					<p className={styles.sectionLabel} data-reveal><span>01</span> Who it&apos;s for</p>
					<div className={styles.audiences}>
						<div className={styles.audience} data-reveal>
							<h2 className={styles.audienceTitle}>Students &amp; visitors</h2>
							<ul>
								<li>Download any FINAL lecture, exam or CBT timetable as an A3 PDF. No account needed.</li>
								<li>Narrow it to your faculty, department and level.</li>
								<li>Scan the QR code on a printed copy to check it is genuine and current.</li>
							</ul>
							<div className={styles.audienceLinks}>
								<Link href="/download">Download a timetable →</Link>
								<Link href="/verify">Check a printed copy →</Link>
							</div>
						</div>
						<div className={styles.audience} data-reveal style={{ '--delay': '90ms' }}>
							<h2 className={styles.audienceTitle}>Timetable officers &amp; staff</h2>
							<ul>
								<li>Build lecture, exam and CBT timetables for your faculty or the whole university.</li>
								<li>See every clash the moment it happens, and why.</li>
								<li>Lock the FINAL version, and it is published at once with its sign-off.</li>
							</ul>
							<div className={styles.audienceLinks}>
								<Link href={loginPath('UG')}>Undergraduate sign in →</Link>
								<Link href={loginPath('ICE')}>ICE sign in →</Link>
							</div>
						</div>
					</div>
				</section>

				{/* ---------- Features ---------- */}
				<section id="features" className={styles.section}>
					<p className={styles.sectionLabel} data-reveal><span>02</span> What it does</p>
					<h2 className={styles.sectionTitle} data-reveal>Built for how UNILAG schedules.</h2>
					<ol className={styles.rows}>
						{FEATURES.map((f, i) => (
							<li key={f.title} className={styles.row} data-reveal>
								<span className={styles.rowNumber}>{pad(i + 1)}</span>
								<h3 className={styles.rowTitle}>{f.title}</h3>
								<p className={styles.rowText}>{f.description}</p>
							</li>
						))}
					</ol>
				</section>

				{/* ---------- How it works ---------- */}
				<section id="how" className={styles.section}>
					<p className={styles.sectionLabel} data-reveal><span>03</span> How it works</p>
					<h2 className={styles.sectionTitle} data-reveal>Three steps to a published timetable.</h2>
					<ol className={styles.steps}>
						{STEPS.map((s, i) => (
							<li key={s.title} className={styles.step} data-reveal style={{ '--delay': `${i * 90}ms` }}>
								<span className={styles.stepNumber} aria-hidden="true">{pad(i + 1)}</span>
								<h3>{s.title}</h3>
								<p>{s.description}</p>
							</li>
						))}
					</ol>
				</section>
			</main>

			{/* ---------- Footer ---------- */}
			<footer className={styles.footer}>
				<div className={styles.footerInner}>
					<p className={styles.footerLabel}>{'// Looking for your timetable?'}</p>
					<Link href="/download" className={styles.footerCta} data-reveal>
						Find your timetable <span aria-hidden="true">→</span>
					</Link>

					<div className={styles.footerGrid}>
						<div>
							<p className={styles.footerLabel}>{'// About'}</p>
							<p className={styles.footerAbout}>
								UniSchedule is a timetable manager built for the University of Lagos by{' '}
								<Link href="/contributors">its contributors</Link>.
							</p>
						</div>
						<nav aria-label="Footer" className={styles.footerLinks}>
							<div>
								<p className={styles.footerLabel}>{'// Timetables'}</p>
								<Link href="/download">Download a timetable</Link>
								<Link href="/verify">Check a printed copy</Link>
							</div>
							<div>
								<p className={styles.footerLabel}>{'// Staff'}</p>
								<Link href={loginPath('UG')}>Undergraduate sign in</Link>
								<Link href={loginPath('ICE')}>ICE sign in</Link>
							</div>
						</nav>
					</div>

					<div className={styles.footerBottom}>
						<span>© {new Date().getFullYear()} UniSchedule. All rights reserved.</span>
						<a href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo(0, 0); }}>Back to top ↑</a>
					</div>
				</div>
			</footer>
		</div>
	);
}
