'use client';

// Plays a page's preview the first time someone opens that page, while previews
// are on (the default). The "?" button replays it and turns previews on or off.
// Signed in only (the public pages have no previews); the choice and the pages
// seen are kept on the account (/tours).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { guideHref, guidePageHref, stepsFor, tourFor } from '@/lib/tours';
import Tour, { visibleSteps } from './Tour';
import styles from './Tour.module.css';

// How long to wait for a page's features to appear (data still loading).
const WAIT_MS = 6000;
const POLL_MS = 250;
const STEADY_CHECKS = 4;

export default function TourController() {
	const pathname = usePathname();
	const { user, loading } = useAuth();
	const [prefs, setPrefs] = useState(null);
	// Both remember the page they were opened on, so moving to another page closes them.
	const [opened, setActive] = useState(null); // { path, key, title, steps }
	const [menuPath, setMenuPath] = useState(null);
	const played = useRef(new Set()); // pages auto-played this visit, so a slow save never replays one
	const signedIn = Boolean(user);
	// Kept between renders, so the auto-play timer only restarts when the page changes.
	const tour = useMemo(() => tourFor(pathname, signedIn), [pathname, signedIn]);

	// Load the preferences once we know who's here.
	useEffect(() => {
		if (loading || !signedIn) return;
		let cancelled = false;
		apiClient
			.get('/tours', { fresh: true })
			.then((state) => !cancelled && setPrefs(state))
			.catch(() => !cancelled && setPrefs({ enabled: true, seen: [], offline: true }));
		return () => {
			cancelled = true;
		};
	}, [loading, signedIn, user?.id]);

	const save = useCallback(
		async (change) => {
			const before = prefs;
			const next = change(before);
			setPrefs(next);
			try {
				if (next.enabled !== before.enabled) setPrefs(await apiClient.put('/tours', { enabled: next.enabled }));
				const added = next.seen.find((k) => !before.seen.includes(k));
				if (added) setPrefs(await apiClient.post('/tours/seen', { page: added }));
			} catch {
				// Kept for this visit; it will be saved next time it changes.
			}
		},
		[prefs],
	);

	const start = useCallback(
		(page, steps) => {
			if (visibleSteps(steps).length) setActive({ path: pathname, key: page.key, page, steps });
		},
		[pathname],
	);
	const active = opened?.path === pathname ? opened : null;
	const menuOpen = menuPath === pathname;
	const setMenuOpen = (open) => setMenuPath(open ? pathname : null);

	// Auto-play: previews on, this page not seen yet, not while acting as someone else.
	useEffect(() => {
		if (!tour || !prefs || !prefs.enabled || active) return;
		if (prefs.seen.includes(tour.key) || played.current.has(tour.key)) return;
		if (user?.impersonating) return;
		const steps = stepsFor(tour, user);
		// Start once the page has stopped changing: the same features on screen
		// for a few checks in a row (its data has arrived), or after WAIT_MS.
		let waited = 0;
		let last = -1;
		let steady = 0;
		const timer = setInterval(() => {
			waited += POLL_MS;
			// Only features count: a centred step is always "visible".
			const count = visibleSteps(steps).filter((s) => s.target).length;
			const needed = steps.some((s) => s.target) ? 1 : 0;
			steady = count === last ? steady + 1 : 0;
			last = count;
			if ((count >= needed && steady >= STEADY_CHECKS) || waited >= WAIT_MS) {
				clearInterval(timer);
				played.current.add(tour.key);
				// None of the page's features showed (it isn't for this person, or
				// didn't load): play nothing, and leave it unseen for next time.
				if (count >= needed) start(tour, steps);
			}
		}, POLL_MS);
		return () => clearInterval(timer);
	}, [tour, prefs, active, user, start]);

	const close = useCallback(() => {
		const key = active?.key;
		setActive(null);
		if (key) save((p) => (p.seen.includes(key) ? p : { ...p, seen: [...p.seen, key] }));
	}, [active, save]);

	if (!signedIn || !tour || !prefs) return null;
	return (
		<>
			{active && (
				<Tour
					key={active.key}
					title={active.page.title}
					steps={active.steps}
					learnMore={(step) => guideHref(active.page, step)}
					onClose={close}
				/>
			)}
			{/* Stays on screen during a preview (under it), so the preview can point at it. */}
			{(
				<div className={styles.help} data-tour="tour-help">
					{menuOpen && !active && (
						<div className={styles.menu} role="menu">
							<button
								type="button"
								role="menuitem"
								className={styles.menuItem}
								onClick={() => {
									setMenuOpen(false);
									start(tour, stepsFor(tour, user));
								}}
								data-testid="tour-replay"
							>
								Show this page&apos;s preview
							</button>
							<button
								type="button"
								role="menuitem"
								className={styles.menuItem}
								onClick={() => {
									setMenuOpen(false);
									save((p) => (p.enabled ? { ...p, enabled: false } : { enabled: true, seen: [] }));
								}}
								data-testid="tour-toggle"
							>
								{prefs.enabled ? 'Turn previews off' : 'Turn previews on'}
							</button>
							{tour.key !== 'help' && (
								<Link
									href={guidePageHref(tour)}
									role="menuitem"
									className={styles.menuItem}
									onClick={() => setMenuOpen(false)}
									data-testid="tour-guide"
								>
									Open the guide for this page
								</Link>
							)}
							<Link href="/help" role="menuitem" className={styles.menuItem} onClick={() => setMenuOpen(false)}>
								Help centre
							</Link>
							<p className={styles.menuNote}>
								{prefs.enabled
									? 'Each page shows its preview the first time you open it.'
									: 'Previews are off. You can still open one from here.'}
							</p>
						</div>
					)}
					<button
						type="button"
						className={styles.helpButton}
						aria-label="Page preview"
						aria-expanded={menuOpen}
						onClick={() => setMenuOpen(!menuOpen)}
						data-testid="tour-help"
					>
						?
					</button>
				</div>
			)}
		</>
	);
}
