"""Reading timetables from PDFs that have text in them."""
import io

from modules.timetable_import.reader import read_workbook
from modules.timetable_import.pdf_reader import PdfWithoutText
import pytest


def _pdf(words, lines=(), boxes=()) -> bytes:
    """A one-page PDF (y from the bottom) with each (text, x, y[, size]) written there,
    each (x0, y0, x1, y1) drawn as a line and each (x, y, width, height) as a box."""
    stream = (
        "".join(f"BT /F1 {w[3] if len(w) > 3 else 10} Tf {w[1]} {w[2]} Td ({w[0]}) Tj ET\n" for w in words)
        + "".join(f"{x0} {y0} m {x1} {y1} l S\n" for x0, y0, x1, y1 in lines)
        + "".join(f"{x} {y} {w} {h} re S\n" for x, y, w, h in boxes)
    ).encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for o in offsets:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objects) + 1, xref)
    return bytes(out)


EXAM_PAGE = _pdf([
    ("WEEK", 30, 780), ("25", 80, 780),
    ("MONDAY", 190, 700), ("25", 250, 700), ("JAN", 275, 700),
    ("TUESDAY", 490, 700), ("26", 555, 700), ("JAN", 580, 700),
    ("9am", 100, 680), ("-", 130, 680), ("12pm", 142, 680), ("12pm", 250, 680), ("-", 285, 680), ("3pm", 300, 680),
    ("9am", 400, 680), ("-", 430, 680), ("12pm", 442, 680), ("12pm", 550, 680), ("-", 585, 680), ("3pm", 600, 680),
    ("FSS-LT", 20, 640),
    ("SSC301", 100, 640), ("POL311", 250, 640), ("SWK111", 550, 640),
    ("Hall", 20, 590), ("2B", 55, 590),
    ("SOW213", 100, 596), ("SWK311", 100, 584), ("PSY203", 400, 590),
])


def _summary(sheet):
    return sorted((e.weekday, e.start.strftime("%H:%M"), e.end.strftime("%H:%M"), e.codes, e.venues) for e in sheet.entries)


def test_without_grid_lines_or_boxes_each_course_takes_its_column():
    (sheet,) = read_workbook(io.BytesIO(EXAM_PAGE))
    assert sheet.shape == "list"
    assert sorted((e.weekday, e.date_text, e.start.hour, e.end.hour, e.codes, e.venues) for e in sheet.entries) == sorted([
        ("Monday", "25 JAN", 9, 12, ["SSC301"], ["FSS-LT"]),
        ("Monday", "25 JAN", 12, 15, ["POL311"], ["FSS-LT"]),
        ("Tuesday", "26 JAN", 12, 15, ["SWK111"], ["FSS-LT"]),
        ("Monday", "25 JAN", 9, 12, ["SOW213"], ["Hall 2B"]),
        ("Monday", "25 JAN", 9, 12, ["SWK311"], ["Hall 2B"]),
        ("Tuesday", "26 JAN", 9, 12, ["PSY203"], ["Hall 2B"]),
    ])


# A lecture page as the platform draws it: Monday and Tuesday, each over an 8-10
# and a 10-12 column (x 90-170-250 and 250-330-410), one venue row, a box per class.
HEADER = [
    ("MONDAY", 150, 700), ("TUESDAY", 308, 700),
    ("8", 110, 680), ("-", 118, 680), ("10am", 124, 680), ("10am", 185, 680), ("-", 210, 680), ("12pm", 218, 680),
    ("8", 270, 680), ("-", 278, 680), ("10am", 284, 680), ("10am", 345, 680), ("-", 370, 680), ("12pm", 378, 680),
    ("RM", 20, 636), ("1", 40, 636),
]
COLUMN_LINES = [(x, 715, x, 600) for x in (170, 250, 330, 410)] + [(90, 668, 90, 600)]  # Monday's left rule starts under the header
ROW_LINES = [(10, 668, 410, 668), (10, 620, 410, 620)]


def test_a_class_takes_its_time_from_its_box_not_its_column():
    # ABC101 runs 9-11: its box straddles both Monday columns and is centred on neither's middle.
    page = _pdf(HEADER + [("ABC101", 152, 636)], COLUMN_LINES + ROW_LINES, boxes=[(130, 630, 80, 18)])
    (sheet,) = read_workbook(io.BytesIO(page))
    assert _summary(sheet) == [("Monday", "09:00", "11:00", ["ABC101"], ["RM 1"])]


def test_a_rows_shaded_background_is_not_read_as_one_long_class():
    page = _pdf(HEADER + [("ABC101", 152, 636), ("DEF202", 352, 636)], COLUMN_LINES + ROW_LINES,
                boxes=[(92, 624, 316, 30), (130, 630, 80, 18), (332, 630, 76, 18)])
    (sheet,) = read_workbook(io.BytesIO(page))
    assert _summary(sheet) == [
        ("Monday", "09:00", "11:00", ["ABC101"], ["RM 1"]),
        ("Tuesday", "10:00", "12:00", ["DEF202"], ["RM 1"]),
    ]


def test_a_code_wrapped_over_two_lines_in_its_box_is_one_code():
    page = _pdf(HEADER + [("PSY-", 270, 640), ("CM101", 268, 630)], COLUMN_LINES + ROW_LINES, boxes=[(252, 626, 76, 26)])
    (sheet,) = read_workbook(io.BytesIO(page))
    assert _summary(sheet) == [("Tuesday", "08:00", "10:00", ["PSY-CM101"], ["RM 1"])]


def test_a_watermark_letter_does_not_join_a_course_code():
    page = _pdf(HEADER + [("ABC101", 152, 636), ("D", 90, 560, 180)], COLUMN_LINES + ROW_LINES, boxes=[(130, 630, 80, 18)])
    (sheet,) = read_workbook(io.BytesIO(page))
    assert [e.codes for e in sheet.entries] == [["ABC101"]]


def test_a_class_at_the_top_of_a_tall_row_stays_in_that_row():
    # NLT A is a short row; RM 2 below it has a five-line label, and its class sits at its
    # top, nearer NLT A's label than its own. The row rules decide.
    words = HEADER[:-2] + [
        ("NLT", 20, 640), ("A", 45, 640),
        ("RM", 20, 600), ("2", 40, 600), ("Sustainable", 20, 590), ("Procurement", 20, 580),
        ("Environmental", 20, 570), ("Centre", 20, 560),
        ("XYZ303", 272, 612),
    ]
    rows = [(10, 668, 410, 668), (10, 625, 410, 625), (10, 550, 410, 550)]
    page = _pdf(words, COLUMN_LINES + rows, boxes=[(252, 606, 76, 16)])
    (sheet,) = read_workbook(io.BytesIO(page))
    assert [e.venues for e in sheet.entries] == [["RM 2 Sustainable Procurement Environmental Centre"]]


def test_one_day_per_page():
    words = [
        ("MONDAY", 230, 700),
        ("8", 110, 680), ("-", 118, 680), ("9:00am", 124, 680),
        ("9", 190, 680), ("-", 198, 680), ("10:00am", 204, 680),
        ("10", 270, 680), ("-", 282, 680), ("11:00am", 288, 680),
        ("RM", 20, 636), ("1", 40, 636),
        ("ABC101", 112, 636), ("DEF202", 232, 636),
    ]
    lines = [(x, 715, x, 600) for x in (90, 170, 250, 330)] + ROW_LINES
    page = _pdf(words, lines, boxes=[(92, 630, 76, 18), (172, 630, 156, 18)])
    (sheet,) = read_workbook(io.BytesIO(page))
    assert _summary(sheet) == [
        ("Monday", "08:00", "09:00", ["ABC101"], ["RM 1"]),
        ("Monday", "09:00", "11:00", ["DEF202"], ["RM 1"]),
    ]


def test_a_pdfs_week_labels_are_ignored():
    (sheet,) = read_workbook(io.BytesIO(EXAM_PAGE))
    assert {e.week for e in sheet.entries} == {None}


def test_a_pdf_without_text_is_refused():
    with pytest.raises(PdfWithoutText):
        read_workbook(io.BytesIO(_pdf([])))

