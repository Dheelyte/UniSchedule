import Link from 'next/link';
import { getPublished } from '@/lib/exportServer';
import { PublicLayout } from '@/components/Public/PublicChrome';
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
		<PublicLayout callout={false}>
			<div className={styles.intro}>
				<p className={styles.introSlot}>Open to everyone · no sign-in</p>
				<h1 className={styles.introTitle}>
					Download a timetable, <mark>ready to print.</mark>
				</h1>
				<p className={styles.introText}>
					Every FINAL lecture, exam and CBT timetable for the University of Lagos, as an A3 PDF in
					black and white. Each copy carries a QR code that confirms it is genuine and current.
				</p>
			</div>
			<div className={styles.layout}>
				<DownloadForm initialPublished={published} />
				<aside className={styles.aside}>
					<section className={`${styles.side} ${styles.sideYellow}`}>
						<p className={styles.slot}>Got a printed copy?</p>
						<h2 className={styles.sideTitle}>Check it is current</h2>
						<p>Scan the QR code on any page, or type the code printed under it.</p>
						<Link href="/verify" className={styles.sideLink}>Check a printed copy</Link>
					</section>
					<section className={styles.side}>
						<p className={styles.slot}>About the files</p>
						<ul className={styles.facts}>
							<li>A3, landscape, black and white: ready for a notice board.</li>
							<li>FINAL timetables only. Drafts are never published.</li>
							<li>A new version shows here as soon as the timetable office locks it.</li>
						</ul>
					</section>
				</aside>
			</div>
		</PublicLayout>
	);
}
