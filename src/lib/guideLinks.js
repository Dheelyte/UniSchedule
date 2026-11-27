// Links in the user guide (backend/guide/*.md) as website links: "courses.md#x"
// is /help/courses#x and "README.md" is /help. Safe to use in the browser.

/** A guide link as a Help centre link. Absolute and external links are kept. */
export function helpHref(target, fromSlug) {
	if (/^[a-z]+:/i.test(target) || target.startsWith('/')) return target;
	const [file, anchor] = target.split('#');
	const slug = file ? file.replace(/\.md$/, '') : fromSlug;
	const path = slug === 'README' ? '/help' : `/help/${slug}`;
	return anchor ? `${path}#${anchor}` : path;
}
