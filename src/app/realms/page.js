'use client';

import Link from 'next/link';
import styles from './realms.module.css';
import { unilagLogoBase64 } from '@/lib/logo';

const REALMS = [
	{ key: 'undergrad', label: 'Undergraduate', href: '/login', active: true },
	{ key: 'pg', label: 'Postgraduate', href: null, active: false },
	{ key: 'ice', label: 'ICE', href: null, active: false },
	{ key: 'foundation', label: 'Foundation', href: null, active: false },
];

export default function RealmSelectPage() {
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
					{REALMS.map((realm) =>
						realm.active ? (
							<Link key={realm.key} href={realm.href} className={styles.button}>
								Sign in as {realm.label}
							</Link>
						) : (
							<button key={realm.key} type="button" className={styles.buttonDisabled} disabled>
								{realm.label}
								<span className={styles.comingSoon}>Coming soon</span>
							</button>
						)
					)}
				</div>
			</div>
		</div>
	);
}