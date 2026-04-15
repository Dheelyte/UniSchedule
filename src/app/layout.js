import './globals.css';
import ClientLayout from '@/components/ClientLayout/ClientLayout';

export const metadata = {
  title: 'University of Lagos Timetable Manager',
  description: 'A robust timetable management system for university administrators to manage and generate lecture and examination schedules.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
