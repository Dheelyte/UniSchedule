export const VIEWER_ROLES = ['FACULTY_VIEWER', 'SUPER_VIEWER'];

export const isViewerRole = (role) => VIEWER_ROLES.includes(role);

export const hasGlobalScope = (role) => role === 'SUPER_ADMIN' || role === 'SUPER_VIEWER' || role === 'GS_ADMIN' || role === 'CITS_ADMIN';

export const isGsAdmin = (role) => role === 'GS_ADMIN';

export const isSuperAdmin = (role) => role === 'SUPER_ADMIN';

// Roles that aren't tied to one realm (programme): they pick a realm at login
// and can switch. Mirrors CROSS_REALM_ROLES in backend/modules/auth/models.py.
// Unrelated to hasGlobalScope, which is about faculties.
export const CROSS_REALM_ROLES = ['SUPER_ADMIN', 'SUPER_VIEWER', 'CITS_ADMIN'];

export const isCrossRealmRole = (role) => CROSS_REALM_ROLES.includes(role);

// Roles that may submit (but not directly apply) course-schedule change requests
// while a timetable is unlocked.
export const CHANGE_REQUEST_ROLES = ['FACULTY_EDITOR', 'FACULTY_VIEWER', 'GS_ADMIN', 'SUPER_VIEWER'];

export const canRequestChange = (role) => CHANGE_REQUEST_ROLES.includes(role);

// Human-readable labels for roles.
export const ROLE_LABELS = {
	SUPER_ADMIN: 'Super Admin',
	SUPER_VIEWER: 'Super Viewer',
	FACULTY_EDITOR: 'Faculty Editor',
	FACULTY_VIEWER: 'Faculty Viewer',
	GS_ADMIN: 'GS Admin',
	CITS_ADMIN: 'Super Administrator (CITS)',
};

// Roles a super admin may assume (everything except SUPER_ADMIN itself).
export const IMPERSONABLE_ROLES = ['FACULTY_EDITOR', 'FACULTY_VIEWER', 'GS_ADMIN', 'SUPER_VIEWER', 'CITS_ADMIN'];

// Assumed roles that must be scoped to a specific faculty.
export const FACULTY_SCOPED_ROLES = ['FACULTY_EDITOR', 'FACULTY_VIEWER'];

export const isFacultyScopedRole = (role) => FACULTY_SCOPED_ROLES.includes(role);
