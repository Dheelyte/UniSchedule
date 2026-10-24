import pytest

from modules.timetable_import.matcher import RoomIndex, RoomRef, room_key


@pytest.mark.parametrize("names", [
    ["Rm 1", "Room 1", "Classroom 1", "RM1", "Class Room 01", "ROOM 1 (MAX 45)"],
    ["URP STUDIO II", "URP Studio 2", "URP STUDIO  2"],
    ["400 LEVEL STUDIO", "YR4 Studio", "Year 4 studio", "400L Studio"],
    ["FAC AUD", "Faculty Auditorium"],
    ["ARCH STD II", "Arch Studio 2", "Architecture Studio II"],
    ["Rooms 305", "Rm 305", "R305"],
    ["BLK C Hall", "Block C hall"],
    ["DLI BKA FIRST FLOOR", "DLI Block A F/F", "DLI BLK A 1st floor"],
    ["Lecture Theatre 1", "LT1"],
])
def test_ways_of_writing_a_room_name_compare_equal(names):
    assert len({room_key(n) for n in names}) == 1, {n: room_key(n) for n in names}


@pytest.mark.parametrize("a,b", [("Room 1", "Room 11"), ("URP Studio 2", "URP Studio 3"), ("G05", "G5A"), ("YR4 Studio", "YR4 Class")])
def test_different_rooms_stay_different(a, b):
    assert room_key(a) != room_key(b)


def test_the_live_room_beats_an_old_copy_and_the_faculty_own_beats_another():
    rooms = RoomIndex([
        RoomRef(1, "URP STUDIO II", 0, None, True),         # old copy, no capacity
        RoomRef(2, "URP Studio 2", 50, "FES", True),
        RoomRef(3, "RM 1", 30, "OTHER", True),
        RoomRef(4, "Room 1", 40, "FES", True),
    ], faculty_id="FES")
    assert rooms.match_one("URP STUDIO II").id == 2
    assert rooms.match_one("Classroom 1").id == 4


from modules.timetable_import.matcher import FacultyIndex, FacultyRef


def test_faculty_names_as_general_studies_writes_them():
    index = FacultyIndex([
        FacultyRef("FCAI-243", "Faculty of Computing and Informatics"),
        FacultyRef("SPEASSECE-7439", "Sustainable Procurement Environmental and Social Standards Enhancement Centre of Excellence"),
        FacultyRef("FES-4006", "Faculty of Enviromental Sciences"),
        FacultyRef("FA-7124", "Faculty of Arts"),
        FacultyRef("FCA-6082", "Faculty of Creative Arts"),
        FacultyRef("FCS-1899", "Faculty of Clinical Sciences"),
    ])
    assert index.match("Computing & Informatics").id == "FCAI-243"
    assert index.match("SPESSCE").id == "SPEASSECE-7439"
    assert index.match("Environmental Science").id == "FES-4006"
    assert index.match("Arts").id == "FA-7124"
    assert index.match("Creative Arts").id == "FCA-6082"
    assert index.match("Clinical Science (CMUL)").id == "FCS-1899"
    assert index.match("Agriculture") is None


@pytest.mark.parametrize("names", [
    ["Room 001", "room 01", "Room 1", "room 0001", "room001", "ROOM0001", "Rm.001", "RM-01", "Room No. 1", "Room number 001"],
    ["S003", "S 003", "S 3", "S3"],
    ["G05", "G5", "G 05"],
    ["LT018", "LT 018", "LT18"],
])
def test_zeros_in_front_of_a_room_number_do_not_matter(names):
    assert len({room_key(n) for n in names}) == 1, {n: room_key(n) for n in names}


def test_rooms_10_and_100_stay_apart():
    assert len({room_key(n) for n in ("Room 1", "Room 10", "Room 100", "Room 010")}) == 3


def test_a_name_several_buildings_use_is_asked_about_unless_the_faculty_has_one():
    rooms = [
        RoomRef(1, "RM 001", 120, "SS", True),
        RoomRef(2, "RM 1", 27, "SPE", True),
        RoomRef(3, "ROOM 1", 0, None, True),  # old copy, no capacity
    ]
    assert RoomIndex(rooms, faculty_id="SS").match_one("Room 1").id == 1
    assert RoomIndex(rooms, faculty_id="SPE").match_one("room001").id == 2
    architecture = RoomIndex(rooms, faculty_id="ARC")
    assert architecture.match_one("Room 1") is None
    assert [r.id for r in architecture.suggest("Room 1")] == [1, 2]
