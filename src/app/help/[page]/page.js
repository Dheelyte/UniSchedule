import GuidePage from '../GuidePage';

// Each page is loaded from the backend for the signed-in role (a page the role
// can't see is "not found" there), so nothing is built ahead of time.
export default async function Page({ params }) {
	const { page } = await params;
	return <GuidePage slug={page} />;
}
