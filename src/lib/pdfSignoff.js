// Sign-off for exported timetable PDFs.
//
// A FINAL (locked) timetable gets a strip on every timetable page: the
// verification QR code and link on the left, the stamp and the signatory's
// signature, name and title on the right. The cover only says what is inside,
// so it carries the verification QR code but no stamp or signature (a signed
// cover with no timetable on it is the easiest page to misuse). A draft gets a
// faint DRAFT watermark instead, so an unofficial copy can't pass as official.
//
// `signoff` comes with the export bundle, plus `qr_data_url` (see
// signoffQrDataUrl in src/lib/exportJob.js). Renderers reserve SIGNOFF_STRIP_H above their footer
// when isSigned(signoff), then call applySignoff() just before saving.
import { SITE_URL } from "./site.js";

export const SIGNOFF_STRIP_H = 18; // mm, at scale 1

export function isSigned(signoff) {
	return !!(signoff && signoff.is_locked && signoff.verification?.code);
}

export function verifyUrl(code) {
	return `${SITE_URL}/verify/${code}`;
}

// Fit an image inside a box, keeping its shape; centred.
function drawFitted(pdf, dataUrl, x, y, w, h) {
	if (!dataUrl) return;
	try {
		const { width, height } = pdf.getImageProperties(dataUrl);
		const s = Math.min(w / width, h / height);
		const dw = width * s;
		const dh = height * s;
		pdf.addImage(dataUrl, "PNG", x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, undefined, "FAST");
	} catch {
		// A broken image must never stop the export.
	}
}

function withOpacity(pdf, opacity, draw) {
	let saved = false;
	try {
		pdf.saveGraphicsState();
		saved = true;
		pdf.setGState(new pdf.GState({ opacity }));
	} catch {
		// Older viewers/builds without transparency just draw it solid.
	}
	draw();
	if (saved) pdf.restoreGraphicsState();
}

/**
 * The sign-off strip, its bottom edge at `bottom`, spanning x0..x1.
 * `verificationOnly` leaves out the stamp and signature (cover pages).
 */
export function drawSignoffStrip(pdf, signoff, { x0, x1, bottom, scale = 1, verificationOnly = false }) {
	const s = scale;
	const H = SIGNOFF_STRIP_H * s;
	const top = bottom - H;
	const code = signoff.verification.code;
	const url = verifyUrl(code);

	// ---- Left: verification ----
	drawFitted(pdf, signoff.qr_data_url, x0, top, H, H);
	const tx = x0 + H + 3 * s;
	pdf.setFont("helvetica", "bold");
	pdf.setFontSize(8 * s);
	pdf.setTextColor(16, 185, 129);
	pdf.text("FINAL TIMETABLE", tx, top + 4.5 * s);
	pdf.setFont("helvetica", "normal");
	pdf.setFontSize(7 * s);
	pdf.setTextColor(71, 85, 105);
	pdf.text("Verify this copy:", tx, top + 9 * s);
	pdf.setFont("helvetica", "bold");
	pdf.setTextColor(79, 70, 229);
	pdf.textWithLink(url.replace(/^https?:\/\//, ""), tx + pdf.getTextWidth("Verify this copy: "), top + 9 * s, { url });
	pdf.setFont("helvetica", "normal");
	pdf.setFontSize(6 * s);
	pdf.setTextColor(148, 163, 184);
	pdf.text("Scan the code or visit the link to confirm this copy is genuine and current.", tx, top + 13 * s);
	pdf.text(`Code ${code}`, tx, top + 16.5 * s);

	if (verificationOnly) return;

	// ---- Right: stamp + signature ----
	const blockW = 54 * s;
	const blockX = x1 - blockW;
	const cx = blockX + blockW / 2;
	const name = (signoff.signatory_name || "").trim();
	const title = (signoff.signatory_title || "").trim();
	let lineY = top + 11.5 * s;
	if (signoff.signature_image) {
		drawFitted(pdf, signoff.signature_image, blockX + 2 * s, top, blockW - 4 * s, 11 * s);
		pdf.setDrawColor(100, 116, 139);
		pdf.setLineWidth(0.25);
		pdf.line(blockX, lineY, x1, lineY);
	} else {
		// No signature (public copies never carry one): an empty signature line
		// would read as unsigned, so name who approved it instead.
		lineY = top + 5.5 * s;
		if (name || title) {
			pdf.setFont("helvetica", "normal");
			pdf.setFontSize(6 * s);
			pdf.setTextColor(148, 163, 184);
			pdf.text("Approved by", cx, top + 4.5 * s, { align: "center" });
		}
	}
	pdf.setTextColor(15, 23, 42);
	if (name) {
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(7.5 * s);
		pdf.text(name, cx, lineY + 3.2 * s, { align: "center", maxWidth: blockW });
	}
	if (title) {
		pdf.setFont("helvetica", name ? "normal" : "bold");
		pdf.setFontSize(name ? 6.5 * s : 7.5 * s);
		pdf.setTextColor(71, 85, 105);
		pdf.text(title, cx, lineY + (name ? 6.2 : 3.2) * s, { align: "center", maxWidth: blockW });
	}
	if (signoff.stamp_image) {
		const stampSize = H * 1.05;
		// Overlaps the start of the signature line slightly, like a real stamp.
		withOpacity(pdf, 0.9, () =>
			drawFitted(pdf, signoff.stamp_image, blockX - stampSize + 4 * s, top - 0.5 * s, stampSize, stampSize),
		);
	}
}

/** A faint diagonal DRAFT mark across the page. */
export function drawDraftWatermark(pdf, pageW, pageH) {
	const k = pageW / 420;
	const angle = 28;
	const rad = (angle * Math.PI) / 180;
	const lines = [
		{ text: "DRAFT", size: 150 * k, offset: 0 },
		{ text: "NOT FOR CIRCULATION", size: 34 * k, offset: 22 * k },
	];
	withOpacity(pdf, 0.06, () => {
		pdf.setFont("helvetica", "bold");
		pdf.setTextColor(100, 116, 139);
		for (const l of lines) {
			pdf.setFontSize(l.size);
			const w = pdf.getTextWidth(l.text);
			// Centre the rotated text on the page (jsPDF rotates about the start point).
			const cx = pageW / 2 + Math.sin(rad) * l.offset;
			const cy = pageH / 2 + Math.cos(rad) * l.offset;
			pdf.text(l.text, cx - (w / 2) * Math.cos(rad), cy + (w / 2) * Math.sin(rad), { angle });
		}
	});
}

/**
 * Sign every page of a FINAL export, or watermark every page of a draft.
 * `cover` (optional) is the 1-based page number of a cover page and its scale;
 * the cover gets only the verification QR code and link, a little higher,
 * inside its frame.
 */
export function applySignoff(pdf, { signoff, isLocked, pageW, pageH, margin, stripBottom, cover = null }) {
	const pages = pdf.getNumberOfPages();
	const signed = isSigned(signoff);
	for (let p = 1; p <= pages; p++) {
		pdf.setPage(p);
		if (signed) {
			if (cover && cover.page === p) {
				const k = cover.scale ?? 1;
				drawSignoffStrip(pdf, signoff, {
					x0: margin + 12 * k,
					x1: pageW - margin - 12 * k,
					bottom: pageH - 15 * k,
					scale: k,
					verificationOnly: true,
				});
			} else {
				drawSignoffStrip(pdf, signoff, { x0: margin, x1: pageW - margin, bottom: stripBottom });
			}
		} else if (!isLocked) {
			drawDraftWatermark(pdf, pageW, pageH);
		}
	}
	pdf.setPage(pages);
}
