// The page previews: what each page's step-by-step tour says.
//
// Each step points at a feature by its data-tour name (the attribute on the
// element). A step whose feature isn't on screen is skipped, so a role that
// doesn't have a button never hears about it. `roles` limits a step to the
// roles listed, for features that are on screen for everyone but work
// differently. A step with no target is a centred card.
//
// Only the app's own pages have a tour; the public pages (home, sign-in,
// download, verify, FAQ, contributors) don't. TourController (components/Tour)
// decides when a tour plays.

const SUPER = ['SUPER_ADMIN'];

/** Give steps a guide page (docs/guide/<page>.md), unless they name their own. */
function withGuide(guide, steps) {
	return steps.map((s) => ({ guide, ...s }));
}

/** The timetable grid, shared by the lecture, exam and CBT timetables. */
function gridSteps(mode) {
	const exam = mode !== 'lecture';
	const thing = exam ? 'exam' : 'lecture';
	return withGuide('timetable-grid', [
		{
			target: 'grid-readonly',
			title: 'Read-only view',
			body: 'This note explains why you can look but not change anything here. For example, the timetable is locked as FINAL, or you are viewing a past semester.',
		},
		{
			target: 'grid-faculty',
			title: 'Filter by faculty',
			body: `Show only one faculty's ${thing}s. Choose "All Faculties" to see everything in the portal.`,
		},
		{
			target: 'grid-department',
			title: 'Filter by department',
			body: 'Narrow further to one department. The list only shows departments in the faculty you picked.',
		},
		{
			target: 'grid-hide-empty',
			title: 'Hide empty rooms',
			body: `Tick this to hide rooms with nothing booked on the ${exam ? 'date' : 'day'} you are viewing, so the grid is shorter and easier to scan.`,
		},
		{
			target: 'grid-days',
			title: exam ? 'Exam dates' : 'Days of the week',
			body: exam
				? 'Each button is a date with exams on it, and the number shows how many. Click a date to see its exams.'
				: 'Switch between the teaching days. The number on each day is how many lectures are on it. The days come from this portal\'s calendar.',
		},
		{
			target: 'grid-add-date',
			title: 'Add an exam date',
			body: 'Pick a date and click "+ Add Date" to start scheduling exams on it. Only the days this portal allows for exams can be added.',
		},
		{
			target: 'grid-count',
			title: 'What you are looking at',
			body: `How many ${thing}s are on the ${exam ? 'date' : 'day'} you are viewing, with the filters above applied.`,
		},
		{
			target: 'grid-conflicts',
			title: 'Conflicts',
			body: 'The number of clashes on this view: two bookings in one room at once, a class clashing for the same students, or a booking on a blocked slot. Clashing items are shown in red.',
		},
		{
			target: 'grid-jump-conflict',
			title: 'Go to a conflict',
			body: 'Jumps straight to the first clash, even on another day, so you can fix it.',
		},
		{
			target: 'grid-manage-conflicts',
			title: 'Manage conflicts',
			body: 'Some clashes are intended, for example two groups sharing a hall on purpose. Dismiss those here so they stop being flagged, and restore them if needed.',
		},
		{
			target: 'grid',
			title: 'The timetable',
			body: `Each row is a room and each column is half an hour of the day. Every coloured block is a ${thing}: hover over it for details, or click it to edit.`,
		},
		{
			target: 'grid-rooms',
			title: 'Rooms',
			body: 'Rooms are listed down the left, in the order set on the Rooms page. Online classes have their own row.',
		},
		{
			target: 'grid-add',
			title: exam ? 'Schedule an exam' : 'Schedule a lecture',
			body: `Click an empty slot to schedule a ${thing} there. Choose the course and time, and add extra rooms if it needs more than one.`,
		},
		{
			target: 'grid-event',
			title: `A scheduled ${thing}`,
			body: `Click to edit or remove it. Drag it to another room or time to move it. You can only move ${thing}s that belong to your faculty.`,
		},
		{
			target: 'grid-event-conflict',
			title: 'A clash',
			body: 'Red means this item clashes with something. Hover over it to read exactly what it clashes with. University-wide courses take priority over interfaculty ones, which take priority over departmental ones.',
		},
		{
			target: 'grid-blocked',
			title: 'Blocked time',
			body: 'Striped red areas are blocked, for example for a holiday or a university event. Nothing can be scheduled there. Super admins manage these under Academic Sessions.',
		},
		{
			target: 'grid-external',
			title: 'Booked by another programme',
			body: 'This hall is shared with another programme, which has it booked at this time. You can see the booking but cannot change it, and you cannot book over it.',
		},
	]);
}

function timetableSteps(mode) {
	const label = mode === 'lecture' ? 'lecture' : mode === 'cbt' ? 'CBT exam' : 'exam';
	// The shared controls are written up once, on the lecture timetable's page.
	return [...withGuide('timetable-lectures', [
		{
			title: mode === 'cbt' ? 'CBT exam timetable' : `The ${label} timetable`,
			body:
				mode === 'cbt'
					? 'This page holds only the exams taken on computers (CBT). It works like the exam timetable, but lists just the courses marked as CBT.'
					: `Here you build and view the ${label} timetable for a semester: which course is in which room, and when.`,
		},
		{
			target: 'tt-status',
			title: 'Draft or FINAL',
			body: 'Shows whether this timetable is still a draft or locked as FINAL. FINAL timetables are signed, stamped and carry a QR code that anyone can scan to check them.',
		},
		{
			target: 'tt-lock',
			title: 'Lock or unlock',
			body: 'Locking marks the timetable FINAL: nobody can edit it, and its PDFs are signed and get a verification code. Unlock it to make changes. Older printouts will then show as possibly out of date.',
		},
		{
			target: 'tt-request-edit',
			title: 'Ask to edit',
			body: 'The timetable is locked. Use this to ask a super admin to unlock it, with a reason. They are notified straight away.',
		},
		{
			target: 'tt-semester',
			title: 'Choose a semester',
			body: 'Switch to another semester to view its timetable. Only the current semester can be edited; past ones are read-only.',
		},
		{
			target: 'tt-import',
			title: 'Import a timetable (Beta)',
			body: 'Upload a faculty\'s timetable as an Excel, Word or PDF file. Course codes and venues are matched for you, and you confirm anything unclear before it is saved.',
		},
		{
			target: 'tt-copy',
			title: 'Copy a semester (Beta)',
			body: 'Start this semester from an earlier one: the same courses, days, times and rooms, checked against this semester before anything is saved.',
		},
		{
			guide: 'timetable-exams',
			target: 'tt-shift',
			title: 'Shift exams (Beta)',
			body: 'Move the whole exam timetable to new dates in one go, for example if the exams start a week later. Times and rooms stay the same.',
		},
		{
			guide: 'timetable-cbt',
			target: 'cbt-manage',
			title: 'Manage CBT courses',
			body: 'Choose which courses are taken as computer-based exams. Only those courses appear on this timetable.',
		},
		{
			target: 'tt-request-change',
			title: 'Request a change',
			body: 'Ask for a change to a course\'s slot, for example a different time or room. A super admin reviews it; approving applies the change for you.',
		},
		{
			target: 'tt-export',
			title: 'Export',
			body: 'Download the timetable as a PDF or CSV for all faculties, one faculty, a department or a level, in the standard or day-by-day layout.',
		},
	]), ...gridSteps(mode)];
}

const SHELL_STEPS = withGuide('dashboard', [
	{
		target: 'sidebar',
		title: 'Navigation',
		body: 'Every section of UniSchedule is here. You only see the sections your role can use.',
	},
	{ target: 'nav-faculties', title: 'Faculties & Departments', body: 'The faculties and departments in this programme.' },
	{ target: 'nav-courses', title: 'Courses', body: 'Every course, with its level, semester, lecturers and which departments take it.' },
	{ target: 'nav-rooms', title: 'Rooms', body: 'Lecture rooms and halls, with their capacity and how often they are booked.' },
	{ target: 'nav-timetable-lectures', title: 'Lecture timetable', body: 'Build and view the weekly lecture timetable.' },
	{ target: 'nav-timetable-exams', title: 'Exam timetable', body: 'Build and view the exam timetable, date by date.' },
	{ target: 'nav-timetable-cbt', title: 'CBT timetable', body: 'The computer-based exams only.' },
	{ target: 'nav-terms', title: 'Academic Sessions', body: 'Set the current session and semester, and block out dates and times such as holidays.' },
	{ target: 'nav-staff', title: 'Staff', body: 'Invite people, set their roles and manage who can edit.' },
	{ target: 'nav-requests', title: 'Change Requests', body: 'Review requests to change a course\'s slot, and approve or reject them.' },
	{ target: 'nav-activity', title: 'Activity Logs', body: 'A record of every important action, who did it and when, with an exportable analysis.' },
	{ target: 'nav-signoffs', title: 'Signatures & Stamps', body: 'The signature and stamp printed on FINAL timetables.' },
	{
		target: 'sidebar-toggle',
		title: 'Show or hide the menu',
		body: 'Collapse the menu to give the timetable more room. On a phone, this opens the menu.',
	},
	{
		target: 'realm-switcher',
		title: 'Switch programme',
		body: 'You work across programmes (for example Undergraduate and ICE). Switch here; each programme has its own calendar, courses, rooms and timetables.',
	},
	{
		target: 'role-switcher',
		title: 'View as another role',
		body: 'See UniSchedule exactly as another role does, to check what they can and cannot do. A banner shows while you are viewing as someone else; switch back here.',
	},
	{
		target: 'notifications',
		title: 'Notifications',
		body: 'Approvals, requests, priority clashes and other updates that need your attention. The badge shows how many are unread.',
	},
	{ target: 'profile-menu', title: 'Your account', body: 'Your email, role and programme, and account options.' },
	{ target: 'logout', title: 'Sign out', body: 'Sign out of UniSchedule on this device.' },
	{ target: 'nav-help', title: 'Help centre', body: 'The full guide to every page, with a search box and answers to common questions.' },
	{
		guide: 'page-previews',
		target: 'tour-help',
		title: 'Page previews',
		body: 'Each page of the app shows a preview like this the first time you open it. Click here to see a page\'s preview again, open its guide, or turn previews off.',
	},
]);

export const TOURS = {
	dashboard: {
		title: 'Dashboard',
		steps: [
			{
				title: 'Welcome to UniSchedule',
				body: 'This short preview shows you around. Use Next and Back, or the arrow keys. Press Skip or Esc at any time.',
			},
			{ target: 'dash-term', title: 'Current semester', body: 'The academic session and semester everything is working on right now.' },
			{
				target: 'dash-progress',
				title: 'Scheduling progress',
				body: 'How many courses already have a slot in the timetable, and how many are still waiting.',
			},
			{
				target: 'dash-capacity',
				title: 'Room capacity',
				body: 'How full the rooms are: total seats, and how many are in use.',
			},
			{ target: 'dash-capacity-faculty', title: 'Pick a faculty', body: 'Show room capacity for one faculty, or for all of them.' },
			{
				target: 'dash-overview',
				title: 'Overview',
				body: 'Progress for each faculty. Switch between lectures and exams with the buttons at the top.',
			},
			{ target: 'dash-rooms', title: 'Rooms by faculty', body: 'How many rooms each faculty has.' },
			...SHELL_STEPS,
		],
	},

	faculties: {
		title: 'Faculties & Departments',
		steps: [
			{ title: 'Faculties & Departments', body: 'The faculties in this programme and the departments under each. Courses, rooms and staff all belong to them.' },
			{ target: 'fac-add-faculty', title: 'Add a faculty', body: 'Create a new faculty. Its ID is fixed once created.' },
			{ target: 'fac-add-dept', title: 'Add a department', body: 'Create a department and choose the faculty it belongs to.' },
			{ target: 'fac-stats', title: 'At a glance', body: 'How many faculties, special groupings and departments there are.' },
			{ target: 'fac-table', title: 'The list', body: 'Click a faculty to open it and see its departments.' },
			{ target: 'fac-expand', title: 'Open a faculty', body: 'Shows or hides the departments in this faculty.' },
			{
				target: 'fac-special',
				title: 'Special grouping',
				body: 'Special groupings (such as general studies) are left out of conflict checks, so their shared classes do not flag clashes.',
			},
			{ target: 'fac-row-actions', title: 'Edit or delete', body: 'Rename a faculty or department, or delete it.' },
		],
	},

	courses: {
		title: 'Courses',
		steps: [
			{ title: 'Courses', body: 'Every course in this programme: its code, title, semester, credit load, lecturers and the departments that take it.' },
			{ target: 'courses-add', title: 'Add a course', body: 'Create a course and choose which departments and levels take it.' },
			{ target: 'courses-faculty', title: 'Filter by faculty', body: 'Show only one faculty\'s courses.' },
			{ target: 'courses-department', title: 'Filter by department', body: 'Show only the courses one department takes.' },
			{ target: 'courses-search', title: 'Search', body: 'Find a course by its code, title or lecturer.' },
			{
				target: 'courses-type',
				title: 'Course type',
				body: 'Departmental courses belong to one department. Interfaculty courses are shared across faculties. University-wide courses (such as GST) are taken by everyone and come first when there is a clash.',
			},
			{ target: 'courses-count', title: 'Results', body: 'How many courses match your filters, out of all of them.' },
			{ target: 'courses-table', title: 'The list', body: 'Your own faculty\'s courses are listed first. Scroll to see more; long lists load as you go.' },
			{ target: 'courses-row-actions', title: 'Edit or delete', body: 'Change a course\'s details or remove it. You can only edit your own faculty\'s courses.' },
			{
				target: 'courses-take',
				title: 'Take a shared course',
				body: 'Add your departments to another faculty\'s interfaculty or university-wide course, so it is checked against your students\' timetable too.',
			},
		],
	},

	rooms: {
		title: 'Rooms',
		steps: [
			{ title: 'Rooms', body: 'The rooms and halls classes and exams are held in, grouped by faculty.' },
			{
				target: 'rooms-add-from',
				title: 'Add from Undergraduate',
				body: 'Use a hall from the Undergraduate list. It becomes a room here, linked to the original, so the two programmes can never book it at the same time.',
			},
			{ target: 'rooms-add', title: 'Add a room', body: 'Create a room with its name, faculty and number of seats.' },
			{ target: 'rooms-stats', title: 'At a glance', body: 'How many rooms there are, total and average seats, and how many large venues (300 seats or more).' },
			{ target: 'rooms-search', title: 'Search', body: 'Find a room by name.' },
			{
				target: 'rooms-sort',
				title: 'Order',
				body: '"Custom Order" is the order rooms appear in on the timetable. You can also sort by name or by size.',
			},
			{ target: 'rooms-faculty', title: 'Filter by faculty', body: 'Show only one faculty\'s rooms.' },
			{ target: 'rooms-list', title: 'Rooms by faculty', body: 'Each faculty\'s rooms, with their seats, size, status and how many slots are booked in them.' },
			{ target: 'rooms-faculty-group', title: 'Open or close a faculty', body: 'Click a faculty to show or hide its rooms. The summary shows its seats in use and out of use.' },
			{
				target: 'rooms-hall',
				title: 'Shared hall',
				body: 'This room is the same physical hall as a room in another programme. A booking in one blocks the other at the same time.',
			},
			{ target: 'rooms-reorder', title: 'Move up or down', body: 'Change where this room appears on the timetable grid.' },
			{
				target: 'rooms-row-actions',
				title: 'Edit or delete',
				body: 'Edit a room\'s details, or mark it inactive so nothing new can be booked in it. A room with bookings cannot be deleted.',
			},
		],
	},

	'timetable-lectures': { title: 'Lecture timetable', steps: timetableSteps('lecture') },
	'timetable-exams': { title: 'Exam timetable', steps: timetableSteps('exam') },
	'timetable-cbt': { title: 'CBT timetable', steps: timetableSteps('cbt') },

	'timetable-import': {
		title: 'Import a timetable',
		steps: [
			{
				title: 'Import a timetable (Beta)',
				body: 'Bring in a timetable from a file, or copy one from an earlier semester. Nothing is saved until you have checked it.',
			},
			{ target: 'imp-source', title: 'From a file or a semester', body: 'Choose where the timetable comes from.' },
			{ target: 'imp-back', title: 'Back', body: 'Return to the timetable without importing.' },
			{ target: 'imp-type', title: 'Lectures or exams', body: 'Which timetable you are importing into.' },
			{ target: 'imp-faculty', title: 'Faculty', body: 'The faculty the timetable belongs to. When copying, you can choose all faculties.' },
			{
				target: 'imp-file',
				title: 'The file',
				body: 'An Excel, Word or PDF timetable. PDFs need selectable text, not a scanned image.',
			},
			{ target: 'imp-copy-from', title: 'Copy from', body: 'The earlier semester to copy. The number shows how many items it has.' },
			{
				target: 'imp-place-all',
				title: 'Place in every faculty',
				body: 'For general studies: put each session in every faculty\'s timetable (or, for exams, in the faculties its row names).',
			},
			{
				target: 'imp-mode',
				title: 'Replace or add',
				body: '"Replace it" removes the faculty\'s current timetable first. "Add to it" keeps what is there and adds the new items.',
			},
			{
				target: 'imp-read',
				title: 'Read the file',
				body: 'Reads the file and shows a preview. Anything that did not match (a course code, venue or faculty) is asked about before you import.',
			},
			{
				target: 'imp-history',
				title: 'Past imports',
				body: 'Earlier imports. Revert one to undo it, or approve it once it is correct. An approved import can no longer be reverted.',
			},
		],
	},

	terms: {
		title: 'Academic Sessions',
		steps: [
			{
				title: 'Academic Sessions',
				body: 'Sessions and semesters, and which one is current. Only the current semester\'s timetables can be edited.',
			},
			{ target: 'terms-add-session', title: 'Add a session', body: 'Choose a session (for example 2026/2027) and add it.' },
			{ target: 'terms-session', title: 'A session', body: 'Click a session to see its semesters.' },
			{
				target: 'terms-set-session',
				title: 'Make it current',
				body: 'Sets this session as the current one. Everyone then works in it.',
			},
			{ target: 'terms-set-semester', title: 'Make a semester current', body: 'Switches everyone to this semester.' },
			{ target: 'terms-add-semester', title: 'Add a semester', body: 'Add a semester to the current session.' },
			{
				target: 'terms-add-blocked',
				title: 'Block out time',
				body: 'Stop anything being scheduled at a time, for example a public holiday, a university event or a weekly free period. A whole-day block on an exam date works as a holiday.',
			},
			{ target: 'terms-blocked', title: 'Blocked slots', body: 'The current semester\'s blocked times. Edit or delete them here.' },
		],
	},

	staff: {
		title: 'Staff',
		steps: [
			{ title: 'Staff', body: 'Who has access to UniSchedule in this programme, and what they can do.' },
			{
				target: 'staff-invite',
				title: 'Invite someone',
				body: 'Send an invitation by email with the role they should have. They set their own password from the link.',
			},
			{
				target: 'staff-received',
				title: 'Editor access you hold',
				body: 'A Faculty Editor gave you their editor access. You can do everything they could, but only they can take it back or pass it on.',
			},
			{ target: 'staff-your-access', title: 'Your editor access', body: 'You gave your editor access to someone. Take it back, or pass it to another Faculty Viewer, here.' },
			{ target: 'staff-invitations', title: 'Pending invitations', body: 'Invitations not yet accepted. Revoke one to cancel its link.' },
			{ target: 'staff-accounts', title: 'People with access', body: 'Everyone with an account, their role, programme and faculty.' },
			{ target: 'staff-edit-role', title: 'Change a role', body: 'Give someone a different role or faculty. It applies the next time they use UniSchedule.' },
			{
				target: 'staff-grant',
				title: 'Hand over editor access',
				body: 'Give your Faculty Editor access to a Faculty Viewer in your faculty, for example while you are away. You become a viewer until you take it back.',
			},
			{ target: 'staff-remove', title: 'Remove access', body: 'Delete this person\'s account. They can no longer sign in.' },
			{
				target: 'staff-handovers',
				title: 'Editor access handovers',
				body: 'Every active handover. You can reverse any of them.',
				roles: SUPER,
			},
		],
	},

	requests: {
		title: 'Change Requests',
		steps: [
			{
				title: 'Change Requests',
				body: 'Requests to change a course\'s slot, sent from the timetable pages. Approving one applies the change straight away.',
			},
			{ target: 'req-status', title: 'Filter by status', body: 'Show pending, approved or rejected requests, or all of them.' },
			{ target: 'req-table', title: 'Requests', body: 'Who asked, for which course, and when.' },
			{
				target: 'req-view',
				title: 'Review a request',
				body: 'Open a request to see the change. Super admins can approve and apply it, or reject it with a note to the requester.',
			},
		],
	},

	activity: {
		title: 'Activity Logs',
		steps: [
			{
				title: 'Activity Logs',
				body: 'A record of every important action in this programme: who did what, and when. All times are Lagos time.',
			},
			{ target: 'act-export', title: 'Export analysis', body: 'Download a PDF report or Excel workbook analysing the activity you have filtered: summaries, charts, unusual activity, locked timetables and more.' },
			{ target: 'act-search', title: 'Search', body: 'Find entries whose description contains a word, such as a course code.' },
			{ target: 'act-timeframe', title: 'Timeframe', body: 'Today, this week, the last 7 or 30 days, this month, the current session, or your own dates.' },
			{ target: 'act-users', title: 'Users', body: 'Show only what certain people did.' },
			{
				target: 'act-more',
				title: 'More filters',
				body: 'Filter by category, action, timetable, role, faculty, department or portal. The number shows how many of these are in use.',
			},
			{ target: 'act-chips', title: 'Active filters', body: 'Each filter in use. Click the x on one to remove it, or "Clear all".' },
			{ target: 'act-table', title: 'Entries', body: 'Newest first: when, who, their role, the action and a description.' },
			{ target: 'act-details', title: 'Details', body: 'Shows everything recorded with an entry, such as the values a change replaced.' },
			{ target: 'act-more-rows', title: 'Load more', body: 'Shows the next page of older entries.' },
		],
	},

	signoffs: {
		title: 'Signatures & Stamps',
		steps: [
			{ target: 'sign-intro', title: 'Signatures & Stamps', body: 'What is printed on every page of a FINAL timetable PDF. Drafts get a DRAFT watermark instead.' },
			{ target: 'sign-card', title: 'One for each timetable', body: 'The lecture and exam timetables each have their own signatory, signature and stamp.' },
			{ target: 'sign-copy', title: 'Copy across', body: 'Copy these details to the other timetable, so both are signed the same way.' },
			{ target: 'sign-fields', title: 'Signatory', body: 'The name and title printed under the signature.' },
			{ target: 'sign-images', title: 'Signature and stamp', body: 'Upload a photo or scan of each. Sign or stamp on plain white paper for the best result.' },
			{ target: 'sign-clean', title: 'Clean up the scan', body: 'Removes the paper background so only the ink prints.' },
			{ target: 'sign-preview', title: 'Preview', body: 'How the strip will look on the PDF.' },
			{ target: 'sign-save', title: 'Save', body: 'Saves your changes. They apply to the next export; PDFs already downloaded keep what they had.' },
		],
	},

	help: {
		title: 'Help centre',
		guide: 'help-centre',
		steps: [
			{ title: 'Help centre', body: 'The guide to every page and feature of UniSchedule. Every preview card has a "Learn more" link that brings you to the right part of it.' },
			{ target: 'help-search', title: 'Search', body: 'Type a word, such as "lock", "conflict" or "export", to find the sections that mention it.' },
			{ target: 'help-nav', title: 'Every page', body: 'The guide\'s pages you have access to, in the same order as the app. Start with common questions, roles and the glossary.' },
			{ target: 'help-content', title: 'The page', body: 'Each feature has its own section. "On this page" at the top jumps straight to one.' },
		],
	},
};

const BY_PATH = {
	'/faculties': 'faculties',
	'/courses': 'courses',
	'/rooms': 'rooms',
	'/timetable/lectures': 'timetable-lectures',
	'/timetable/exams': 'timetable-exams',
	'/timetable/cbt': 'timetable-cbt',
	'/timetable/import': 'timetable-import',
	'/terms': 'terms',
	'/staff': 'staff',
	'/requests': 'requests',
	'/activity': 'activity',
	'/signoffs': 'signoffs',
};

/**
 * The tour for a page, as { key, title, guide, steps }, or null if it has none.
 * Only the app's own pages (signed in) have one; the public pages don't.
 */
export function tourFor(pathname, signedIn) {
	if (!signedIn) return null;
	const key = pathname === '/' ? 'dashboard' : pathname === '/help' || pathname.startsWith('/help/') ? 'help' : BY_PATH[pathname];
	return key ? { key, guide: key, ...TOURS[key] } : null;
}

/** The Help centre page for a tour: /help/<its guide page>. */
export function guidePageHref(tour) {
	return `/help/${tour.guide}`;
}

/**
 * Where a step's "Learn more" goes: its section of the guide (anchors are
 * named after data-tour names). A menu item (nav-<page>) goes to that page's
 * guide; a centred step to its tour's page.
 */
export function guideHref(tour, step) {
	if (step.target?.startsWith('nav-')) {
		const page = step.target.slice(4);
		return page === 'help' ? '/help' : `/help/${page}`;
	}
	const page = `/help/${step.guide || tour.guide}`;
	return step.target && step.anchor !== false ? `${page}#${step.target}` : page;
}

/** A tour's steps for this person's role. */
export function stepsFor(tour, user) {
	const role = user?.role;
	return tour.steps.filter((s) => !s.roles || (role && s.roles.includes(role)));
}

