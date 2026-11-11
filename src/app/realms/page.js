'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthPanel, { authStyles as styles } from '@/components/Public/AuthPanel';
import { apiClient } from '@/lib/apiClient';
import { FALLBACK_REALMS, loginPath } from '@/lib/realm';

// What each programme is, for the choice list. Others show their name only.
const ABOUT = {
	UG: 'Full-time undergraduate degrees',
	ICE: 'Part-time programmes (Institute of Continuing Education)',
};

export default function RealmSelectPage() {
	// The static list shows until the API answers, and stays if it can't.
	const [realms, setRealms] = useState(FALLBACK_REALMS);

	useEffect(() => {
		let mounted = true;
		apiClient
			.get('/realms')
			.then((res) => {
				if (mounted && Array.isArray(res) && res.length > 0) setRealms(res);
			})
			.catch(() => {});
		return () => {
			mounted = false;
		};
	}, []);

	return (
		<AuthPanel
			slot="Staff sign in"
			title={<>Choose your <mark>programme.</mark></>}
			intro="Each programme has its own calendar, faculties and rooms. Sign in to the one you work on; super admins can switch later."
			after={
				<p className={styles.aside}>
					Looking for a timetable? You don&apos;t need to sign in. <Link href="/download">Download one here</Link>.
				</p>
			}
		>
			<h2 className={styles.panelTitle}>Programmes</h2>
			<div className={styles.choices}>
				{realms.map((realm) =>
					realm.is_live ? (
						<Link key={realm.key} href={loginPath(realm.key)} className={styles.choice}>
							<span>
								{realm.name}
								{ABOUT[realm.key] && <small>{ABOUT[realm.key]}</small>}
							</span>
							<span className={styles.choiceArrow} aria-hidden="true">→</span>
						</Link>
					) : (
						<button key={realm.key} type="button" className={`${styles.choice} ${styles.choiceSoon}`} disabled>
							<span>{realm.name}</span>
							<span className={styles.soonTag}>Coming soon</span>
						</button>
					)
				)}
			</div>
		</AuthPanel>
	);
}
