import { SITE_URL } from '@/lib/site';

// Only the public pages: everything else needs a staff sign-in.
// Served at /sitemap.xml and listed in robots.txt.
export default function sitemap() {
	const lastModified = new Date();
	return [
		{ url: `${SITE_URL}/`, lastModified, changeFrequency: 'monthly', priority: 1 },
		{ url: `${SITE_URL}/realms`, lastModified, changeFrequency: 'yearly', priority: 0.6 },
		{ url: `${SITE_URL}/download`, lastModified, changeFrequency: 'weekly', priority: 0.9 },
		{ url: `${SITE_URL}/contributors`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
	];
}
