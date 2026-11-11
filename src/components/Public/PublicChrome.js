'use client';

// The shared frame of the public pages (home, download, verify, contributors,
// sign-in): the brand colours and font, one header and one footer, so every
// page a visitor sees looks like the same product.
//
// UniSchedule is a product built for the University of Lagos: its name sits
// beside the university's crest, in UNILAG blue, white and yellow.
import Link from 'next/link';
import { unilagLogoBase64 } from '@/lib/logo';
import { loginPath } from '@/lib/realm';
import { displayFont } from './fonts';
import { scrollToSection } from './smoothScroll';
import styles from './public.module.css';

/** The page root: brand colours and font for everything inside. */
export function PublicPage({ children, className = '', ...rest }) {
	return (
		<div className={`${styles.brand} ${displayFont.variable} ${className}`} {...rest}>
			{children}
		</div>
	);
}

// The homepage's sections, reached from any page (and glided to on the homepage).
const SECTIONS = [
	{ href: '/#for', label: 'Who it\'s for' },
	{ href: '/#features', label: 'Features' },
	{ href: '/#how', label: 'How it works' },
];

export function PublicHeader() {
	return (
		<header className={styles.header}>
			<div className={styles.headerInner}>
				<Link href="/" className={styles.wordmark}>
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={unilagLogoBase64} alt="University of Lagos logo" width="36" height="36" className={styles.logo} />
					UniSchedule
				</Link>
				<nav className={styles.headerLinks} aria-label="Main">
					{SECTIONS.map((s) => (
						<a key={s.href} href={s.href} onClick={scrollToSection}>{s.label}</a>
					))}
					<Link href="/download">Download</Link>
					<Link href="/contributors">Contributors</Link>
				</nav>
				<Link href="/realms" className={styles.signIn}>
					<span className={styles.longLabel}>Staff sign in</span>
					<span className={styles.shortLabel}>Sign in</span>
				</Link>
			</div>
		</header>
	);
}

/** `callout`: the yellow "Looking for your timetable?" bar above the links. */
export function PublicFooter({ callout = true }) {
	return (
		<footer className={styles.footer}>
			<div className={styles.footerInner}>
				{callout && (
					<div className={styles.footerCall}>
						<h2>Looking for your timetable?</h2>
						<Link href="/download" className={styles.footerButton}>Download a timetable</Link>
					</div>
				)}
				<div className={styles.footerGrid}>
					<div className={styles.footerAbout}>
						<p className={styles.footerWordmark}>
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={unilagLogoBase64} alt="" width="32" height="32" className={styles.footerLogo} />
							UniSchedule
						</p>
						<p>
							A timetable manager built for the University of Lagos by{' '}
							<Link href="/contributors">its contributors</Link>.
						</p>
					</div>
					<nav aria-label="Footer" className={styles.footerLinks}>
						<div>
							<h3>Timetables</h3>
							<Link href="/download">Download a timetable</Link>
							<Link href="/verify">Check a printed copy</Link>
						</div>
						<div>
							<h3>Staff</h3>
							<Link href={loginPath('UG')}>Undergraduate sign in</Link>
							<Link href={loginPath('ICE')}>ICE sign in</Link>
						</div>
						<div>
							<h3>Project</h3>
							<Link href="/contributors">Contributors</Link>
						</div>
					</nav>
				</div>
				<p className={styles.copyright}>© {new Date().getFullYear()} UniSchedule. All rights reserved.</p>
			</div>
		</footer>
	);
}

/** A page with the shared header and footer around it. */
export function PublicLayout({ children, callout = true, mainClassName = '' }) {
	return (
		<PublicPage className={styles.layout}>
			<PublicHeader />
			<main className={`${styles.main} ${mainClassName}`}>{children}</main>
			<PublicFooter callout={callout} />
		</PublicPage>
	);
}

export { styles as publicStyles };
