"""Faculties and rooms belong to a realm; hall groups link the same physical hall

Revision ID: o5j6k7l8m9n0
Revises: n4i5j6k7l8m9
Create Date: 2026-10-12 00:00:00.000000

Additive and safe for the previous version of the code: the deploy workflow
runs this on production before the new Lambda is live, so old code keeps
inserting faculties and rooms without realm_key and the 'UG' server defaults
place them in UG.

Departments get no column: a department belongs to its faculty's realm.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

INT_ARRAY = postgresql.ARRAY(sa.Integer())


revision: str = 'o5j6k7l8m9n0'
down_revision: Union[str, Sequence[str], None] = 'n4i5j6k7l8m9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. Hall groups: rooms in the same group are the same physical hall.
    op.create_table(
        'hall_groups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # 2. Realm columns. The server default leaves every existing row in UG.
    op.add_column('faculties', sa.Column(
        'realm_key', sa.String(), sa.ForeignKey('realms.key'), server_default='UG', nullable=False,
    ))
    op.add_column('rooms', sa.Column(
        'realm_key', sa.String(), sa.ForeignKey('realms.key'), server_default='UG', nullable=False,
    ))
    op.add_column('rooms', sa.Column(
        'hall_group_id', sa.Integer(), sa.ForeignKey('hall_groups.id', ondelete='SET NULL'), nullable=True,
    ))
    op.create_index(op.f('ix_faculties_realm_key'), 'faculties', ['realm_key'], unique=False)
    op.create_index(op.f('ix_rooms_realm_key'), 'rooms', ['realm_key'], unique=False)
    op.create_index(op.f('ix_rooms_hall_group_id'), 'rooms', ['hall_group_id'], unique=False)

    # 3. Names are unique inside a realm, not globally. Existing rows are all UG,
    #    so both new constraints hold for the data the old ones allowed.
    op.execute("ALTER TABLE faculties DROP CONSTRAINT IF EXISTS faculties_name_key")
    op.create_unique_constraint('uq_faculties_realm_name', 'faculties', ['realm_key', 'name'])
    op.drop_constraint('uq_room_name_faculty', 'rooms', type_='unique')
    op.create_unique_constraint('uq_room_realm_name_faculty', 'rooms', ['realm_key', 'name', 'faculty_id'])
    # A hall group holds at most one room per realm.
    op.create_unique_constraint('uq_room_hall_group_realm', 'rooms', ['hall_group_id', 'realm_key'])

    # 4. Data other realms entered while faculties, departments and rooms were
    #    shared moves onto faculties, departments and rooms of their own.
    _move_other_realms_off_ug(op.get_bind())


def _move_other_realms_off_ug(bind) -> None:
    """Give each non-UG realm its own copy of whatever UG faculty, department
    or room its rows point at, and repoint those rows. UG rows are not touched.
    Does nothing when no other realm has data."""
    realms = bind.execute(sa.text("""
        SELECT realm_key FROM courses WHERE realm_key <> 'UG'
        UNION SELECT realm_key FROM schedule_items WHERE realm_key <> 'UG'
        UNION SELECT realm_key FROM change_requests WHERE realm_key <> 'UG'
        UNION SELECT realm_key FROM users WHERE realm_key IS NOT NULL AND realm_key <> 'UG' AND faculty_id IS NOT NULL
        UNION SELECT realm_key FROM invitations WHERE realm_key IS NOT NULL AND realm_key <> 'UG' AND faculty_id IS NOT NULL
        ORDER BY 1
    """)).scalars().all()

    for realm in realms:
        p = {"realm": realm}

        department_ids = bind.execute(sa.text("""
            SELECT department_id FROM courses WHERE realm_key = :realm AND department_id IS NOT NULL
            UNION
            SELECT e.department_id FROM course_enrollments e JOIN courses c ON c.id = e.course_id
            WHERE c.realm_key = :realm
            ORDER BY 1
        """), p).scalars().all()
        room_ids = bind.execute(sa.text("""
            SELECT r.id FROM rooms r WHERE r.realm_key = 'UG' AND r.id IN (
                SELECT unnest(room_ids) FROM schedule_items WHERE realm_key = :realm
                UNION
                SELECT unnest(room_ids) FROM change_requests WHERE realm_key = :realm
            ) ORDER BY 1
        """), p).scalars().all()

        # Faculties: those the realm's accounts, sessions, departments and rooms belong to.
        faculty_ids = bind.execute(sa.text("""
            SELECT f.id FROM faculties f WHERE f.realm_key = 'UG' AND f.id IN (
                SELECT faculty_id FROM users WHERE realm_key = :realm
                UNION SELECT faculty_id FROM invitations WHERE realm_key = :realm
                UNION SELECT faculty_id FROM schedule_items WHERE realm_key = :realm
                UNION SELECT faculty_id FROM change_requests WHERE realm_key = :realm
                UNION SELECT faculty_id FROM departments WHERE id = ANY(:departments)
                UNION SELECT faculty_id FROM rooms WHERE id = ANY(:rooms)
            ) ORDER BY 1
        """).bindparams(
            sa.bindparam("departments", type_=INT_ARRAY), sa.bindparam("rooms", type_=INT_ARRAY),
        ), {**p, "departments": list(department_ids), "rooms": list(room_ids)}).scalars().all()

        faculty_map: dict[str, str] = {}
        for old_id in faculty_ids:
            new_id = f"{realm}-{old_id}"
            bind.execute(sa.text("""
                INSERT INTO faculties (id, name, is_special, realm_key)
                SELECT :new_id, name, is_special, :realm FROM faculties WHERE id = :old_id
            """), {"new_id": new_id, "old_id": old_id, "realm": realm})
            faculty_map[old_id] = new_id
            for table in ("users", "invitations", "schedule_items", "change_requests"):
                bind.execute(sa.text(
                    f"UPDATE {table} SET faculty_id = :new_id WHERE realm_key = :realm AND faculty_id = :old_id"
                ), {"new_id": new_id, "old_id": old_id, "realm": realm})

        # Departments, under the realm's copy of their faculty.
        for old_id in department_ids:
            row = bind.execute(sa.text(
                "SELECT d.name, d.faculty_id FROM departments d JOIN faculties f ON f.id = d.faculty_id "
                "WHERE d.id = :id AND f.realm_key = 'UG'"
            ), {"id": old_id}).first()
            if row is None:
                continue
            new_id = bind.execute(sa.text(
                "INSERT INTO departments (name, faculty_id) VALUES (:name, :faculty_id) RETURNING id"
            ), {"name": row.name, "faculty_id": faculty_map[row.faculty_id]}).scalar_one()
            ids = {"new_id": new_id, "old_id": old_id, "realm": realm}
            bind.execute(sa.text(
                "UPDATE courses SET department_id = :new_id WHERE realm_key = :realm AND department_id = :old_id"
            ), ids)
            bind.execute(sa.text("""
                UPDATE course_enrollments SET department_id = :new_id
                WHERE department_id = :old_id
                  AND course_id IN (SELECT id FROM courses WHERE realm_key = :realm)
            """), ids)

        # Rooms: a copy in the realm, in one hall group with its original.
        room_map: dict[int, int] = {}
        for old_id in room_ids:
            room = bind.execute(sa.text("SELECT * FROM rooms WHERE id = :id"), {"id": old_id}).mappings().one()
            group_id = room["hall_group_id"]
            if group_id is None:
                group_id = bind.execute(sa.text("INSERT INTO hall_groups DEFAULT VALUES RETURNING id")).scalar_one()
                bind.execute(sa.text("UPDATE rooms SET hall_group_id = :group WHERE id = :id"), {"group": group_id, "id": old_id})
            room_map[old_id] = bind.execute(sa.text("""
                INSERT INTO rooms (name, capacity, faculty_id, display_order, is_lab, is_active,
                                   active_seats, inactive_seats, realm_key, hall_group_id)
                VALUES (:name, :capacity, :faculty_id, :display_order, :is_lab, :is_active,
                        :active_seats, :inactive_seats, :realm, :group)
                RETURNING id
            """), {
                "name": room["name"], "capacity": room["capacity"],
                "faculty_id": faculty_map.get(room["faculty_id"]),
                "display_order": room["display_order"], "is_lab": room["is_lab"], "is_active": room["is_active"],
                "active_seats": room["active_seats"], "inactive_seats": room["inactive_seats"],
                "realm": realm, "group": group_id,
            }).scalar_one()

        if room_map:
            for table in ("schedule_items", "change_requests"):
                rows = bind.execute(sa.text(
                    f"SELECT id, room_ids FROM {table} WHERE realm_key = :realm AND room_ids IS NOT NULL"
                ), p).all()
                for row in rows:
                    moved = [room_map.get(rid, rid) for rid in row.room_ids]
                    if moved != list(row.room_ids):
                        bind.execute(sa.text(
                            f"UPDATE {table} SET room_ids = :room_ids WHERE id = :id"
                        ).bindparams(sa.bindparam("room_ids", type_=INT_ARRAY)), {"room_ids": moved, "id": row.id})


def downgrade() -> None:
    """Downgrade schema.

    Hall groups are dropped. Faculties and rooms of other realms can't be
    folded back into one shared list, so they have to be removed first.
    """
    bind = op.get_bind()
    faculties = bind.execute(sa.text(
        "SELECT id FROM faculties WHERE realm_key <> 'UG' ORDER BY id LIMIT 10"
    )).scalars().all()
    rooms = bind.execute(sa.text(
        "SELECT name FROM rooms WHERE realm_key <> 'UG' ORDER BY name LIMIT 10"
    )).scalars().all()
    if faculties or rooms:
        raise RuntimeError(
            "Cannot downgrade: other realms have their own faculties "
            f"({', '.join(faculties) or 'none'}) or rooms ({', '.join(rooms) or 'none'}). "
            "Remove them first."
        )

    op.drop_constraint('uq_room_hall_group_realm', 'rooms', type_='unique')
    op.drop_constraint('uq_room_realm_name_faculty', 'rooms', type_='unique')
    op.create_unique_constraint('uq_room_name_faculty', 'rooms', ['name', 'faculty_id'])
    op.drop_constraint('uq_faculties_realm_name', 'faculties', type_='unique')
    op.create_unique_constraint('faculties_name_key', 'faculties', ['name'])

    op.drop_index(op.f('ix_rooms_hall_group_id'), table_name='rooms')
    op.drop_index(op.f('ix_rooms_realm_key'), table_name='rooms')
    op.drop_index(op.f('ix_faculties_realm_key'), table_name='faculties')
    op.drop_column('rooms', 'hall_group_id')
    op.drop_column('rooms', 'realm_key')
    op.drop_column('faculties', 'realm_key')
    op.drop_table('hall_groups')
