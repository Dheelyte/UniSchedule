import { CodeForm, Shell } from './VerifyCard';
import styles from './verify.module.css';

export default function VerifyIndexPage() {
	return (
		<Shell>
			<section className={styles.card}>
				<h1 className={styles.heading}>Verify a timetable</h1>
				<p className={styles.body}>
					Every FINAL timetable printed from UniSchedule carries a QR code and a code like{' '}
					<code className={styles.code}>UG-7K3P-92QD</code> at the bottom of each page. Scan the QR code, or type
					the code below, to check the copy is genuine and still current.
				</p>
				<CodeForm />
			</section>
		</Shell>
	);
}
