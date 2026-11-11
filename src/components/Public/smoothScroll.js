// Slide to a section on the same page instead of jumping. The browser's
// built-in smooth scroll can't be slowed down, so this animates it: an
// ease-in-out glide of 0.9-1.8s depending on distance. Any wheel, touch or key
// press hands control straight back to the visitor, and people who ask their
// device to reduce motion get the plain jump.
let slideFrame = 0;

function stopSlide() {
	cancelAnimationFrame(slideFrame);
	slideFrame = 0;
	window.removeEventListener('wheel', stopSlide);
	window.removeEventListener('touchstart', stopSlide);
	window.removeEventListener('keydown', stopSlide);
}

function easeInOutCubic(t) {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function slideTo(targetY) {
	stopSlide();
	const startY = window.scrollY;
	const distance = targetY - startY;
	const duration = Math.min(1800, Math.max(900, 500 + Math.abs(distance) * 0.5));
	const startTime = performance.now();
	const frame = (now) => {
		const t = Math.min(1, (now - startTime) / duration);
		window.scrollTo(0, startY + distance * easeInOutCubic(t));
		if (t < 1) slideFrame = requestAnimationFrame(frame);
		else stopSlide();
	};
	window.addEventListener('wheel', stopSlide, { passive: true });
	window.addEventListener('touchstart', stopSlide, { passive: true });
	window.addEventListener('keydown', stopSlide);
	slideFrame = requestAnimationFrame(frame);
}

/**
 * onClick for a link to "#id" (or "/#id" while on the homepage). Links to
 * another page are left to the browser.
 */
export function scrollToSection(e) {
	const href = e.currentTarget.getAttribute('href') || '';
	const hash = href.slice(href.indexOf('#'));
	const onThisPage = href.startsWith('#') || (href.startsWith('/#') && window.location.pathname === '/');
	if (!onThisPage || hash.length < 2) return;
	const target = document.getElementById(hash.slice(1));
	if (!target) return;
	e.preventDefault();
	history.replaceState(null, '', hash);
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		target.scrollIntoView({ block: 'start' });
		return;
	}
	// Stop below the sticky header (the section's scroll-margin-top).
	const offset = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
	const maxY = document.documentElement.scrollHeight - window.innerHeight;
	slideTo(Math.min(maxY, target.getBoundingClientRect().top + window.scrollY - offset));
}
