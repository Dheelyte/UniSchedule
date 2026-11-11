import { PublicLayout } from '@/components/Public/PublicChrome';

// One page per printed document: useful to whoever scans it, but not something
// to put in search results.
export const metadata = {
	title: 'Verify a timetable',
	description: 'Check that a printed University of Lagos timetable is a genuine, current FINAL version.',
	robots: { index: false, follow: false },
};

export default function VerifyLayout({ children }) {
	return <PublicLayout>{children}</PublicLayout>;
}
