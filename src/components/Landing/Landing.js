'use client';

import Link from 'next/link';
import styles from './Landing.module.css';
import { unilagLogoBase64 } from '@/lib/logo';
import { loginPath } from '@/lib/realm';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';

/* ---------- Icons (inline SVG, matches the icon style used across the app) ---------- */

function ShieldIcon() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M12 2l8 4v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-4z" />
			<path d="M9 12l2 2 4-4" />
		</svg>
	);
}

function LayersIcon() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<polygon points="12 2 2 7 12 12 22 7 12 2" />
			<polyline points="2 17 12 22 22 17" />
			<polyline points="2 12 12 17 22 12" />
		</svg>
	);
}

function CalendarOffIcon() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M21 13V6a2 2 0 0 0-2-2H8" />
			<path d="M16 2v4" />
			<path d="M3 10h9" />
			<path d="M3 6a2 2 0 0 1 2-2h1" />
			<path d="M3 10v9a2 2 0 0 0 2 2h9" />
			<line x1="2" y1="2" x2="22" y2="22" />
		</svg>
	);
}

function ClipboardCheckIcon() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
			<rect x="8" y="2" width="8" height="4" rx="1" />
			<path d="M9 14l2 2 4-4" />
		</svg>
	);
}

function BuildingIcon() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
			<polyline points="9 22 9 12 15 12 15 22" />
		</svg>
	);
}

function DownloadIcon() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" y1="15" x2="12" y2="3" />
		</svg>
	);
}

function UploadIcon() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="17 8 12 3 7 8" />
			<line x1="12" y1="3" x2="12" y2="15" />
		</svg>
	);
}

function LockIcon() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<rect x="4" y="11" width="16" height="10" rx="2" />
			<path d="M8 11V7a4 4 0 0 1 8 0v4" />
		</svg>
	);
}

function UsersIcon() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M22 21v-2a4 4 0 0 0-3-3.87" />
			<path d="M16 3.13a4 4 0 0 1 0 7.75" />
		</svg>
	);
}

function MonitorIcon() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<rect x="2" y="3" width="20" height="14" rx="2" />
			<line x1="8" y1="21" x2="16" y2="21" />
			<line x1="12" y1="17" x2="12" y2="21" />
		</svg>
	);
}

function ArrowRightIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
			<line x1="5" y1="12" x2="19" y2="12" />
			<polyline points="12 5 19 12 12 19" />
		</svg>
	);
}

function ArrowUpRightIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
			<line x1="7" y1="17" x2="17" y2="7" />
			<polyline points="7 7 17 7 17 17" />
		</svg>
	);
}

/* ---------- In-page links ---------- */

// Slide to a section on this page instead of jumping. The browser's built-in
// smooth scroll can't be slowed down, so this animates it: an ease-in-out
// glide of 0.9-1.8s depending on distance. Any wheel, touch or key press
// hands control straight back to the visitor. People who have asked their
// device to reduce motion get the plain jump.
let slideFrame = 0;

function stopSlide() {
	cancelAnimationFrame(slideFrame);
	slideFrame = 0;
	window.removeEventListener('wheel', stopSlide);
	window.removeEventListener('touchstart', stopSlide);
	window.removeEventListener('keydown', stopSlide);
}

function easeInOutCubic(t) {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function slideTo(targetY) {
	stopSlide();
	const startY = window.scrollY;
	const distance = targetY - startY;
	const duration = Math.min(1800, Math.max(900, 500 + Math.abs(distance) * 0.5));
	const startTime = performance.now();
	const frame = (now) => {
		const t = Math.min(1, (now - startTime) / duration);
		window.scrollTo(0, startY + distance * easeInOutCubic(t));
		if (t < 1) slideFrame = requestAnimationFrame(frame);
		else stopSlide();
	};
	window.addEventListener('wheel', stopSlide, { passive: true });
	window.addEventListener('touchstart', stopSlide, { passive: true });
	window.addEventListener('keydown', stopSlide);
	slideFrame = requestAnimationFrame(frame);
}

function scrollToSection(e) {
	const id = e.currentTarget.getAttribute('href').slice(1);
	const target = document.getElementById(id);
	if (!target) return;
	e.preventDefault();
	history.replaceState(null, '', `#${id}`);
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		target.scrollIntoView({ block: 'start' });
		return;
	}
	// Stop below the sticky nav (the section's scroll-margin-top).
	const offset = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
	const maxY = document.documentElement.scrollHeight - window.innerHeight;
	slideTo(Math.min(maxY, target.getBoundingClientRect().top + window.scrollY - offset));
}

/* ---------- Content ---------- */

const FEATURES = [
	{
		icon: <ShieldIcon />,
		title: 'Automatic conflict detection',
		description: 'Clashing lectures, exams, and room bookings are flagged the moment they happen. Exams can share a venue without tripping the checks built for lectures.',
	},
	{
		icon: <LayersIcon />,
		title: 'Priority-based scheduling',
		description: 'University-wide and interfaculty courses are weighted automatically, so higher-priority classes always win an overlap.',
	},
	{
		icon: <CalendarOffIcon />,
		title: 'Holiday-aware planning',
		description: 'Mark protected dates once and every timetable respects them — nothing gets scheduled on a holiday by accident.',
	},
	{
		icon: <UploadIcon />,
		title: 'Import existing timetables',
		description: 'Bring in a faculty\'s Excel or Word timetable, or copy last semester\'s. Every import is previewed and checked for clashes first, and can be undone.',
	},
	{
		icon: <MonitorIcon />,
		title: 'CBT exam timetables',
		description: 'Computer-based exams get a timetable of their own, run by CITS, with CBT centres checked for clashes like any other room.',
	},
	{
		icon: <BuildingIcon />,
		title: 'Programmes, faculties & rooms',
		description: 'Each programme keeps its own calendar, faculties, departments and rooms. Halls shared between programmes are checked for clashes across both.',
	},
	{
		icon: <DownloadIcon />,
		title: 'Export & share instantly',
		description: 'Download any timetable as a print-ready PDF (A3 or A4, week grid or one day per page) or as CSV, filtered by faculty, department and level.',
	},
	{
		icon: <LockIcon />,
		title: 'Lock the final version',
		description: 'Mark a timetable FINAL so nobody can change it by accident. Faculty editors can ask a super admin to reopen it.',
	},
	{
		icon: <UsersIcon />,
		title: 'A role for every office',
		description: 'Super admins, faculty editors and viewers, GS and CITS admins and departmental exam officers each see and change only what is theirs.',
	},
];

const STEPS = [
	{
		n: '01',
		title: 'Add your data',
		description: 'Set up faculties, departments, courses and rooms, then import the timetables you already have or copy an earlier semester.',
	},
	{
		n: '02',
		title: 'Set the rules',
		description: 'Set each course\'s scope and the semester\'s holidays and blocked slots once. Every timetable is checked against them.',
	},
	{
		n: '03',
		title: 'Schedule & export',
		description: 'Place lectures and exams on the grid, fix anything flagged, lock the final version and export it as PDF or CSV.',
	},
];

// Structured data: tells search engines this is the University of Lagos's
// timetable web application.
const STRUCTURED_DATA = {
	'@context': 'https://schema.org',
	'@type': 'WebApplication',
	name: SITE_NAME,
	alternateName: 'University of Lagos Timetable Manager',
	url: `${SITE_URL}/`,
	description: SITE_DESCRIPTION,
	applicationCategory: 'EducationalApplication',
	operatingSystem: 'Web',
	inLanguage: 'en',
	provider: {
		'@type': 'CollegeOrUniversity',
		name: 'University of Lagos',
		url: 'https://unilag.edu.ng',
	},
};

export default function Landing() {
	return (
		<div className={styles.page}>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c') }}
			/>
			{/* ---------- Nav ---------- */}
			<header className={styles.nav}>
				<div className={styles.navInner}>
					<div className={styles.brand}>
						<span className={styles.brandMark}>
							<img src={unilagLogoBase64} alt="UNILAG Logo" width="24" height="24" className={styles.brandLogo} />
						</span>
						<span>UniSchedule</span>
					</div>
					<nav className={styles.navLinks}>
						<a href="#features" onClick={scrollToSection}>Features</a>
						<a href="#how-it-works" onClick={scrollToSection}>How it works</a>
						<Link href="/contributors">Contributors</Link>
					</nav>
					<Link href="/realms" className={styles.navCta}>
						Login
					</Link>
				</div>
			</header>

			{/* ---------- Hero ---------- */}
			<section className={styles.hero}>
				<div className={styles.heroGlowA} aria-hidden="true" />
				<div className={styles.heroGlowB} aria-hidden="true" />
				<div className={styles.heroText}>
					<span className={styles.eyebrow}>
						<span className={styles.eyebrowDot} />
						University of Lagos &middot; Timetable Manager
					</span>
					<h1 className={styles.heroTitle}>
						Conflict-free timetables for the <span className={styles.heroAccent}>whole university</span>
					</h1>
					<p className={styles.heroSubtitle}>
						UniSchedule checks every lecture and exam you place against rooms, departments and levels
						across every faculty, so clashes are caught before a timetable is published.
						No spreadsheets, no last-minute surprises.
					</p>
					<div className={styles.heroActions}>
						<Link href="/realms" className={styles.primaryCta}>
							Get Started <ArrowRightIcon />
						</Link>
						<a href="#how-it-works" className={styles.secondaryCta} onClick={scrollToSection}>
							See how it works
						</a>
					</div>
				</div>

				<div className={styles.heroArt} aria-hidden="true">
					<svg viewBox="0 0 460 360" className={styles.heroSvg}>
						<rect x="10" y="10" width="440" height="340" rx="20" className={styles.heroCard} />
						<rect x="10" y="10" width="440" height="54" rx="20" className={styles.heroCardHeader} />
						<circle cx="38" cy="37" r="7" className={styles.heroDotA} />
						<circle cx="62" cy="37" r="7" className={styles.heroDotB} />
						<circle cx="86" cy="37" r="7" className={styles.heroDotC} />

						{/* grid */}
						<g className={styles.heroGrid}>
							<line x1="30" y1="100" x2="430" y2="100" />
							<line x1="30" y1="150" x2="430" y2="150" />
							<line x1="30" y1="200" x2="430" y2="200" />
							<line x1="30" y1="250" x2="430" y2="250" />
							<line x1="30" y1="300" x2="430" y2="300" />
							<line x1="126" y1="80" x2="126" y2="320" />
							<line x1="222" y1="80" x2="222" y2="320" />
							<line x1="318" y1="80" x2="318" y2="320" />
						</g>

						{/* class blocks */}
						<rect x="38" y="106" width="80" height="38" rx="8" className={styles.blockPrimary} />
						<rect x="134" y="156" width="80" height="38" rx="8" className={styles.blockAccent} />
						<rect x="326" y="106" width="80" height="38" rx="8" className={styles.blockWarning} />
						<rect x="38" y="206" width="80" height="38" rx="8" className={styles.blockSuccess} />
						<rect x="230" y="256" width="80" height="38" rx="8" className={styles.blockPrimary} />
						<rect x="134" y="256" width="80" height="38" rx="8" className={styles.blockAccent} />
						<rect x="326" y="206" width="80" height="38" rx="8" className={styles.blockSuccess} />

						{/* floating "conflict-free" badge */}
						<g transform="translate(348, 250)">
							<circle cx="0" cy="0" r="34" className={styles.badgeCircle} />
							<path d="M-12 1 L-3 10 L14 -9" className={styles.badgeCheck} fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
						</g>
					</svg>
				</div>
			</section>

			{/* ---------- Value strip ---------- */}
			<section className={styles.valueStrip}>
				<div className={styles.valueItem}>
					<span className={styles.valueIcon}><ShieldIcon /></span>
					<span>Zero double-bookings</span>
				</div>
				<div className={styles.valueItem}>
					<span className={styles.valueIcon}><BuildingIcon /></span>
					<span>Every faculty, one system</span>
				</div>
				<div className={styles.valueItem}>
					<span className={styles.valueIcon}><ClipboardCheckIcon /></span>
					<span>Lectures, exams &amp; CBT</span>
				</div>
				<div className={styles.valueItem}>
					<span className={styles.valueIcon}><DownloadIcon /></span>
					<span>Minutes, not days</span>
				</div>
			</section>

			{/* ---------- Features ---------- */}
			<section id="features" className={styles.section}>
				<div className={styles.sectionHead}>
					<span className={styles.sectionEyebrow}>Features</span>
					<h2 className={styles.sectionTitle}>Everything a timetable office needs</h2>
					<p className={styles.sectionSubtitle}>
						Built specifically for how universities actually schedule classes and exams.
					</p>
				</div>
				<div className={styles.featureGrid}>
					{FEATURES.map((f) => (
						<div key={f.title} className={styles.featureCard}>
							<div className={styles.featureIcon}>{f.icon}</div>
							<h3 className={styles.featureTitle}>{f.title}</h3>
							<p className={styles.featureDescription}>{f.description}</p>
						</div>
					))}
				</div>
			</section>

			{/* ---------- How it works ---------- */}
			<section id="how-it-works" className={styles.sectionAlt}>
				<div className={styles.sectionHead}>
					<span className={styles.sectionEyebrow}>How it works</span>
					<h2 className={styles.sectionTitle}>From blank slate to published timetable</h2>
					<p className={styles.sectionSubtitle}>Three steps. No spreadsheets required.</p>
				</div>
				<div className={styles.steps}>
					{STEPS.map((s, i) => (
						<div key={s.n} className={styles.stepWrap}>
							<div className={styles.stepCard}>
								<span className={styles.stepNumber}>{s.n}</span>
								<h3 className={styles.stepTitle}>{s.title}</h3>
								<p className={styles.stepDescription}>{s.description}</p>
							</div>
							{i < STEPS.length - 1 && (
								<span className={styles.stepConnector} aria-hidden="true">
									<ArrowRightIcon />
								</span>
							)}
						</div>
					))}
				</div>
			</section>

			{/* ---------- CTA banner ---------- */}
			<section className={styles.ctaBanner}>
				<div className={styles.ctaPattern} aria-hidden="true" />
				<h2>Ready to build a conflict-free timetable?</h2>
				<p>Choose your programme and sign in to start scheduling.</p>
				<Link href="/realms" className={styles.ctaButton}>
					Get Started <ArrowRightIcon />
				</Link>
			</section>

			{/* ---------- Footer ---------- */}
			<footer className={styles.footer}>
				<div className={styles.footerGlow} aria-hidden="true" />
				<div className={styles.footerTop}>
					<div className={styles.footerBrandCol}>
						<div className={styles.footerBrand}>
							<span className={styles.footerBrandMark}>
								<img src={unilagLogoBase64} alt="UNILAG Logo" width="26" height="26" className={styles.brandLogo} />
							</span>
							<span>UniSchedule</span>
						</div>
						<p className={styles.footerTagline}>
							The conflict-free way to plan lecture and exam timetables across every faculty
							at the University of Lagos.
						</p>
						<span className={styles.footerBadge}>Built for the University of Lagos</span>
					</div>

					<div className={styles.footerLinkCol}>
						<h4>Product</h4>
						<a href="#features" onClick={scrollToSection}>Features</a>
						<a href="#how-it-works" onClick={scrollToSection}>How it works</a>
					</div>

					<div className={styles.footerLinkCol}>
						<h4>Account</h4>
						<Link href="/realms">
							Login <ArrowUpRightIcon />
						</Link>
						<Link href={loginPath('UG')}>Undergraduate portal</Link>
						<Link href={loginPath('ICE')}>ICE portal</Link>
					</div>

					<div className={styles.footerLinkCol}>
						<h4>Project</h4>
						<Link href="/contributors">Contributors</Link>
					</div>
				</div>

				<div className={styles.footerBottom}>
					<p className={styles.footerCopy}>© {new Date().getFullYear()} University of Lagos. All rights reserved.</p>
					<p className={styles.footerCopy}>Timetable Manager</p>
				</div>
			</footer>
		</div>
	);
}
