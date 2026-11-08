import styles from './verify.module.css';

// One page per printed document: useful to whoever scans it, but not something
// to put in search results.
export const metadata = {
	title: 'Verify a timetable',
	description: 'Check that a printed University of Lagos timetable is a genuine, current FINAL version.',
	robots: { index: false, follow: false },
};

export default function VerifyLayout({ children }) {
	return <div className={styles.page}>{children}</div>;
}
