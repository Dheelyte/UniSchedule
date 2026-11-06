'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './realms.module.css';
import { unilagLogoBase64 } from '@/lib/logo';
import { apiClient } from '@/lib/apiClient';
import { FALLBACK_REALMS, loginPath } from '@/lib/realm';

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
		<div className={styles.container}>
			<div className={styles.card}>
				<div
					className={styles.logo}
					style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
				>
					<img
						src={unilagLogoBase64}
						alt="UNILAG Logo"
						width="100"
						height="100"
						style={{ borderRadius: '4px', objectFit: 'contain' }}
					/>
				</div>
				<h1 className={styles.title}>Select a program</h1>
				<p
					className={styles.subtitle}
					style={{ fontSize: '1rem', fontWeight: 'bold', letterSpacing: '1px' }}
				>
					Choose a program to log in to
				</p>

				<div className={styles.realmList}>
					{realms.map((realm) =>
						realm.is_live ? (
							<Link key={realm.key} href={loginPath(realm.key)} className={styles.button}>
								Sign in as {realm.name}
							</Link>
						) : (
							<button key={realm.key} type="button" className={styles.buttonDisabled} disabled>
								{realm.name}
								<span className={styles.comingSoon}>Coming soon</span>
							</button>
						)
					)}
				</div>
			</div>
		</div>
	);
}