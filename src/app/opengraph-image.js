pimport { ImageResponse } from 'next/og';
import { unilagLogoBase64 } from '@/lib/logo';

// The preview shown when a link to the site is shared (WhatsApp, X, LinkedIn, Slack…).
// Kept deliberately plain: logo, name and one line, readable even as a thumbnail.
export const alt = 'UniSchedule: University of Lagos Timetable';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
	return new ImageResponse(
		(
			<div
				style={{
					width: '100%',
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: 36,
					background: '#ffffff',
					color: '#0f172a',
				}}
			>
				<img src={unilagLogoBase64} width={180} height={180} alt="" />
				<span style={{ fontSize: 104, fontWeight: 800, letterSpacing: -3 }}>UniSchedule</span>
				<span style={{ fontSize: 48, fontWeight: 600, color: '#334155' }}>University of Lagos Timetable</span>
			</div>
		),
		{ ...size },
	);
}
