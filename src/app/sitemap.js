import { SITE_URL } from '@/lib/site';
import { getPublished } from '@/lib/exportServer';

// Only the public pages: everything else needs a staff sign-in.
// Served at /sitemap.xml and listed in robots.txt.
//
// Dates change only when the page does: search engines ignore a date that is
// always "now". /download changes when a timetable is marked FINAL.
export const revalidate = 3600;

// When the other public pages last changed. Update when one changes.
const PAGES_UPDATED = new Date('2026-11-11');

async function lastPublished() {
	try {
		const times = ((await getPublished()) || []).map((t) => Date.parse(t.locked_at)).filter(Number.isFinite);
		return times.length ? new Date(Math.max(...times)) : PAGES_UPDATED;
	} catch {
		return PAGES_UPDATED;
	}
}

export default async function sitemap() {
	return [
		{ url: `${SITE_URL}/`, lastModified: PAGES_UPDATED, changeFrequency: 'monthly', priority: 1 },
		{ url: `${SITE_URL}/realms`, lastModified: PAGES_UPDATED, changeFrequency: 'yearly', priority: 0.6 },
		{ url: `${SITE_URL}/download`, lastModified: await lastPublished(), changeFrequency: 'weekly', priority: 0.9 },
		{ url: `${SITE_URL}/contributors`, lastModified: PAGES_UPDATED, changeFrequency: 'monthly', priority: 0.5 },
	];
}
