'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { normaliseCode, Result, Shell } from '../VerifyCard';
import styles from '../verify.module.css';

export default function VerifyCodePage() {
	const params = useParams();
	const code = normaliseCode(decodeURIComponent(params?.code || ''));
	// The last lookup that finished, so a stale answer never shows for another code.
	const [state, setState] = useState({ code: null, result: null, error: false });

	useEffect(() => {
		let cancelled = false;
		apiClient
			.get(`/verify/${encodeURIComponent(code)}`)
			.then((result) => !cancelled && setState({ code, result, error: false }))
			.catch(() => !cancelled && setState({ code, result: null, error: true }));
		return () => {
			cancelled = true;
		};
	}, [code]);

	const ready = state.code === code;
	return (
		<Shell>
			{ready ? (
				<Result code={code} result={state.result} error={state.error} />
			) : (
				<section className={styles.card}>
					<p className={styles.body}>Checking <code className={styles.code}>{code}</code>…</p>
				</section>
			)}
		</Shell>
	);
}
