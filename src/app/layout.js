import './globals.css';
import ClientLayout from '@/components/ClientLayout/ClientLayout';
import { SESSION_HINT_KEY, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '@/lib/site';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    // The university
    'UNILAG',
    'University of Lagos',
    'UNILAG Akoka',
    // Timetables in general
    'UNILAG timetable',
    'University of Lagos timetable',
    'UNILAG timetable PDF',
    'download UNILAG timetable',
    'UNILAG class timetable',
    'UNILAG lecture timetable',
    'University of Lagos lecture timetable',
    'UNILAG lecture schedule',
    // Semesters
    'UNILAG first semester timetable',
    'UNILAG second semester timetable',
    // Exams
    'UNILAG exam timetable',
    'UNILAG examination timetable',
    'University of Lagos exam timetable',
    'UNILAG exam schedule',
    'UNILAG CBT timetable',
    // Programmes, faculties and levels
    'ICE UNILAG timetable',
    'UNILAG part-time timetable',
    'UNILAG faculty timetable',
    'UNILAG department timetable',
    'UNILAG 100 level timetable',
    // The product
    'clash-free timetable',
    'timetable management',
    'UniSchedule',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: 'en_NG',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

// The homepage is served as the public landing page so search engines and
// first-time visitors see it straight away. For someone who was signed in
// last time, this marks <html> before React loads so the landing page stays
// hidden (behind a spinner) until the sign-in check finishes, instead of
// flashing up before their dashboard. Cleared if they turn out to be signed out.
const sessionHintScript = `try{if(localStorage.getItem(${JSON.stringify(SESSION_HINT_KEY)}))document.documentElement.setAttribute('data-session','')}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    // The hint script above edits <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: sessionHintScript }} />
      </head>
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
