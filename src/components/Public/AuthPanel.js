'use client';

// The sign-in pages (programme choice, sign in, password reset, register):
// the shared header and footer around one centred column, the introduction
// above the form.
import { PublicLayout } from './PublicChrome';
import styles from './auth.module.css';

export default function AuthPanel({ slot, title, intro, children, after = null }) {
	return (
		<PublicLayout callout={false}>
			<div className={styles.wrap}>
				<div className={styles.intro}>
					{slot && <p className={styles.slot}>{slot}</p>}
					<h1 className={styles.title}>{title}</h1>
					{intro && <p className={styles.text}>{intro}</p>}
				</div>
				<div className={styles.column}>
					<section className={styles.panel}>{children}</section>
					{after}
				</div>
			</div>
		</PublicLayout>
	);
}

export { styles as authStyles };
