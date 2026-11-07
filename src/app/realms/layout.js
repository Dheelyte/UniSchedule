export const metadata = {
	title: 'Choose your programme',
	description: 'Sign in to UniSchedule for your programme: Undergraduate or ICE (part-time) at the University of Lagos.',
	alternates: { canonical: '/realms' },
	// Replaces the root openGraph object rather than merging with it.
	openGraph: {
		type: 'website',
		siteName: 'UniSchedule',
		locale: 'en_NG',
		url: '/realms',
		title: 'Choose your programme | UniSchedule',
		description: "Sign in to UniSchedule for your programme: Undergraduate or ICE (part-time) at the University of Lagos.",
	},
};

export default function RealmsLayout({ children }) {
	return children;
}
