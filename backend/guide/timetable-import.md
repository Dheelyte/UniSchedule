<!-- page-roles: SUPER_ADMIN -->
# Import a timetable (Beta)

**Where:** "Import" or "Copy semester" on the lecture or exam timetable (`/timetable/import`). **Who:** Super Admin, on the current semester while the timetable is a draft.

Bring a timetable in from a file, or copy one from an earlier semester. Nothing is saved until you've checked a preview and confirmed.

<a id="imp-source"></a>
## From a file or from an earlier semester

Choose where the timetable comes from. This can't be changed once a preview is showing; use **Start over**.

<a id="imp-back"></a>
## Back to timetable

Leave without importing.

<a id="imp-type"></a>
## Timetable

Lectures or exams.

<a id="imp-faculty"></a>
## Faculty

The faculty the timetable belongs to. When copying a semester you can choose **All faculties**.

<a id="imp-file"></a>
## The file

An Excel (`.xlsx`), Word (`.docx`) or PDF file, up to the size shown. PDFs must have selectable text; a scanned image can't be read. For an Excel file with several sheets, you choose the sheet in the preview.

<a id="imp-copy-from"></a>
## Copy from

The earlier semester to copy, with how many lectures or exams it has. Its courses, days, times and rooms are copied and checked against this semester.

<a id="imp-place-all"></a>
## Place in every faculty

General studies only. For lectures: put each session in every faculty's timetable. For exams: put each paper in the faculties its row names.

<a id="imp-mode"></a>
## If the faculty already has a timetable

- **Replace it:** the faculty's current timetable is removed first.
- **Add to it:** what's there is kept and the new items are added.

<a id="imp-read"></a>
## Read file / Preview copy

Reads the file or the earlier semester and shows a preview:

- **Summary:** how many sessions were found, and which will be added.
- **Before importing:** anything that didn't match is asked about. That covers course codes that aren't in this programme (pick the right course or leave it out), faculty names, and venues (pick a room, or "No room"). For exams with no year or start date, you're asked for those.
- **Venues matched automatically:** check these. If the file has more than one venue column, choose the right one.
- **Sessions:** every session that will be created, filterable by status.
- **Cells with no course code:** text that couldn't be read as a course, so you can check nothing was missed. You can choose to skip sessions that land on blocked time.

**Import** saves it once everything is answered. The result says how many sessions were added.

<a id="imp-history"></a>
## Past imports

Every earlier import for this timetable: when, faculty, file, number of sessions and who did it.

- **Revert** undoes an import, removing what it added.
- **Approve** confirms an import is correct. An approved import can no longer be reverted.
