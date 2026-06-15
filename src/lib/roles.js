export const VIEWER_ROLES = ['FACULTY_VIEWER', 'SUPER_VIEWER'];

export const isViewerRole = (role) => VIEWER_ROLES.includes(role);

export const hasGlobalScope = (role) => role === 'SUPER_ADMIN' || role === 'SUPER_VIEWER' || role === 'GS_ADMIN';

export const isGsAdmin = (role) => role === 'GS_ADMIN';

// Roles that may submit (but not directly apply) course-schedule change requests
// while a timetable is unlocked.
export const CHANGE_REQUEST_ROLES = ['FACULTY_EDITOR', 'FACULTY_VIEWER', 'GS_ADMIN', 'SUPER_VIEWER'];

export const canRequestChange = (role) => CHANGE_REQUEST_ROLES.includes(role);
