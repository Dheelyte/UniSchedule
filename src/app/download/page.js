import DownloadForm from './DownloadForm';
import styles from './download.module.css';

export const metadata = {
	title: 'Download a timetable',
	description:
		'Download the official University of Lagos lecture, exam and CBT timetables as PDF or CSV. Filter by faculty, department and level. No sign-in needed.',
	alternates: { canonical: '/download' },
};

export default function DownloadPage() {
	return (
		<div className={styles.page}>
			<DownloadForm />
		</div>
	);
}
