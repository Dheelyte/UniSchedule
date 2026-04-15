'use client';

import { createContext, useContext, useReducer, useMemo } from 'react';
import { generateId } from '@/lib/utils';

// ---- INITIAL STATE ----
const initialState = {
    faculties: [],
    departments: [],
    courses: [],
    rooms: [],
    scheduleItems: [],
};

// ---- ACTION TYPES ----
export const ACTION_TYPES = {
    INIT_STATE: 'INIT_STATE',
    // Faculties
    ADD_FACULTY: 'ADD_FACULTY',
    UPDATE_FACULTY: 'UPDATE_FACULTY',
    DELETE_FACULTY: 'DELETE_FACULTY',
    // Departments
    ADD_DEPARTMENT: 'ADD_DEPARTMENT',
    UPDATE_DEPARTMENT: 'UPDATE_DEPARTMENT',
    DELETE_DEPARTMENT: 'DELETE_DEPARTMENT',
    // Courses
    ADD_COURSE: 'ADD_COURSE',
    UPDATE_COURSE: 'UPDATE_COURSE',
    DELETE_COURSE: 'DELETE_COURSE',
    // Rooms
    ADD_ROOM: 'ADD_ROOM',
    UPDATE_ROOM: 'UPDATE_ROOM',
    DELETE_ROOM: 'DELETE_ROOM',
    // Schedule Items
    ADD_SCHEDULE: 'ADD_SCHEDULE',
    UPDATE_SCHEDULE: 'UPDATE_SCHEDULE',
    DELETE_SCHEDULE: 'DELETE_SCHEDULE',
};

// ---- REDUCER ----
function appReducer(state, action) {
    switch (action.type) {
        // ---- Context Init ----
        case ACTION_TYPES.INIT_STATE:
            return {
                ...state,
                ...action.payload
            };

        // ---- Faculties ----
        case ACTION_TYPES.ADD_FACULTY:
            return {
                ...state,
                faculties: [...state.faculties, { id: generateId('fac'), ...action.payload }],
            };
        case ACTION_TYPES.UPDATE_FACULTY:
            return {
                ...state,
                faculties: state.faculties.map((f) =>
                    f.id === action.payload.id ? { ...f, ...action.payload } : f
                ),
            };
        case ACTION_TYPES.DELETE_FACULTY:
            return {
                ...state,
                faculties: state.faculties.filter((f) => f.id !== action.payload),
                // Cascade: remove departments (and their courses & schedules)
                departments: state.departments.filter((d) => d.facultyId !== action.payload),
                courses: state.courses.filter((c) => {
                    const deptIds = state.departments
                        .filter((d) => d.facultyId === action.payload)
                        .map((d) => d.id);
                    return !deptIds.includes(c.departmentId);
                }),
                scheduleItems: state.scheduleItems.filter((s) => {
                    const deptIds = state.departments
                        .filter((d) => d.facultyId === action.payload)
                        .map((d) => d.id);
                    const courseIds = state.courses
                        .filter((c) => deptIds.includes(c.departmentId))
                        .map((c) => c.id);
                    return !courseIds.includes(s.courseId);
                }),
            };

        // ---- Departments ----
        case ACTION_TYPES.ADD_DEPARTMENT:
            return {
                ...state,
                departments: [...state.departments, { id: generateId('dept'), ...action.payload }],
            };
        case ACTION_TYPES.UPDATE_DEPARTMENT:
            return {
                ...state,
                departments: state.departments.map((d) =>
                    d.id === action.payload.id ? { ...d, ...action.payload } : d
                ),
            };
        case ACTION_TYPES.DELETE_DEPARTMENT:
            return {
                ...state,
                departments: state.departments.filter((d) => d.id !== action.payload),
                // Cascade: remove courses in this department and their schedules
                courses: state.courses.filter((c) => c.departmentId !== action.payload),
                scheduleItems: state.scheduleItems.filter((s) => {
                    const courseIds = state.courses
                        .filter((c) => c.departmentId === action.payload)
                        .map((c) => c.id);
                    return !courseIds.includes(s.courseId);
                }),
            };

        // ---- Courses ----
        case ACTION_TYPES.ADD_COURSE:
            return {
                ...state,
                courses: [...state.courses, { id: generateId('crs'), ...action.payload }],
            };
        case ACTION_TYPES.UPDATE_COURSE:
            return {
                ...state,
                courses: state.courses.map((c) =>
                    c.id === action.payload.id ? { ...c, ...action.payload } : c
                ),
            };
        case ACTION_TYPES.DELETE_COURSE:
            return {
                ...state,
                courses: state.courses.filter((c) => c.id !== action.payload),
                scheduleItems: state.scheduleItems.filter((s) => s.courseId !== action.payload),
            };

        // ---- Rooms ----
        case ACTION_TYPES.ADD_ROOM:
            return {
                ...state,
                rooms: [...state.rooms, { id: generateId('room'), ...action.payload }],
            };
        case ACTION_TYPES.UPDATE_ROOM:
            return {
                ...state,
                rooms: state.rooms.map((r) =>
                    r.id === action.payload.id ? { ...r, ...action.payload } : r
                ),
            };
        case ACTION_TYPES.DELETE_ROOM: {
            const deletedRoomId = action.payload;
            return {
                ...state,
                rooms: state.rooms.filter((r) => r.id !== deletedRoomId),
                // Remove the room from roomIds arrays; drop schedule if no rooms remain
                scheduleItems: state.scheduleItems
                    .map((s) => ({
                        ...s,
                        roomIds: (s.roomIds || []).filter((rid) => rid !== deletedRoomId),
                    }))
                    .filter((s) => s.roomIds.length > 0),
            };
        }

        // ---- Schedule Items ----
        case ACTION_TYPES.ADD_SCHEDULE:
            return {
                ...state,
                scheduleItems: [...state.scheduleItems, action.payload],
            };
        case ACTION_TYPES.UPDATE_SCHEDULE:
            return {
                ...state,
                scheduleItems: state.scheduleItems.map((s) =>
                    s.id === action.payload.id ? { ...s, ...action.payload } : s
                ),
            };
        case ACTION_TYPES.DELETE_SCHEDULE:
            return {
                ...state,
                scheduleItems: state.scheduleItems.filter((s) => s.id !== action.payload),
            };

        default:
            return state;
    }
}

// ---- CONTEXT ----
const AppContext = createContext(null);

import { useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';

export function AppProvider({ children }) {
    const [state, dispatch] = useReducer(appReducer, initialState);

    // Global API fetch removed - Individual pages now perform Just-in-Time component fetching

    // Memoised derived data for the dashboard
    const stats = useMemo(() => {
        const scheduledCourseIds = new Set(state.scheduleItems.map((s) => s.courseId));
        return {
            totalScheduled: scheduledCourseIds.size,
            activeFaculties: state.faculties.length,
            totalRooms: state.rooms.length,
            totalCourses: state.courses.length,
            totalDepartments: state.departments.length,
            lectureCount: state.scheduleItems.filter((s) => s.type === 'lecture').length,
            examCount: state.scheduleItems.filter((s) => s.type === 'exam').length,
        };
    }, [state]);

    // Helper: get department with its faculty name
    const getDepartmentsWithFaculty = useMemo(() => {
        return state.departments.map((dept) => {
            const faculty = state.faculties.find((f) => f.id === dept.facultyId);
            return { ...dept, facultyName: faculty?.name || 'Unknown' };
        });
    }, [state.departments, state.faculties]);

    // Helper: get courses with department & faculty info
    const getCoursesWithDetails = useMemo(() => {
        return state.courses.map((course) => {
            const dept = state.departments.find((d) => d.id === course.departmentId);
            const faculty = dept ? state.faculties.find((f) => f.id === dept.facultyId) : null;
            return {
                ...course,
                departmentName: dept?.name || 'Unknown',
                facultyName: faculty?.name || 'Unknown',
            };
        });
    }, [state.courses, state.departments, state.faculties]);

    // Helper: get schedules with full details
    const getSchedulesWithDetails = useMemo(() => {
        return state.scheduleItems.map((item) => {
            const course = state.courses.find((c) => c.id === item.courseId);
            // Resolve roomIds to room objects
            const ids = item.roomIds || (item.roomId ? [item.roomId] : []);
            const resolvedRooms = ids.map((rid) => state.rooms.find((r) => r.id === rid)).filter(Boolean);
            const dept = course ? state.departments.find((d) => d.id === course.departmentId) : null;
            const faculty = dept ? state.faculties.find((f) => f.id === dept.facultyId) : null;
            return {
                ...item,
                roomIds: ids,
                courseCode: course?.code || 'N/A',
                courseTitle: course?.title || 'Unknown',
                courseLecturers: course?.lecturers || [],
                courseLocations: course?.locations || [],
                // Multi-room display helpers
                roomNames: resolvedRooms.map((r) => r.name).join(', ') || 'Unknown',
                roomCapacity: resolvedRooms.reduce((sum, r) => sum + (r.capacity || 0), 0),
                departmentId: dept?.id || null,
                departmentName: dept?.name || 'Unknown',
                facultyId: faculty?.id || null,
                facultyName: faculty?.name || 'Unknown',
            };
        });
    }, [state]);

    const value = {
        state,
        dispatch,
        stats,
        getDepartmentsWithFaculty,
        getCoursesWithDetails,
        getSchedulesWithDetails,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** Hook to consume the app context. */
export function useApp() {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
    return ctx;
}
