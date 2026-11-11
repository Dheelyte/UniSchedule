import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalQuery, readExportRequest } from "./exportRequest.js";

const q = (s) => new URLSearchParams(s);

test("public downloads are always a black-and-white A3 PDF of the whole week", () => {
	const req = readExportRequest(
		q("realm=UG&semester=3&type=lecture&format=csv&paper=a4&layout=daily-hourly&gst=1"),
		{ realm: true, publicCopy: true },
	);
	assert.equal(req.options.format, "pdf");
	assert.equal(req.options.paperSize, "a3");
	assert.equal(req.options.layout, "standard");
	assert.equal(req.options.monochrome, true);
	assert.equal(req.options.gstOnly, false);
	// So an old link with file options redirects to the one canonical file.
	assert.equal(canonicalQuery(req), "realm=UG&semester=3&type=lecture");
});

test("public downloads keep their filters", () => {
	const req = readExportRequest(q("realm=UG&semester=3&type=exam&faculty=SCI&level=200&code=UG-AAAA-BBBB"), {
		realm: true,
		publicCopy: true,
	});
	assert.equal(canonicalQuery(req), "realm=UG&semester=3&type=exam&faculty=SCI&level=200&code=UG-AAAA-BBBB");
});

test("staff exports still choose their file options", () => {
	const req = readExportRequest(q("semester=3&type=lecture&format=pdf&paper=a4&layout=daily-hourly"));
	assert.equal(req.options.paperSize, "a4");
	assert.equal(req.options.layout, "daily-hourly");
	assert.equal(req.options.monochrome, false);
	const csv = readExportRequest(q("semester=3&type=lecture&format=csv"));
	assert.equal(csv.options.format, "csv");
});
