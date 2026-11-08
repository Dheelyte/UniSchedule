// Turn a scanned or photographed signature/stamp into a clean PNG for the
// timetable PDFs: the paper becomes transparent, the ink keeps its colour, the
// empty margins are trimmed and big photos are scaled down.

const MAX_DATA_URL_CHARS = 650_000; // the API accepts up to 700k

function loadImage(file) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("That file isn't an image we can read. Use a PNG or JPG."));
		};
		img.src = url;
	});
}

function percentile(values, p) {
	const sorted = Float32Array.from(values).sort();
	return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * @param {File} file  a PNG or JPG
 * @param {{ maxSize?: number, removeBackground?: boolean }} options
 * @returns {Promise<string>} a PNG data URL
 */
export async function cleanScan(file, { maxSize = 900, removeBackground = true } = {}) {
	if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
		throw new Error('Use a PNG or JPG image.');
	}
	const img = await loadImage(file);
	let scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));

	for (;;) {
		const w = Math.max(1, Math.round(img.naturalWidth * scale));
		const h = Math.max(1, Math.round(img.naturalHeight * scale));
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(img, 0, 0, w, h);
		const data = ctx.getImageData(0, 0, w, h);
		const px = data.data;

		// An image that is already partly transparent (a PNG cut-out) has no paper
		// to remove: its transparent pixels are stored as black, which would be
		// mistaken for ink-coloured paper and wipe the whole image.
		let clear = 0;
		for (let i = 3; i < px.length; i += 4) if (px[i] < 10) clear++;
		const alreadyCutOut = clear > w * h * 0.02;

		if (removeBackground && !alreadyCutOut) {
			// The paper is the brightest common tone; ink is anything clearly darker.
			const lum = new Float32Array(w * h);
			for (let i = 0; i < w * h; i++) {
				lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
			}
			const paper = percentile(lum, 0.9);
			const lo = 22; // this much darker than the paper starts to show...
			const hi = 70; // ...and this much darker is fully opaque
			for (let i = 0; i < w * h; i++) {
				const t = Math.min(1, Math.max(0, (paper - lum[i] - lo) / (hi - lo)));
				px[i * 4 + 3] = Math.round(px[i * 4 + 3] * t);
			}
		}

		// Trim to the ink, with a little breathing room.
		let minX = w, minY = h, maxX = -1, maxY = -1;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				if (px[(y * w + x) * 4 + 3] > 24) {
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
		}
		if (maxX < 0) {
			throw new Error("Couldn't find the signature or stamp in that image. Try a sharper scan on plain white paper.");
		}
		const pad = Math.round(Math.max(w, h) * 0.02);
		minX = Math.max(0, minX - pad);
		minY = Math.max(0, minY - pad);
		maxX = Math.min(w - 1, maxX + pad);
		maxY = Math.min(h - 1, maxY + pad);
		ctx.putImageData(data, 0, 0);

		const out = document.createElement('canvas');
		out.width = maxX - minX + 1;
		out.height = maxY - minY + 1;
		out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
		const url = out.toDataURL('image/png');
		if (url.length <= MAX_DATA_URL_CHARS || scale < 0.1) return url;
		scale *= 0.75; // still too big: try smaller
	}
}
