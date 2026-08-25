'use client';

import Link from 'next/link';
import styles from './Landing.module.css';
import { unilagLogoBase64 } from '@/lib/logo';

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

/* ---------- Content ---------- */

const FEATURES = [
	{
		icon: <ShieldIcon />,
		title: 'Automatic conflict detection',
		description: 'Clashing lectures, exams, and room bookings are flagged the moment they happen — before a timetable ever gets published.',
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
		icon: <ClipboardCheckIcon />,
		title: 'Smarter exam timetabling',
		description: 'Share a single venue across multiple exams at once, without tripping the conflict checks built for lectures.',
	},
	{
		icon: <BuildingIcon />,
		title: 'Faculty & room management',
		description: 'Every faculty, department, room, and seat count lives in one place — searchable, filterable, always up to date.',
	},
	{
		icon: <DownloadIcon />,
		title: 'Export & share instantly',
		description: 'Turn any timetable into a clean, print-ready PDF that staff and students can download in one click.',
	},
];

const STEPS = [
	{
		n: '01',
		title: 'Add your data',
		description: 'Bring in faculties, departments, courses, and rooms — or start fresh and build them out directly in UniSchedule.',
	},
	{
		n: '02',
		title: 'Set the rules',
		description: 'Define course priorities and holidays once. UniSchedule applies them automatically to every timetable you generate.',
	},
	{
		n: '03',
		title: 'Generate & export',
		description: 'Produce a conflict-free lecture or exam timetable in minutes, then export it as a shareable PDF.',
	},
];

export default function Landing() {
	return (
		<div className={styles.page}>
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
						<a href="#features">Features</a>
						<a href="#how-it-works">How it works</a>
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
						UniSchedule builds lecture and exam timetables across every faculty automatically —
						no double-bookings, no spreadsheets, no last-minute clashes.
					</p>
					<div className={styles.heroActions}>
						<Link href="/realms" className={styles.primaryCta}>
							Get Started <ArrowRightIcon />
						</Link>
						<a href="#features" className={styles.secondaryCta}>
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
					<span>Lectures &amp; exams, handled</span>
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
				<p>Sign in to start scheduling your faculty in minutes.</p>
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
						<a href="#features">Features</a>
						<a href="#how-it-works">How it works</a>
					</div>

					<div className={styles.footerLinkCol}>
						<h4>Account</h4>
						<Link href="/realms">
							Login <ArrowUpRightIcon />
						</Link>
						<Link href="/login">Undergraduate portal</Link>
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
