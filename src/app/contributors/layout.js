export const metadata = {
	title: 'Contributors',
	description: 'Meet the people who designed, built and maintain UniSchedule, the University of Lagos timetable manager.',
	alternates: { canonical: '/contributors' },
	// Replaces the root openGraph object rather than merging with it.
	openGraph: {
		type: 'website',
		siteName: 'UniSchedule',
		locale: 'en_NG',
		url: '/contributors',
		title: 'Contributors | UniSchedule',
		description: "Meet the people who designed, built and maintain UniSchedule, the University of Lagos timetable manager.",
	},
};

export default function ContributorsLayout({ children }) {
	return children;
}
