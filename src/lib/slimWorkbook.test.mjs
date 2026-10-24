import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { slimSheetXml, slimWorkbook } from "./slimWorkbook.js";

const SHEET = `<sheetData><row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c r="B1" s="4"/><c r="C1" s="4"></c></row><row r="2" s="4" customFormat="1"><c r="A2" s="4"/></row><row r="3"/></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>`;

test("empty cells and the rows they leave are dropped", () => {
	assert.equal(
		slimSheetXml(SHEET),
		`<sheetData><row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>`,
	);
});

test("only worksheets change", () => {
	const book = zipSync({
		"xl/worksheets/sheet1.xml": strToU8(SHEET),
		"xl/styles.xml": strToU8(`<c r="A1" s="4"/>`),
	});
	const files = unzipSync(slimWorkbook(book));
	assert.equal(strFromU8(files["xl/styles.xml"]), `<c r="A1" s="4"/>`);
	assert.ok(!strFromU8(files["xl/worksheets/sheet1.xml"]).includes(`r="B1"`));
});
