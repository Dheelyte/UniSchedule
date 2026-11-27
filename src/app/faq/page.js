import Link from 'next/link';
import { PublicLayout } from '@/components/Public/PublicChrome';
import { publicQuestions } from '@/lib/publicFaq';
import styles from './faq.module.css';

export const metadata = {
	title: 'Common questions',
	description:
		'Answers for students and visitors: getting your University of Lagos timetable, what FINAL means, and checking a printed copy.',
	alternates: { canonical: '/faq' },
};

// Built with the site from the questions tagged "public" in the guide.
export default function FaqPage() {
	const questions = publicQuestions();
	return (
		<PublicLayout>
			<div className={styles.page}>
				<header className={styles.intro}>
					<p className={styles.slot}>For students and visitors</p>
					<h1 className={styles.title}>Common questions</h1>
					<p className={styles.lead}>
						Getting your timetable and checking a printed copy. Staff will find the full guide in the Help centre after signing in.
					</p>
				</header>
				<div className={styles.list}>
					{questions.map((q) => (
						<details key={q.id} id={q.id} className={styles.item}>
							<summary className={styles.question}>{q.question}</summary>
							<div className={styles.answer} dangerouslySetInnerHTML={{ __html: q.html }} />
						</details>
					))}
				</div>
				<p className={styles.more}>
					Still stuck? Ask your department or faculty&apos;s timetable officer. <Link href="/download">Download a timetable</Link> ·{' '}
					<Link href="/verify">Check a printed copy</Link>
				</p>
			</div>
		</PublicLayout>
	);
}
