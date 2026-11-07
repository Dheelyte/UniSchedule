// Login pages differ only by ?realm=, so they are left out of search results;
// /realms is the page that lists every programme's sign-in.
export const metadata = {
	title: 'Sign in',
	robots: { index: false, follow: true },
};

export default function LoginLayout({ children }) {
	return children;
}
