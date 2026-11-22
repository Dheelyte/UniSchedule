import { test } from "node:test";
import assert from "node:assert/strict";
import {
	VIEWER_ROLES,
	CHANGE_REQUEST_ROLES,
	IMPERSONABLE_ROLES,
	FACULTY_SCOPED_ROLES,
	CROSS_REALM_ROLES,
	ROLE_LABELS,
	isViewerRole,
	canRequestChange,
	isFacultyScopedRole,
	isCrossRealmRole,
	hasGlobalScope,
} from "./roles.js";

test("HOD is named Faculty Viewer (HOD)", () => {
	assert.equal(ROLE_LABELS.HOD, "Faculty Viewer (HOD)");
});

test("HOD is in every role list a Faculty Viewer is in, and no other", () => {
	const lists = { VIEWER_ROLES, CHANGE_REQUEST_ROLES, IMPERSONABLE_ROLES, FACULTY_SCOPED_ROLES, CROSS_REALM_ROLES };
	for (const [name, roles] of Object.entries(lists)) {
		assert.equal(roles.includes("HOD"), roles.includes("FACULTY_VIEWER"), name);
	}
	for (const check of [isViewerRole, canRequestChange, isFacultyScopedRole, isCrossRealmRole, hasGlobalScope]) {
		assert.equal(check("HOD"), check("FACULTY_VIEWER"), check.name);
	}
});
