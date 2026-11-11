'use client';

// The homepage for signed-out visitors (src/app/page.js shows the dashboard to
// staff). UniSchedule is a product built for the University of Lagos, not by
// it: the product is the brand here, and the university is who it serves.
//
// Everything on the page tells a visitor something or takes them somewhere;
// nothing is there only to decorate.
import Link from 'next/link';
import { Fraunces } from 'next/font/google';
import styles from './Landing.module.css';
import { loginPath } from '@/lib/realm';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';

// Headings only; body text stays in the site's sans-serif.
const display = Fraunces({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display', display: 'swap' });

/* ---------- Content ---------- */

const FACTS = [
	{ term: 'Timetables', detail: 'Lectures, examinations and CBT' },
	{ term: 'Programmes', detail: 'Undergraduate and ICE' },
	{ term: 'Copies', detail: 'A3 PDFs, checked by QR code' },
];

const FEATURES = [
	{
		title: 'Clashes caught as you place them',
		description: 'Every lecture and exam is checked against rooms, courses and the students who take them. Exams may share a hall; lectures may not.',
	},
	{
		title: 'Priority between courses',
		description: 'University-wide and interfaculty courses take precedence, so a clash says which class has to move.',
	},
	{
		title: 'Holidays and blocked slots',
		description: 'Protected dates and times are set once for the semester, and nothing can be placed on them.',
	},
	{
		title: 'Import what you already have',
		description: 'Bring in a faculty\'s Excel or Word timetable, or copy last semester\'s. Imports are previewed, checked for clashes and can be undone.',
	},
	{
		title: 'CBT timetables',
		description: 'Computer-based exams have their own timetable, run by CITS, with CBT centres checked like any other room.',
	},
	{
		title: 'Programmes, faculties and rooms',
		description: 'Undergraduate and ICE keep their own calendars, faculties and rooms. A hall shared by both is checked across both.',
	},
	{
		title: 'Public downloads',
		description: 'Anyone can download a FINAL timetable as a print-ready A3 PDF, by faculty, department and level, without an account.',
	},
	{
		title: 'Signed, and checkable',
		description: 'A FINAL timetable carries the approving officer\'s name and a QR code that confirms a printed copy is genuine and current. Drafts are marked as drafts.',
	},
	{
		title: 'The right access for each office',
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
		title: 'Schedule, lock and publish',
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

export default function Landing() {
	return (
		<div className={`${styles.page} ${display.variable}`}>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c') }}
			/>

			{/* ---------- Nav ---------- */}
			<header className={styles.nav}>
				<div className={styles.navInner}>
					<Link href="/" className={styles.wordmark}>
						UniSchedule
						<span className={styles.wordmarkFor}>for the University of Lagos</span>
					</Link>
					<nav className={styles.navLinks} aria-label="Main">
						<a href="#features">Features</a>
						<a href="#how-it-works">How it works</a>
						<Link href="/download">Download</Link>
						<Link href="/contributors">Contributors</Link>
					</nav>
					<Link href="/realms" className={styles.navSignIn}>Staff sign in</Link>
				</div>
			</header>

			<main>
				{/* ---------- Hero ---------- */}
				<section className={styles.hero}>
					<p className={styles.kicker}>The timetable manager for the University of Lagos</p>
					<h1 className={styles.heroTitle}>
						Lecture and exam timetables for every faculty, without the clashes.
					</h1>
					<p className={styles.heroText}>
						Timetable officers build each semester&apos;s timetables in UniSchedule, and every
						lecture and exam is checked against rooms, courses and students as it is placed.
						When a timetable is final, anyone can download it.
					</p>
					<div className={styles.heroActions}>
						<Link href="/download" className={styles.primary}>Download a timetable</Link>
						<Link href="/realms" className={styles.secondary}>Staff sign in</Link>
					</div>
					<dl className={styles.facts}>
						{FACTS.map((f) => (
							<div key={f.term}>
								<dt>{f.term}</dt>
								<dd>{f.detail}</dd>
							</div>
						))}
					</dl>
				</section>

				{/* ---------- Who it's for ---------- */}
				<section className={styles.audiences} aria-label="Who it's for">
					<div className={styles.audience}>
						<h2 className={styles.audienceTitle}>Students and visitors</h2>
						<ul>
							<li>Download any FINAL lecture, exam or CBT timetable as an A3 PDF, no account needed.</li>
							<li>Narrow it to your faculty, department and level.</li>
							<li>Scan the QR code on a printed copy to check it is genuine and current.</li>
						</ul>
						<div className={styles.audienceLinks}>
							<Link href="/download">Download a timetable →</Link>
							<Link href="/verify">Check a printed copy →</Link>
						</div>
					</div>
					<div className={styles.audience}>
						<h2 className={styles.audienceTitle}>Timetable officers and staff</h2>
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
				</section>

				{/* ---------- Features ---------- */}
				<section id="features" className={styles.section}>
					<h2 className={styles.sectionTitle}>What it does</h2>
					<div className={styles.featureGrid}>
						{FEATURES.map((f) => (
							<div key={f.title} className={styles.feature}>
								<h3>{f.title}</h3>
								<p>{f.description}</p>
							</div>
						))}
					</div>
				</section>

				{/* ---------- How it works ---------- */}
				<section id="how-it-works" className={styles.section}>
					<h2 className={styles.sectionTitle}>How a semester comes together</h2>
					<ol className={styles.steps}>
						{STEPS.map((s, i) => (
							<li key={s.title}>
								<span className={styles.stepNumber} aria-hidden="true">{i + 1}</span>
								<div>
									<h3>{s.title}</h3>
									<p>{s.description}</p>
								</div>
							</li>
						))}
					</ol>
				</section>
			</main>

			{/* ---------- Footer ---------- */}
			<footer className={styles.footer}>
				<div className={styles.footerInner}>
					<div className={styles.footerAbout}>
						<p className={styles.footerWordmark}>UniSchedule</p>
						<p>
							A timetable manager built for the University of Lagos by{' '}
							<Link href="/contributors">its contributors</Link>.
						</p>
					</div>
					<nav className={styles.footerLinks} aria-label="Footer">
						<div>
							<h2>Timetables</h2>
							<Link href="/download">Download a timetable</Link>
							<Link href="/verify">Check a printed copy</Link>
						</div>
						<div>
							<h2>Staff</h2>
							<Link href={loginPath('UG')}>Undergraduate sign in</Link>
							<Link href={loginPath('ICE')}>ICE sign in</Link>
						</div>
						<div>
							<h2>Project</h2>
							<a href="#features">Features</a>
							<Link href="/contributors">Contributors</Link>
						</div>
					</nav>
				</div>
				<p className={styles.copyright}>© {new Date().getFullYear()} UniSchedule. All rights reserved.</p>
			</footer>
		</div>
	);
}
