'use client';

// The homepage for signed-out visitors (src/app/page.js shows the dashboard to
// staff). UniSchedule is a product built for the University of Lagos, not by
// it: the product is the brand, and the university is who it serves.
//
// The page is laid out as what the product makes: a timetable. The hero is a
// week grid with the headline booked into it and a clash flagged; features are
// course blocks; how it works is a semester timeline. Everything on it informs
// or links somewhere.
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import styles from './Landing.module.css';
import { loginPath } from '@/lib/realm';
import { PublicFooter, PublicHeader, PublicPage } from '@/components/Public/PublicChrome';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';


/* ---------- Content ---------- */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const TIMES = ['8:00', '10:00', '12:00', '2:00', '4:00'];

// Course blocks around the headline in the hero grid. Examples, not real data.
const HERO_BLOCKS = [
	{ code: 'MTH 101', room: 'Main Auditorium', col: 6, row: 2, tone: 'blue' },
	{ code: 'PHY 102', room: 'LT 2', col: 2, row: 5, tone: 'pale' },
	{ code: 'GST 111', room: 'Online', col: 3, row: 5, tone: 'yellow' },
	{ code: 'CHM 101', room: 'Chem Lab', col: 5, row: 6, tone: 'pale' },
	{ code: 'BIO 101', room: 'LT 4', col: 6, row: 6, tone: 'blue' },
];

const FEATURES = [
	{ title: 'Clash checks', slot: 'Every placement', text: 'Each lecture and exam is checked against rooms, courses and the students who take them, as it is placed. Exams may share a hall; lectures may not.', tone: 'blue' },
	{ title: 'Course priority', slot: 'University-wide first', text: 'University-wide and interfaculty courses take precedence, so a clash says which class has to move.', tone: 'yellow' },
	{ title: 'Protected dates', slot: 'Set once a semester', text: 'Holidays and blocked slots are marked once, and nothing can be placed on them.', tone: 'pale' },
	{ title: 'Imports', slot: 'Excel, Word, last semester', text: 'Bring in a faculty\'s existing timetable or copy last semester\'s. Previewed, checked for clashes, and undoable.', tone: 'pale' },
	{ title: 'CBT timetables', slot: 'Run by CITS', text: 'Computer-based exams have their own timetable, with CBT centres checked like any other room.', tone: 'blue' },
	{ title: 'Shared halls', slot: 'Undergraduate and ICE', text: 'Each programme keeps its own rooms; a hall both use is checked across both, so it is never booked twice.', tone: 'yellow' },
	{ title: 'Public downloads', slot: 'No account needed', text: 'Anyone can download a FINAL timetable as an A3 PDF, by faculty, department and level.', tone: 'yellow' },
	{ title: 'Verified copies', slot: 'QR code on every page', text: 'A FINAL timetable names its approving officer, and its QR code confirms a printed copy is genuine and current.', tone: 'pale' },
	{ title: 'Access by office', slot: 'Officers, editors, CITS, GS', text: 'Each office sees the whole picture but changes only what is theirs.', tone: 'blue' },
];

// A semester, start to finish, as the timeline under "How it works".
const MILESTONES = [
	{ week: 'Before week 1', title: 'Set up the semester', text: 'Faculties, departments, courses and rooms; import existing timetables or copy an earlier semester.' },
	{ week: 'Week 1', title: 'Set the rules', text: 'Each course\'s scope, holidays and blocked slots. Every timetable is checked against them from here on.' },
	{ week: 'When ready', title: 'Lock and publish', text: 'Fix what is flagged and lock the FINAL version. Students can download it at once.' },
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

/*
 * Below the hero, blocks fade and rise a little the first time they scroll
 * into view. Nothing is hidden until this runs, nothing already on screen is
 * hidden, each plays once, and it is off for people who ask for reduced motion.
 */
function useReveal(rootRef) {
	useEffect(() => {
		const root = rootRef.current;
		if (!root || !('IntersectionObserver' in window)) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const items = [...root.querySelectorAll('[data-reveal]')];
		for (const el of items) {
			// Already on screen: shown as it is, no entrance.
			if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.revealed = 'load';
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					entry.target.dataset.revealed = 'scroll';
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
 * Scroll-linked background: the page's faint timetable grid drifts slowly
 * (a light parallax), and a yellow "now" line moves down the hero's week grid
 * as the hero scrolls past, like the current-time line in a calendar. One
 * transform per element per frame; still for people who ask for reduced motion.
 */
function useScrollScene(gridRef, weekRef, nowRef) {
	useEffect(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		let frame = 0;
		const update = () => {
			frame = 0;
			const y = window.scrollY;
			if (gridRef.current) {
				// Wraps every 64px (the grid's cell size), so the layer never runs out.
				gridRef.current.style.transform = `translate3d(0, ${-((y * 0.25) % 64)}px, 0)`;
			}
			const week = weekRef.current;
			const now = nowRef.current;
			if (week && now) {
				const r = week.getBoundingClientRect();
				const span = r.height || 1;
				// 0 at the top of the page (the line sits at 8:00), 1 once the grid's
				// bottom has scrolled up to a third of the way down the screen.
				const end = r.top + y + span - window.innerHeight / 3;
				const progress = Math.min(1, Math.max(0, y / Math.max(1, end)));
				const top = 44 + progress * (span - 44 - 2);
				now.style.transform = `translate3d(0, ${top}px, 0)`;
			}
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};
		update();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
		};
	}, [gridRef, weekRef, nowRef]);
}

const toneClass = (tone) => ({ blue: styles.toneBlue, yellow: styles.toneYellow, pale: styles.tonePale })[tone];

/* ---------- Hero: a week grid with the headline booked into it ---------- */

function HeroGrid({ weekRef, nowRef }) {
	return (
		<div className={styles.week} ref={weekRef}>
			{/* The "now" line, moved by useScrollScene. */}
			<div className={styles.nowLine} ref={nowRef} aria-hidden="true">
				<span className={styles.nowTag}>Now</span>
			</div>

			{/* Day and time labels: the grid reads as a timetable. */}
			<span className={styles.corner} aria-hidden="true" />
			{DAYS.map((d, i) => (
				<span key={d} className={styles.dayLabel} style={{ gridColumn: i + 2 }} aria-hidden="true">{d}</span>
			))}
			{TIMES.map((t, i) => (
				<span key={t} className={styles.timeLabel} style={{ gridRow: i + 2 }} aria-hidden="true">{t}</span>
			))}

			{/* Every slot, so the grid lines show where nothing is booked. */}
			{TIMES.map((t, r) => DAYS.map((d, c) => (
				<span key={`${d}-${t}`} className={styles.slot} style={{ gridColumn: c + 2, gridRow: r + 2 }} aria-hidden="true" />
			)))}

			{/* The headline, booked across Mon-Thu, 8:00-2:00. */}
			<div className={styles.headline}>
				<p className={styles.headlineSlot}>Mon–Thu · 8:00–2:00 · All faculties</p>
				<h1 className={styles.headlineTitle}>
					Lecture and exam timetables for every UNILAG faculty, <mark>with the clashes caught.</mark>
				</h1>
				<p className={styles.headlineText}>
					Timetable officers build each semester&apos;s timetables in UniSchedule, and every lecture
					and exam is checked against rooms, courses and students as it is placed. When a timetable is
					FINAL, anyone can download it.
				</p>
				<div className={styles.headlineActions}>
					<Link href="/download" className={styles.primary}>Download a timetable</Link>
					<Link href="/realms" className={styles.secondary}>Staff sign in</Link>
				</div>
			</div>

			{/* A clash, flagged: two courses in the same room at the same time. */}
			<div className={styles.clash} role="note" aria-label="Example clash: STA 201 and CSC 203 both booked in LT 1, Friday 10:00.">
				<span className={styles.clashTag} aria-hidden="true">Clash</span>
				<span className={styles.clashCourse} aria-hidden="true"><b>STA 201</b> LT 1</span>
				<span className={styles.clashCourse} aria-hidden="true"><b>CSC 203</b> LT 1</span>
			</div>

			{HERO_BLOCKS.map((b) => (
				<span
					key={b.code}
					className={`${styles.block} ${toneClass(b.tone)}`}
					style={{ gridColumn: b.col, gridRow: b.row }}
					aria-hidden="true"
				>
					<b>{b.code}</b>
					<small>{b.room}</small>
				</span>
			))}
		</div>
	);
}

export default function Landing() {
	const pageRef = useRef(null);
	const gridRef = useRef(null);
	const weekRef = useRef(null);
	const nowRef = useRef(null);
	useReveal(pageRef);
	useScrollScene(gridRef, weekRef, nowRef);
	return (
		<PublicPage ref={pageRef} className={styles.page}>
			<div className={styles.scrollGrid} ref={gridRef} aria-hidden="true" />
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c') }}
			/>

			<PublicHeader />

			<main>
				<section className={styles.hero}>
					<HeroGrid weekRef={weekRef} nowRef={nowRef} />
					<ul className={styles.covers} aria-label="What it covers">
						<li><b>Lectures, exams and CBT</b> in one place</li>
						<li><b>Undergraduate and ICE</b>, each with its own calendar</li>
						<li><b>A3 PDFs</b> anyone can check by QR code</li>
					</ul>
				</section>

				{/* ---------- Who it's for ---------- */}
				<section id="for" className={styles.section}>
					<h2 className={styles.sectionTitle} data-reveal>Who it&apos;s for</h2>
					<div className={styles.audiences}>
						<article className={`${styles.audience} ${styles.toneYellow}`} data-reveal>
							<p className={styles.audienceSlot}>Open to everyone · no sign-in</p>
							<h3>Students and visitors</h3>
							<ul>
								<li>Download any FINAL lecture, exam or CBT timetable as an A3 PDF.</li>
								<li>Narrow it to your faculty, department and level.</li>
								<li>Scan the QR code on a printed copy to check it is genuine and current.</li>
							</ul>
							<div className={styles.audienceLinks}>
								<Link href="/download">Download a timetable</Link>
								<Link href="/verify">Check a printed copy</Link>
							</div>
						</article>
						<article className={`${styles.audience} ${styles.toneBlue}`} data-reveal style={{ '--delay': '90ms' }}>
							<p className={styles.audienceSlot}>Timetable office · signed in</p>
							<h3>Timetable officers and staff</h3>
							<ul>
								<li>Build lecture, exam and CBT timetables for your faculty or the whole university.</li>
								<li>See every clash the moment it happens, and why.</li>
								<li>Lock the FINAL version, and it is published at once with its sign-off.</li>
							</ul>
							<div className={styles.audienceLinks}>
								<Link href={loginPath('UG')}>Undergraduate sign in</Link>
								<Link href={loginPath('ICE')}>ICE sign in</Link>
							</div>
						</article>
					</div>
				</section>

				{/* ---------- Features, as course blocks ---------- */}
				<section id="features" className={styles.section}>
					<h2 className={styles.sectionTitle} data-reveal>What it does</h2>
					<p className={styles.sectionLead} data-reveal>Built around how the University of Lagos schedules its lectures and exams.</p>
					<div className={styles.features}>
						{FEATURES.map((f, i) => (
							<article
								key={f.title}
								className={`${styles.feature} ${toneClass(f.tone)}`}
								data-reveal
								style={{ '--delay': `${(i % 3) * 70}ms` }}
							>
								<p className={styles.featureSlot}>{f.slot}</p>
								<h3>{f.title}</h3>
								<p>{f.text}</p>
							</article>
						))}
					</div>
				</section>

				{/* ---------- How it works, as a semester timeline ---------- */}
				<section id="how" className={styles.section}>
					<h2 className={styles.sectionTitle} data-reveal>How a semester comes together</h2>
					<ol className={styles.timeline}>
						{MILESTONES.map((m, i) => (
							<li key={m.title} className={styles.milestone} data-reveal style={{ '--delay': `${i * 90}ms` }}>
								<span className={styles.milestoneDot} aria-hidden="true" />
								<p className={styles.milestoneWeek}>{m.week}</p>
								<h3>{m.title}</h3>
								<p>{m.text}</p>
							</li>
						))}
					</ol>
				</section>
			</main>

			<PublicFooter />
		</PublicPage>
	);
}
