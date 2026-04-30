export const VIEWER_ROLES = ['FACULTY_VIEWER', 'SUPER_VIEWER'];

export const isViewerRole = (role) => VIEWER_ROLES.includes(role);

export const hasGlobalScope = (role) => role === 'SUPER_ADMIN' || role === 'SUPER_VIEWER' || role === 'GS_ADMIN';

export const isGsAdmin = (role) => role === 'GS_ADMIN';
