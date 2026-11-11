import Link from 'next/link';
import { unilagLogoBase64 } from '@/lib/logo';
import { getPublished } from '@/lib/exportServer';
import DownloadForm from './DownloadForm';
import { downloadableEntries, KIND_TITLE } from './entries';
import styles from './download.module.css';

export const metadata = {
	title: 'Download a timetable',
	description:
		'Download the official University of Lagos lecture, exam and CBT timetables as print-ready PDFs. Filter by faculty, department and level. No sign-in needed.',
	alternates: { canonical: '/download' },
};

// The list of published timetables is read on the server (cached like the
// backend reads behind it), so it is in the page itself: search engines see
// which timetables are available, and the form needs no second request.
export const revalidate = 300;

async function readPublished() {
	try {
		return (await getPublished()) || [];
	} catch {
		return null; // the form loads it in the browser instead
	}
}

const downloadHref = (e) => {
	const q = new URLSearchParams({ realm: e.realm_key, semester: String(e.semester_id), type: e.kind });
	if (e.code) q.set('code', e.code);
	return `/api/export?${q}`;
};

export default async function DownloadPage() {
	const published = await readPublished();
	const entries = published ? downloadableEntries(published) : [];

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

				{entries.length > 0 && (
					<section className={styles.listCard} aria-labelledby="published-heading">
						<h2 id="published-heading" className={styles.subheading}>Published timetables</h2>
						<ul className={styles.list}>
							{entries.map((e) => (
								<li key={`${e.realm_key}:${e.semester_id}:${e.kind}`}>
									<a href={downloadHref(e)} download>
										UNILAG {e.session_name} {e.semester_name} {KIND_TITLE[e.kind]}
									</a>
									<span>
										{e.realm_name} · FINAL{e.code ? ` · ${e.code}` : ''}
									</span>
								</li>
							))}
						</ul>
					</section>
				)}
			</main>
		</div>
	);
}
