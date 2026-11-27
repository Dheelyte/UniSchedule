'use client';

import Link from 'next/link';
import { useHelpNav } from './HelpShell';
import styles from './help.module.css';

/** The Help centre's front page: the pages this role can use, grouped, with a line about each. */
export default function HelpHome() {
	const { nav, error } = useHelpNav();
	return (
		<article className={styles.article}>
			<h1 className={styles.title}>Help centre</h1>
			<p className={styles.lead}>How to use every page and feature of UniSchedule you have access to. Search on the left, or pick a page.</p>
			{error && <p className={styles.notice}>The guide couldn&apos;t be loaded. Check your connection and try again.</p>}
			{!nav && !error && <p className={styles.notice}>Loading…</p>}
			{nav?.map((group) => (
				<section key={group.title} className={styles.homeGroup} data-tour="help-content">
					<h2>{group.title}</h2>
					<ul className={styles.homeList}>
						{group.pages.map((p) => (
							<li key={p.slug}>
								<Link href={`/help/${p.slug}`}>{p.title}</Link>
								{p.summary && <span> {p.summary}</span>}
							</li>
						))}
					</ul>
				</section>
			))}
		</article>
	);
}
