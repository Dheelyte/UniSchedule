"""Seed values for the realms table.

The Alembic revision that creates `realms` carries its own copy of these
configs (migrations must not import app code); a test keeps the two in sync.
"""

DEFAULT_REALM_KEY = "UG"

# Reproduces the values that were hardcoded before realms existed.
UG_CONFIG = {
    "lecture_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    "exam_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    "day_start": "08:00",
    "day_end": "18:00",
    "slot_minutes": 30,
    "exam_slots": [
        {"label": "9am - 12pm", "start": "09:00", "end": "12:00"},
        {"label": "12pm - 3pm", "start": "12:00", "end": "15:00"},
        {"label": "3pm - 6pm", "start": "15:00", "end": "18:00"},
    ],
    "levels": [100, 200, 300, 400, 500, 600, 700],
    "semester_names": ["First Semester", "Second Semester"],
    "strict": False,
}

ICE_CONFIG = {
    "lecture_days": ["Friday", "Saturday", "Sunday"],
    "exam_days": ["Friday", "Saturday", "Sunday"],
    "day_start": "07:00",
    "day_end": "21:00",
    "slot_minutes": 15,
    "exam_slots": [
        {"label": "7am - 10am", "start": "07:00", "end": "10:00"},
        {"label": "10am - 1pm", "start": "10:00", "end": "13:00"},
        {"label": "1pm - 4pm", "start": "13:00", "end": "16:00"},
        {"label": "4pm - 7pm", "start": "16:00", "end": "19:00"},
        {"label": "7pm - 9pm", "start": "19:00", "end": "21:00"},
    ],
    "levels": [100, 200, 300, 400, 500, 600, 700],
    "semester_names": ["First Semester", "Second Semester"],
    "strict": True,
}

# PG and FOUNDATION are placeholders: a copy of the UG config, not live.
SEED_REALMS = [
    {"key": "UG", "name": "Undergraduate", "description": "Full-time undergraduate programmes",
     "is_live": True, "sort_order": 1, "config": UG_CONFIG},
    {"key": "PG", "name": "Postgraduate", "description": "Postgraduate programmes",
     "is_live": False, "sort_order": 2, "config": UG_CONFIG},
    {"key": "ICE", "name": "ICE", "description": "Part-time programmes",
     "is_live": False, "sort_order": 3, "config": ICE_CONFIG},
    {"key": "FOUNDATION", "name": "Foundation", "description": "Foundation programmes",
     "is_live": False, "sort_order": 4, "config": UG_CONFIG},
]
