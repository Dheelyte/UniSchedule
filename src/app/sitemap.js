import { SITE_URL } from '@/lib/site';

// Only the public pages: everything else needs a staff sign-in.
export default function sitemap() {
	return [
		{ url: `${SITE_URL}/`, changeFrequency: 'monthly', priority: 1 },
		{ url: `${SITE_URL}/realms`, changeFrequency: 'yearly', priority: 0.6 },
		{ url: `${SITE_URL}/contributors`, changeFrequency: 'monthly', priority: 0.5 },
	];
}
