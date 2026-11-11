// The display face for the public pages (headings only; body text stays in
// the site's sans-serif). Apply `displayFont.variable` on the page's root.
import { Plus_Jakarta_Sans } from 'next/font/google';

export const displayFont = Plus_Jakarta_Sans({
	subsets: ['latin'],
	// Headings only use the heaviest weight; one file instead of three.
	weight: ['800'],
	variable: '--font-display',
	display: 'swap',
});
