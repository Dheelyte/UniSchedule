import HelpShell from './HelpShell';

// Staff only: the content comes from the backend, filtered for the signed-in
// role, so there's nothing here for search engines.
export const metadata = {
	title: { default: 'Help centre', template: '%s · Help centre' },
	description: 'How to use UniSchedule: every page and feature you can use, explained.',
	robots: { index: false, follow: false },
};

export default function HelpLayout({ children }) {
	return <HelpShell>{children}</HelpShell>;
}
