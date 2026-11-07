import { ImageResponse } from 'next/og';
import { unilagLogoBase64 } from '@/lib/logo';

// The preview shown when a link to the site is shared (WhatsApp, X, LinkedIn, Slack…).
export const alt = 'UniSchedule: conflict-free lecture and exam timetables for the University of Lagos';
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
					justifyContent: 'space-between',
					padding: '72px 80px',
					background: 'linear-gradient(135deg, #0b1020 0%, #1e1b4b 55%, #0e7490 100%)',
					color: '#ffffff',
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: 84,
							height: 84,
							borderRadius: 20,
							background: '#ffffff',
						}}
					>
						<img src={unilagLogoBase64} width={60} height={60} alt="" />
					</div>
					<div style={{ display: 'flex', flexDirection: 'column' }}>
						<span style={{ fontSize: 40, fontWeight: 700 }}>UniSchedule</span>
						<span style={{ fontSize: 24, color: '#c7d2fe' }}>University of Lagos · Timetable Manager</span>
					</div>
				</div>

				<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
					<span style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
						Conflict-free timetables for the whole university
					</span>
					<span style={{ fontSize: 30, color: '#cbd5e1' }}>
						Lecture, exam and CBT timetables for every faculty, with clashes caught before they are published.
					</span>
				</div>

				<span style={{ fontSize: 26, color: '#67e8f9' }}>www.unilagtimetable.com</span>
			</div>
		),
		{ ...size },
	);
}
