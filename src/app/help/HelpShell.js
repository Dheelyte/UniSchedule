'use client';

// The Help centre's frame, inside the app (signed in only): the guide's pages
// down the side and a search box. Everything comes from the backend, filtered
// for the signed-in role. The search index is fetched the first time someone
// uses search, not with every page.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import styles from './help.module.css';

const MAX_RESULTS = 12;
const NavContext = createContext({ nav: null, error: false });

export const useHelpNav = () => useContext(NavContext);

/** Sections matching every word of the query, best first: title matches, then text matches. */
export function searchGuide(index, query) {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length || !index) return [];
	return index
		.map((e) => {
			const title = e.title.toLowerCase();
			const text = `${title} ${e.page.toLowerCase()} ${e.text.toLowerCase()}`;
			if (!words.every((w) => text.includes(w))) return null;
			// A title word starting with the search word counts most, then the word anywhere in the title.
			const starts = words.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)).length;
			return { ...e, score: starts * 2 + words.filter((w) => title.includes(w)).length };
		})
		.filter(Boolean)
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_RESULTS);
}

function Search() {
	const [query, setQuery] = useState('');
	const [index, setIndex] = useState(null);
	const [loading, setLoading] = useState(false);
	const results = useMemo(() => searchGuide(index, query), [index, query]);
	const pathname = usePathname();
	// A result was opened: clear the box.
	const [lastPath, setLastPath] = useState(pathname);
	if (lastPath !== pathname) {
		setLastPath(pathname);
		setQuery('');
	}
	const load = () => {
		if (index || loading) return;
		setLoading(true);
		apiClient
			.get('/help/search')
			.then(setIndex)
			.catch(() => setIndex([]))
			.finally(() => setLoading(false));
	};
	return (
		<div className={styles.search} data-tour="help-search">
			<label className={styles.searchLabel} htmlFor="help-search">Search the guide</label>
			<input
				id="help-search"
				type="search"
				className={styles.searchInput}
				placeholder="e.g. conflict, export, room"
				value={query}
				onFocus={load}
				onChange={(e) => {
					load();
					setQuery(e.target.value);
				}}
				autoComplete="off"
			/>
			{query.trim() && (
				<ul className={styles.results} aria-label="Search results">
					{!index && <li className={styles.noResults}>Searching…</li>}
					{index && results.length === 0 && <li className={styles.noResults}>Nothing matches “{query.trim()}”.</li>}
					{results.map((r) => (
						<li key={r.href}>
							<Link href={r.href} className={styles.result}>
								<span className={styles.resultTitle}>{r.title}</span>
								<span className={styles.resultPage}>{r.page}</span>
								{r.text && <span className={styles.resultText}>{r.text.slice(0, 120)}…</span>}
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function Nav({ nav }) {
	const pathname = usePathname();
	return (
		<nav className={styles.nav} aria-label="Guide pages" data-tour="help-nav">
			<Link href="/help" className={`${styles.navLink} ${pathname === '/help' ? styles.navActive : ''}`}>
				Help centre home
			</Link>
			{nav?.map((group) => (
				<div key={group.title} className={styles.navGroup}>
					<p className={styles.navGroupTitle}>{group.title}</p>
					{group.pages.map((p) => {
						const href = `/help/${p.slug}`;
						return (
							<Link key={p.slug} href={href} className={`${styles.navLink} ${pathname === href ? styles.navActive : ''}`}>
								{p.title}
							</Link>
						);
					})}
				</div>
			))}
		</nav>
	);
}

export default function HelpShell({ children }) {
	const [state, setState] = useState({ nav: null, error: false });
	useEffect(() => {
		let cancelled = false;
		apiClient
			.get('/help/nav')
			.then((nav) => !cancelled && setState({ nav, error: false }))
			.catch(() => !cancelled && setState({ nav: null, error: true }));
		return () => {
			cancelled = true;
		};
	}, []);
	return (
		<NavContext.Provider value={state}>
			<div className={styles.layout}>
				<aside className={styles.side}>
					<Search />
					<Nav nav={state.nav} />
				</aside>
				<div className={styles.main}>{children}</div>
			</div>
		</NavContext.Provider>
	);
}
