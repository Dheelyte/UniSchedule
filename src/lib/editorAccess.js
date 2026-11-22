// A Faculty Editor handing their editor access to a Faculty Viewer of their
// faculty, and taking it back. The rules live in the backend
// (backend/modules/editor_access); these helpers decide what to show.

// The answer GET /editor-access gives someone with nothing to do here.
export const NO_EDITOR_ACCESS = { can_grant: false, granted: null, received: null, candidates: [] };

// Roles that can take part in a handover, so are worth asking about it.
export const hasEditorAccessControls = (user) =>
	!!user && !user.impersonating && (user.role === 'FACULTY_EDITOR' || user.role === 'FACULTY_VIEWER');

// Only a plain Faculty Viewer may be given editor access (or have it redirected
// to them). A Head of Department (HOD) views like a Faculty Viewer but never
// receives it; the backend refuses them too.
export const canReceiveEditorAccess = (role) => role === 'FACULTY_VIEWER';

// Super admins and Faculty Editors manage staff. An editor who handed their
// access over is a Faculty Viewer meanwhile, but still opens the page to
// retract or redirect it (and sees nothing else there).
export const canOpenStaffPage = (role, editorAccess) =>
	role === 'SUPER_ADMIN' || role === 'FACULTY_EDITOR' || (role === 'FACULTY_VIEWER' && !!editorAccess?.granted);

// The warning shown before an editor gives their access away.
export const grantConfirmation = (email, facultyName) => ({
	title: `Grant Faculty Editor access to ${email}?`,
	message: 'Are you sure you want to grant this person the access of faculty editor?',
	details: [
		`${email} will become a Faculty Editor${facultyName ? ` for ${facultyName}` : ''} and can do everything a Faculty Editor can.`,
		'This takes away your own editing rights: you become a Faculty Viewer until you retract it.',
		'You can retract it at any time from the Staff page or your profile menu, either back to yourself or to another Faculty Viewer.',
	],
	confirmLabel: 'Yes, grant access',
	cancelLabel: 'Cancel',
	tone: 'danger',
});

// Taking the access back: to yourself (toEmail null) or to another viewer.
export const retractConfirmation = (holderEmail, toEmail = null) =>
	toEmail
		? {
				title: `Give your editor access to ${toEmail}?`,
				message: `${holderEmail} goes back to Faculty Viewer and ${toEmail} becomes Faculty Editor. You stay a Faculty Viewer and can still retract it later.`,
				confirmLabel: `Give it to ${toEmail}`,
				tone: 'primary',
			}
		: {
				title: 'Take back your editor access?',
				message: `${holderEmail} goes back to Faculty Viewer and you become Faculty Editor again.`,
				confirmLabel: 'Take it back',
				tone: 'primary',
			};

// A super admin undoing someone's handover.
export const reverseConfirmation = (handover) => ({
	title: 'Reverse this handover?',
	message: `${handover.granted_by.email} becomes Faculty Editor of ${handover.faculty_name} again and ${handover.holder.email} goes back to Faculty Viewer. Both are told by email.`,
	confirmLabel: 'Reverse handover',
	tone: 'danger',
});
