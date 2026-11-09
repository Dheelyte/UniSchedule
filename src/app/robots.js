import { PRIVATE_PATHS, SITE_URL } from '@/lib/site';

// /api/ serves the timetable files and the download page's lists. Links to
// them are on public pages, so without this, crawlers would follow them and
// have the server build PDFs nobody reads (and could list raw files in search
// results instead of /download, which always links the current version).
const NOT_FOR_CRAWLERS = ['/api/'];

export default function robots() {
	return {
		rules: {
			userAgent: '*',
			allow: '/',
			disallow: [...PRIVATE_PATHS, ...NOT_FOR_CRAWLERS],
		},
		sitemap: `${SITE_URL}/sitemap.xml`,
		host: SITE_URL,
	};
}
