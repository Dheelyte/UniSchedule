// The public address of the site, for canonical URLs, the sitemap and link
// previews. Override with NEXT_PUBLIC_SITE_URL (e.g. for a staging deploy).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.unilagtimetable.com').replace(/\/$/, '');

export const SITE_NAME = 'UniSchedule';
export const SITE_TITLE = 'UniSchedule: University of Lagos Timetable Manager';
export const SITE_DESCRIPTION =
	'UniSchedule is the University of Lagos timetable manager. Timetable officers build lecture, exam and CBT timetables for every faculty, with clashes caught before anything is published.';

// Pages only signed-in staff can use. Kept out of search results.
export const PRIVATE_PATHS = [
	'/activity',
	'/courses',
	'/faculties',
	'/requests',
	'/rooms',
	'/staff',
	'/terms',
	'/timetable',
	'/signoffs',
	'/register',
	'/forgot-password',
];

// Read before React loads, to hide the landing page from someone who is
// probably signed in (see the inline script in app/layout.js).
export const SESSION_HINT_KEY = 'unischedule.session';
