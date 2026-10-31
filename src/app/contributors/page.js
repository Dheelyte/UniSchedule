'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import styles from './contributors.module.css';
import { unilagLogoBase64 } from '@/lib/logo';
import { CONTRIBUTORS } from '@/data/contributors';

// Must match the panel transition in contributors.module.css.
const EXPAND_MS = 600;

/* ---------- Icons ---------- */

function GitHubIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
		</svg>
	);
}

function LinkedInIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
		</svg>
	);
}

function XIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.63 7.58H.48l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zm-1.29 19.5h2.04L6.48 3.24H4.3l13.31 17.41z" />
		</svg>
	);
}

function InstagramIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<rect x="2" y="2" width="20" height="20" rx="5" />
			<circle cx="12" cy="12" r="4" />
			<line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
		</svg>
	);
}

function GlobeIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<circle cx="12" cy="12" r="10" />
			<line x1="2" y1="12" x2="22" y2="12" />
			<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
		</svg>
	);
}

function MailIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<rect x="2" y="4" width="20" height="16" rx="2" />
			<polyline points="22 6 12 13 2 6" />
		</svg>
	);
}

function ArrowLeftIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<line x1="19" y1="12" x2="5" y2="12" />
			<polyline points="12 19 5 12 12 5" />
		</svg>
	);
}

function ArrowRightIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<line x1="5" y1="12" x2="19" y2="12" />
			<polyline points="12 5 19 12 12 19" />
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}

function PinIcon() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
			<circle cx="12" cy="10" r="3" />
		</svg>
	);
}

// Order the links appear in.
const SOCIALS = [
	{ key: 'linkedin', label: 'LinkedIn', icon: <LinkedInIcon /> },
	{ key: 'x', label: 'X', icon: <XIcon /> },
	{ key: 'instagram', label: 'Instagram', icon: <InstagramIcon /> },
	{ key: 'website', label: 'Website', icon: <GlobeIcon /> },
	{ key: 'email', label: 'Email', icon: <MailIcon /> },
];

function initials(name) {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0].toUpperCase())
		.join('');
}

function socialLinks(person) {
	const socials = person.socials || {};
	const links = [];
	if (person.github) {
		links.push({ key: 'github', label: 'GitHub', icon: <GitHubIcon />, href: `https://github.com/${person.github}` });
	}
	for (const s of SOCIALS) {
		const value = socials[s.key];
		if (!value) continue;
		links.push({ ...s, href: s.key === 'email' ? `mailto:${value}` : value });
	}
	return links;
}

function externalProps(key) {
	return key === 'email' ? {} : { target: '_blank', rel: 'noopener noreferrer' };
}

function prefersReducedMotion() {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Public GitHub profiles, fetched once per username for the expanded view.
const githubCache = new Map();

function useGitHubProfile(username) {
	// The last lookup that finished, so a stale response never shows for a different user.
	const [fetched, setFetched] = useState({ username: null, data: null });
	useEffect(() => {
		if (!username || githubCache.has(username)) return;
		let cancelled = false;
		fetch(`https://api.github.com/users/${username}`)
			.then((res) => (res.ok ? res.json() : null))
			.then((data) => {
				if (data) githubCache.set(username, data);
				if (!cancelled) setFetched({ username, data });
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [username]);
	if (!username) return null;
	if (githubCache.has(username)) return githubCache.get(username);
	return fetched.username === username ? fetched.data : null;
}

function Avatar({ person, size, className }) {
	return (
		<div className={className}>
			<div className={styles.avatarInner}>
				<span className={styles.avatarInitials}>{initials(person.name)}</span>
				{person.github && (
					<img
						src={`https://github.com/${person.github}.png?size=${size * 2}`}
						alt=""
						width={size}
						height={size}
						className={styles.avatarImg}
						onError={(e) => { e.currentTarget.style.display = 'none'; }}
					/>
				)}
			</div>
		</div>
	);
}

function ContributorCard({ person, index, hidden, cardRef, onOpen }) {
	const links = socialLinks(person);
	const handlePointerMove = (e) => {
		const r = e.currentTarget.getBoundingClientRect();
		e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
		e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
	};
	return (
		<article
			ref={cardRef}
			className={`${styles.card} ${hidden ? styles.cardHidden : ''}`}
			style={{ '--i': index }}
			onPointerMove={handlePointerMove}
		>
			<span className={styles.cardSpotlight} aria-hidden="true" />
			<Avatar person={person} size={80} className={styles.avatar} />
			<h2 className={styles.name}>
				<button type="button" className={styles.cardButton} onClick={onOpen}>
					{person.name}
				</button>
			</h2>
			{person.role && <p className={styles.role}>{person.role}</p>}
			{person.bio && <p className={styles.bio}>{person.bio}</p>}
			{links.length > 0 && (
				<div className={styles.socials}>
					{links.map((l) => (
						<a
							key={l.key}
							href={l.href}
							className={styles.socialLink}
							aria-label={`${person.name} on ${l.label}`}
							title={l.label}
							{...externalProps(l.key)}
						>
							{l.icon}
						</a>
					))}
				</div>
			)}
			<span className={styles.cardHint} aria-hidden="true">View profile <ArrowRightIcon /></span>
		</article>
	);
}

function ContributorDetail({ person, index, total }) {
	const profile = useGitHubProfile(person.github);
	const links = socialLinks(person);
	const bio = person.bio || profile?.bio;
	const stats = profile
		? [
			{ label: 'Public repos', value: profile.public_repos },
			{ label: 'Followers', value: profile.followers },
			{ label: 'On GitHub since', value: new Date(profile.created_at).getFullYear() },
		]
		: [];

	return (
		<div className={styles.detail}>
			<div className={styles.detailHero}>
				<Avatar person={person} size={220} className={styles.detailAvatar} />
			</div>
			<div className={styles.detailBody}>
				<span className={styles.detailEyebrow} style={{ '--d': 0 }}>
					Contributor {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
				</span>
				<h2 className={styles.detailName} style={{ '--d': 1 }}>{person.name}</h2>
				{(person.role || profile?.location) && (
					<div className={styles.detailMeta} style={{ '--d': 2 }}>
						{person.role && <span className={styles.detailRole}>{person.role}</span>}
						{profile?.location && (
							<span className={styles.detailLocation}><PinIcon /> {profile.location}</span>
						)}
					</div>
				)}
				{bio && <p className={styles.detailBio} style={{ '--d': 3 }}>{bio}</p>}
				{stats.length > 0 && (
					<div className={styles.detailStats} style={{ '--d': 4 }}>
						{stats.map((s) => (
							<div key={s.label} className={styles.detailStat}>
								<span className={styles.detailStatValue}>{s.value}</span>
								<span className={styles.detailStatLabel}>{s.label}</span>
							</div>
						))}
					</div>
				)}
				{links.length > 0 && (
					<div className={styles.detailLinks} style={{ '--d': 5 }}>
						{links.map((l) => (
							<a key={l.key} href={l.href} className={styles.detailLink} {...externalProps(l.key)}>
								{l.icon}
								<span>{l.label}</span>
							</a>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

export default function ContributorsPage() {
	const cardRefs = useRef([]);
	const closeRef = useRef(null);
	const closeTimer = useRef(null);
	const [active, setActive] = useState(null);
	const [rect, setRect] = useState(null);
	// closed -> opening (panel sits on the card) -> open (fullscreen) -> closing (back onto the card)
	const [phase, setPhase] = useState('closed');
	const total = CONTRIBUTORS.length;

	const openCard = (index) => {
		if (phase !== 'closed') return;
		setRect(cardRefs.current[index].getBoundingClientRect());
		setActive(index);
		setPhase('opening');
	};

	const closeCard = () => {
		if (phase !== 'open') return;
		const card = cardRefs.current[active];
		setRect(card.getBoundingClientRect());
		setPhase('closing');
		closeTimer.current = setTimeout(() => {
			setPhase('closed');
			setActive(null);
			card.querySelector('button')?.focus();
		}, prefersReducedMotion() ? 0 : EXPAND_MS);
	};

	const step = (delta) => {
		if (phase !== 'open') return;
		setActive((i) => (i + delta + total) % total);
	};

	// Let the panel paint at the card's position before growing it.
	useEffect(() => {
		if (phase !== 'opening') return;
		let inner;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => setPhase('open'));
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, [phase]);

	useEffect(() => {
		if (phase === 'open') closeRef.current?.focus();
	}, [phase]);

	useEffect(() => {
		if (active === null) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, [active]);

	useEffect(() => {
		if (active === null) return;
		const onKey = (e) => {
			if (e.key === 'Escape') closeCard();
			if (e.key === 'ArrowRight') step(1);
			if (e.key === 'ArrowLeft') step(-1);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	useEffect(() => () => clearTimeout(closeTimer.current), []);

	const expanded = phase === 'open';
	const panelStyle = expanded || !rect
		? { top: 0, left: 0, width: '100%', height: '100%', borderRadius: 0 }
		: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: 'var(--radius-xl)' };
	const person = active !== null ? CONTRIBUTORS[active] : null;

	return (
		<div className={styles.page}>
			<div className={styles.aurora} aria-hidden="true">
				<span className={styles.blobA} />
				<span className={styles.blobB} />
				<span className={styles.blobC} />
			</div>
			<div className={styles.gridPattern} aria-hidden="true" />

			<header className={styles.nav}>
				<div className={styles.navInner}>
					<Link href="/" className={styles.brand}>
						<span className={styles.brandMark}>
							<img src={unilagLogoBase64} alt="UNILAG Logo" width="24" height="24" className={styles.brandLogo} />
						</span>
						<span>UniSchedule</span>
					</Link>
					<Link href="/" className={styles.backLink}>
						<ArrowLeftIcon /> Back to home
					</Link>
				</div>
			</header>

			<section className={styles.hero}>
				<span className={styles.eyebrow}>
					<span className={styles.eyebrowDot} />
					{total} contributors
				</span>
				<h1 className={styles.title}>
					Meet the <span className={styles.titleAccent}>builders</span>
				</h1>
				<p className={styles.subtitle}>
					The people who designed, built and maintain UniSchedule for the University of Lagos.
					Tap anyone to see more.
				</p>
			</section>

			<section className={styles.grid}>
				{CONTRIBUTORS.map((p, i) => (
					<ContributorCard
						key={p.name}
						person={p}
						index={i}
						hidden={active === i}
						cardRef={(el) => { cardRefs.current[i] = el; }}
						onOpen={() => openCard(i)}
					/>
				))}
			</section>

			<footer className={styles.footer}>
				<p>© {new Date().getFullYear()} University of Lagos. All rights reserved.</p>
			</footer>

			{person && (
				<div className={`${styles.overlay} ${expanded ? styles.overlayOpen : ''}`}>
					<div
						className={`${styles.panel} ${expanded ? styles.panelOpen : ''}`}
						style={panelStyle}
						role="dialog"
						aria-modal="true"
						aria-label={person.name}
					>
						<div className={styles.panelGlowA} aria-hidden="true" />
						<div className={styles.panelGlowB} aria-hidden="true" />

						<button ref={closeRef} type="button" className={styles.closeButton} onClick={closeCard} aria-label="Close">
							<CloseIcon />
						</button>

						<div className={styles.panelContent} key={active}>
							<ContributorDetail person={person} index={active} total={total} />
						</div>

						<div className={styles.panelNav}>
							<button type="button" className={styles.navButton} onClick={() => step(-1)}>
								<ArrowLeftIcon />
								<span>{CONTRIBUTORS[(active - 1 + total) % total].name}</span>
							</button>
							<button type="button" className={styles.navButton} onClick={() => step(1)}>
								<span>{CONTRIBUTORS[(active + 1) % total].name}</span>
								<ArrowRightIcon />
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
