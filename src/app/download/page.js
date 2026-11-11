import Link from 'next/link';
import { unilagLogoBase64 } from '@/lib/logo';
import { getPublished } from '@/lib/exportServer';
import DownloadForm from './DownloadForm';
import styles from './download.module.css';

export const metadata = {
	title: 'Download a timetable',
	description:
		'Download the official University of Lagos lecture, exam and CBT timetables as print-ready PDFs. Filter by faculty, department and level. No sign-in needed.',
	alternates: { canonical: '/download' },
};

// The list of published timetables is read on the server (cached like the
// backend reads behind it), so the form shows its choices with the page
// instead of loading them after.
export const revalidate = 300;

async function readPublished() {
	try {
		return (await getPublished()) || [];
	} catch {
		return null; // the form loads it in the browser instead
	}
}

export default async function DownloadPage() {
	const published = await readPublished();

	return (
		<div className={styles.page}>
			<main className={styles.shell}>
				<header className={styles.masthead}>
					<Link href="/" className={styles.crest} aria-label="UniSchedule home">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src={unilagLogoBase64} alt="University of Lagos crest" width="96" height="96" />
					</Link>
					<p className={styles.university}>University of Lagos</p>
					<h1 className={styles.title}>Official Timetables</h1>
					<p className={styles.tagline}>Lecture, examination and CBT timetables · UniSchedule</p>
				</header>

				<DownloadForm initialPublished={published} />
			</main>
		</div>
	);
}
