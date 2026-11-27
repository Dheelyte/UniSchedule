'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Marked } from 'marked';
import { apiClient } from '@/lib/apiClient';
import { helpHref } from '@/lib/guideLinks';
import styles from './help.module.css';

function render(markdown, slug) {
	const marked = new Marked({ gfm: true });
	marked.use({
		walkTokens(token) {
			if (token.type === 'link') token.href = helpHref(token.href, slug);
		},
	});
	// The page draws its own title.
	return marked.parse(markdown.replace(/^# .+\n/m, ''));
}

function Sections({ sections }) {
	return (
		<ul>
			{sections.map((s) => (
				<li key={s.id}>
					<a href={`#${s.id}`}>{s.title}</a>
				</li>
			))}
		</ul>
	);
}

/** Scroll to the #section in the address, and highlight its heading (links from previews land mid-page). */
function scrollToHash() {
	const id = decodeURIComponent(window.location.hash.slice(1));
	const el = id && document.getElementById(id);
	if (!el) return;
	el.scrollIntoView({ block: 'start' });
	const heading = el.closest('p')?.nextElementSibling || el.nextElementSibling || el;
	heading.classList.add(styles.targeted);
}

/** One guide page, as the signed-in role is allowed to see it. */
export default function GuidePage({ slug }) {
	// { slug, page } or { slug, missing } once loaded, so another page's answer never shows.
	const [state, setState] = useState(null);

	useEffect(() => {
		let cancelled = false;
		apiClient
			.get(`/help/pages/${encodeURIComponent(slug)}`)
			.then((page) => !cancelled && setState({ slug, page }))
			.catch(() => !cancelled && setState({ slug, missing: true }));
		return () => {
			cancelled = true;
		};
	}, [slug]);

	const ready = state?.slug === slug;
	const page = ready ? state.page : null;
	const html = useMemo(() => (page ? render(page.markdown, slug) : ''), [page, slug]);

	useEffect(() => {
		if (html) requestAnimationFrame(scrollToHash);
	}, [html]);

	if (!ready) {
		return (
			<article className={styles.article}>
				<p className={styles.notice}>Loading…</p>
			</article>
		);
	}
	if (state.missing) {
		return (
			<article className={styles.article}>
				<h1 className={styles.title}>Page not found</h1>
				<p className={styles.notice}>
					There&apos;s no help page here for you. <Link href="/help">Go to the Help centre</Link>.
				</p>
			</article>
		);
	}
	const listSections = page.sections.length > 2;
	return (
		<article className={styles.article}>
			<Link href="/help" className={styles.back}>
				← Help centre
			</Link>
			{listSections && (
				<nav className={styles.onThisPage} aria-label="On this page">
					<p className={styles.onThisPageTitle}>On this page</p>
					<Sections sections={page.sections} />
				</nav>
			)}
			<h1 className={styles.title}>{page.title}</h1>
			{listSections && (
				// On a phone the list folds away under the title.
				<details className={styles.onThisPageFolded}>
					<summary>On this page ({page.sections.length})</summary>
					<Sections sections={page.sections} />
				</details>
			)}
			<div className={styles.content} data-tour="help-content" dangerouslySetInnerHTML={{ __html: html }} />
		</article>
	);
}
