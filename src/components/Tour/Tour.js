'use client';

// One page's preview: dims the page, highlights one feature at a time and
// explains it in a card with Back / Next / Skip. Each step names its feature by
// a data-tour attribute; a step whose feature isn't on screen (hidden for this
// role, or nothing to show yet) is skipped. A step with no target is a centred
// card, used to introduce the page.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './Tour.module.css';

const PAD = 6; // space around the highlighted feature
const GAP = 12; // between the feature and the card
const CARD_W = 340;

export function findTarget(target) {
	if (!target || typeof document === 'undefined') return null;
	const el = document.querySelector(`[data-tour="${target}"]`);
	if (!el) return null;
	const rect = el.getBoundingClientRect();
	// Present but not visible (collapsed, display:none, zero size).
	if (rect.width === 0 && rect.height === 0) return null;
	return el;
}

/** Where the card goes: below the feature if it fits, else above, else beside; kept on screen. */
function placeCard(rect, cardH) {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const width = Math.min(CARD_W, vw - 24);
	if (!rect) return { top: Math.max(12, (vh - cardH) / 2), left: (vw - width) / 2, width };
	let top;
	if (rect.bottom + GAP + cardH <= vh - 12) top = rect.bottom + GAP;
	else if (rect.top - GAP - cardH >= 12) top = rect.top - GAP - cardH;
	else top = Math.min(Math.max(12, rect.top), vh - cardH - 12);
	const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), vw - width - 12);
	return { top, left, width };
}

/** The steps whose features are on screen now (and every centred step). */
export function visibleSteps(steps) {
	return steps.filter((s) => !s.target || findTarget(s.target));
}

export default function Tour({ title, steps, learnMore, onClose }) {
	// Which steps show is checked again at every move, so a feature that loads
	// late is still included and one that disappears is skipped.
	const [step, setStep] = useState(() => visibleSteps(steps)[0] || null);
	const [rect, setRect] = useState(null);
	const [cardH, setCardH] = useState(180);
	const cardRef = useRef(null);
	const visible = visibleSteps(steps);
	const index = Math.max(0, visible.indexOf(step));
	const last = index >= visible.length - 1;

	const measure = useCallback(() => {
		const el = findTarget(step?.target);
		setRect(el ? el.getBoundingClientRect() : null);
	}, [step]);

	// Bring the feature into view, then measure it.
	useEffect(() => {
		const el = findTarget(step?.target);
		if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
		const frame = requestAnimationFrame(measure);
		const settle = setTimeout(measure, 350);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(settle);
		};
	}, [step, measure]);

	// Re-measure now and then: the page may still be loading or moving.
	useEffect(() => {
		const timer = setInterval(measure, 600);
		return () => clearInterval(timer);
	}, [measure]);

	useEffect(() => {
		window.addEventListener('resize', measure);
		window.addEventListener('scroll', measure, true);
		return () => {
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', measure, true);
		};
	}, [measure]);

	useLayoutEffect(() => {
		if (cardRef.current) setCardH(cardRef.current.offsetHeight);
	}, [index, rect]);

	const next = useCallback(() => {
		const now = visibleSteps(steps);
		const at = now.indexOf(step);
		if (at < 0 || at >= now.length - 1) onClose(true);
		else setStep(now[at + 1]);
	}, [steps, step, onClose]);
	const back = useCallback(() => {
		const now = visibleSteps(steps);
		const at = now.indexOf(step);
		if (at > 0) setStep(now[at - 1]);
	}, [steps, step]);

	useEffect(() => {
		const onKey = (e) => {
			if (e.key === 'Escape') onClose(true);
			else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
			else if (e.key === 'ArrowLeft') back();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [next, back, onClose]);

	useEffect(() => {
		cardRef.current?.focus();
	}, [index]);

	if (!step) return null;
	const place = placeCard(rect, cardH);
	return (
		<div className={styles.root} role="dialog" aria-modal="true" aria-labelledby="tour-title" data-testid="tour">
			{rect ? (
				<div
					className={styles.spotlight}
					style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
				/>
			) : (
				<div className={styles.dim} />
			)}
			{/* Clicks outside the card do nothing, so the page can't change under the tour. */}
			<div className={styles.blocker} onClick={(e) => e.stopPropagation()} />
			<div
				ref={cardRef}
				tabIndex={-1}
				className={styles.card}
				style={{ top: place.top, left: place.left, width: place.width }}
			>
				<p className={styles.kicker}>{title}</p>
				<h2 id="tour-title" className={styles.title}>{step.title}</h2>
				<p className={styles.body}>{step.body}</p>
				{learnMore && (
					// A new tab, so the preview and the page stay where they are.
					<a className={styles.learnMore} href={learnMore(step)} target="_blank" rel="noopener" data-testid="tour-learn-more">
						Learn more in the guide ↗
					</a>
				)}
				<div className={styles.footer}>
					<span className={styles.count}>{index + 1} of {visible.length}</span>
					<div className={styles.actions}>
						{!last && (
							<button type="button" className={styles.skip} onClick={() => onClose(true)} data-testid="tour-skip">
								Skip
							</button>
						)}
						{index > 0 && (
							<button type="button" className={styles.secondary} onClick={back}>
								Back
							</button>
						)}
						<button type="button" className={styles.primary} onClick={next} data-testid="tour-next">
							{last ? 'Done' : 'Next'}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
