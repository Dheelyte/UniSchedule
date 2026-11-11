import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndexPDF, facultyLabel, orderFaculties } from "./pdfIndex.js";

test("facultyLabel: names General Studies by its course prefix", () => {
	assert.equal(facultyLabel("Faculty of Arts"), "Faculty of Arts");
	assert.equal(facultyLabel("General Studies"), "General Studies (GST)");
});

test("orderFaculties: by subject, special units (DLI, GST) last", () => {
	const faculties = [
		{ name: "General Studies", is_special: true },
		{ name: "Faculty of Law" },
		{ name: "Distance Learning Institute", is_special: true },
		{ name: "Communications & Media Studies" },
		{ name: "Faculty of Arts" },
	];
	assert.deepEqual(
		orderFaculties(faculties.map((f, id) => ({ id, ...f }))).map((f) => f.label),
		["Faculty of Arts", "Communications & Media Studies", "Faculty of Law", "Distance Learning Institute", "General Studies (GST)"],
	);
});

test("buildIndexPDF: links each published faculty, lists the rest as not published", () => {
	const pdf = buildIndexPDF({
		title: "2026/2027 First Semester Lecture Timetable",
		siteUrl: "https://www.unilagtimetable.com",
		compress: false,
		sections: [
			{
				heading: "Undergraduate Programme",
				allUrl: "https://www.unilagtimetable.com/api/export?realm=UG&semester=3&type=lecture",
				code: "UG-7K3P-92QD",
				verifyUrl: "https://www.unilagtimetable.com/verify/UG-7K3P-92QD",
				rows: [
					{ label: "Arts", url: "https://www.unilagtimetable.com/api/export?realm=UG&semester=3&type=lecture&faculty=ARTS" },
					{ label: "Dental Sciences", url: null },
				],
			},
			{ heading: "ICE Programme", rows: [] },
		],
	});
	const raw = pdf.output();
	assert.match(raw, /faculty=ARTS/, "Arts links to its own timetable");
	assert.match(raw, /\/verify\/UG-7K3P-92QD/);
	assert.match(raw, /Not published/);
	assert.match(raw, /B\. ICE Programme/);
	assert.match(raw, /View timetable/);
	assert.match(raw, /Not published yet\./, "a programme with nothing published says so");
	assert.equal(pdf.fileName, "2026_2027_first_semester_lecture_timetable_index.pdf");
	// Staff only: marked on every page as not for circulation.
	assert.match(raw, /STAFF COPY/);
	assert.match(raw, /DO NOT SHARE/);
	assert.match(raw, /Do not share, forward or post this index\./);
});
