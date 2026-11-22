import { test } from "node:test";
import assert from "node:assert/strict";
import {
	NO_EDITOR_ACCESS,
	canOpenStaffPage,
	grantConfirmation,
	hasEditorAccessControls,
	retractConfirmation,
	reverseConfirmation,
} from "./editorAccess.js";

const handedOver = {
	...NO_EDITOR_ACCESS,
	granted: { id: 1, faculty_name: "Faculty of Engineering", granted_by: { email: "a@x" }, holder: { email: "b@x" } },
};

test("faculty editors and viewers are asked about editor access, others are not", () => {
	assert.equal(hasEditorAccessControls({ role: "FACULTY_EDITOR" }), true);
	assert.equal(hasEditorAccessControls({ role: "FACULTY_VIEWER" }), true);
	assert.equal(hasEditorAccessControls({ role: "DEO" }), false);
	assert.equal(hasEditorAccessControls({ role: "SUPER_ADMIN" }), false);
	assert.equal(hasEditorAccessControls(null), false);
	// A super admin acting as an editor has no handover of their own.
	assert.equal(hasEditorAccessControls({ role: "FACULTY_EDITOR", impersonating: true }), false);
});

test("the staff page stays open to an editor who handed their access over", () => {
	assert.equal(canOpenStaffPage("SUPER_ADMIN", NO_EDITOR_ACCESS), true);
	assert.equal(canOpenStaffPage("FACULTY_EDITOR", NO_EDITOR_ACCESS), true);
	assert.equal(canOpenStaffPage("FACULTY_VIEWER", handedOver), true);
	assert.equal(canOpenStaffPage("FACULTY_VIEWER", NO_EDITOR_ACCESS), false);
	assert.equal(canOpenStaffPage("FACULTY_VIEWER", null), false);
	assert.equal(canOpenStaffPage("DEO", handedOver), false);
});

test("the grant warning asks the agreed question, names the person and says you lose your rights", () => {
	const dialog = grantConfirmation("b@unilag.edu.ng", "Faculty of Engineering");
	assert.equal(dialog.message, "Are you sure you want to grant this person the access of faculty editor?");
	assert.match(dialog.title, /b@unilag\.edu\.ng/);
	assert.match(dialog.details[0], /b@unilag\.edu\.ng will become a Faculty Editor for Faculty of Engineering/);
	assert.match(dialog.details.join(" "), /takes away your own editing rights.*until you retract it/);
	assert.equal(dialog.tone, "danger");
});

test("retracting names the people involved", () => {
	assert.match(retractConfirmation("b@x").message, /b@x goes back to Faculty Viewer and you become Faculty Editor again/);
	const redirect = retractConfirmation("b@x", "c@x");
	assert.match(redirect.title, /c@x/);
	assert.match(redirect.message, /b@x goes back to Faculty Viewer and c@x becomes Faculty Editor/);
});

test("reversing names the faculty and both people", () => {
	assert.match(
		reverseConfirmation(handedOver.granted).message,
		/a@x becomes Faculty Editor of Faculty of Engineering again and b@x goes back to Faculty Viewer/,
	);
});
