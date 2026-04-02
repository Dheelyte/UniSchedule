// ============================================
// MOCK DATA — University Timetable Management
// ============================================

// ---- FACULTIES ----
export const initialFaculties = [
    { id: 'fac-1', name: 'Faculty of Science' },
    { id: 'fac-2', name: 'Faculty of Engineering' },
    { id: 'fac-3', name: 'Faculty of Arts' },
    { id: 'fac-4', name: 'Faculty of Social Sciences' },
    { id: 'fac-5', name: 'Faculty of Law' },
    { id: 'fac-6', name: 'Faculty of Medicine' },
];

// ---- DEPARTMENTS ----
export const initialDepartments = [
    // Faculty of Science
    { id: 'dept-1', name: 'Computer Science', facultyId: 'fac-1' },
    { id: 'dept-2', name: 'Mathematics', facultyId: 'fac-1' },
    { id: 'dept-3', name: 'Physics', facultyId: 'fac-1' },
    { id: 'dept-4', name: 'Chemistry', facultyId: 'fac-1' },
    // Faculty of Engineering
    { id: 'dept-5', name: 'Electrical Engineering', facultyId: 'fac-2' },
    { id: 'dept-6', name: 'Mechanical Engineering', facultyId: 'fac-2' },
    { id: 'dept-7', name: 'Civil Engineering', facultyId: 'fac-2' },
    // Faculty of Arts
    { id: 'dept-8', name: 'English', facultyId: 'fac-3' },
    { id: 'dept-9', name: 'History', facultyId: 'fac-3' },
    { id: 'dept-10', name: 'Philosophy', facultyId: 'fac-3' },
    // Faculty of Social Sciences
    { id: 'dept-11', name: 'Economics', facultyId: 'fac-4' },
    { id: 'dept-12', name: 'Political Science', facultyId: 'fac-4' },
    { id: 'dept-13', name: 'Sociology', facultyId: 'fac-4' },
    // Faculty of Law
    { id: 'dept-14', name: 'Private & Property Law', facultyId: 'fac-5' },
    { id: 'dept-15', name: 'Public Law', facultyId: 'fac-5' },
    // Faculty of Medicine
    { id: 'dept-16', name: 'Anatomy', facultyId: 'fac-6' },
    { id: 'dept-17', name: 'Physiology', facultyId: 'fac-6' },
];

// ---- COURSES ----
export const initialCourses = [
    // Computer Science
    { id: 'crs-1', code: 'CSC 101', title: 'Introduction to Computer Science', creditLoad: 3, lecturers: ['Dr. Adebayo Ojo'], departmentId: 'dept-1' },
    { id: 'crs-2', code: 'CSC 201', title: 'Data Structures & Algorithms', creditLoad: 3, lecturers: ['Prof. Chinedu Nwankwo'], departmentId: 'dept-1' },
    { id: 'crs-3', code: 'CSC 301', title: 'Operating Systems', creditLoad: 3, lecturers: ['Dr. Fatima Bello'], departmentId: 'dept-1' },
    { id: 'crs-4', code: 'CSC 305', title: 'Software Engineering', creditLoad: 3, lecturers: ['Dr. Adebayo Ojo', 'Mr. Tunde Salami'], departmentId: 'dept-1' },
    { id: 'crs-5', code: 'CSC 401', title: 'Artificial Intelligence', creditLoad: 3, lecturers: ['Prof. Chinedu Nwankwo'], departmentId: 'dept-1' },

    // Mathematics
    { id: 'crs-6', code: 'MTH 101', title: 'Elementary Mathematics I', creditLoad: 4, lecturers: ['Dr. Olumide Ajayi'], departmentId: 'dept-2' },
    { id: 'crs-7', code: 'MTH 201', title: 'Mathematical Methods I', creditLoad: 3, lecturers: ['Prof. Ngozi Eze'], departmentId: 'dept-2' },
    { id: 'crs-8', code: 'MTH 301', title: 'Abstract Algebra', creditLoad: 3, lecturers: ['Dr. Yusuf Abdullahi'], departmentId: 'dept-2' },

    // Physics
    { id: 'crs-9', code: 'PHY 101', title: 'General Physics I', creditLoad: 4, lecturers: ['Dr. Emeka Okafor'], departmentId: 'dept-3' },
    { id: 'crs-10', code: 'PHY 201', title: 'Electromagnetism', creditLoad: 3, lecturers: ['Prof. Amina Yusuf'], departmentId: 'dept-3' },

    // Chemistry
    { id: 'crs-11', code: 'CHM 101', title: 'General Chemistry I', creditLoad: 4, lecturers: ['Dr. Blessing Okoro'], departmentId: 'dept-4' },
    { id: 'crs-12', code: 'CHM 201', title: 'Organic Chemistry I', creditLoad: 3, lecturers: ['Prof. Ifeanyi Obi'], departmentId: 'dept-4' },

    // Electrical Engineering
    { id: 'crs-13', code: 'EEG 201', title: 'Circuit Theory', creditLoad: 3, lecturers: ['Dr. Mustapha Ibrahim'], departmentId: 'dept-5' },
    { id: 'crs-14', code: 'EEG 301', title: 'Digital Electronics', creditLoad: 3, lecturers: ['Prof. Grace Adeniyi'], departmentId: 'dept-5' },

    // Mechanical Engineering
    { id: 'crs-15', code: 'MEG 201', title: 'Engineering Mechanics', creditLoad: 3, lecturers: ['Dr. Kunle Fashola'], departmentId: 'dept-6' },
    { id: 'crs-16', code: 'MEG 301', title: 'Thermodynamics II', creditLoad: 3, lecturers: ['Prof. Ifeoma Nnadi'], departmentId: 'dept-6' },

    // Civil Engineering
    { id: 'crs-17', code: 'CVE 201', title: 'Strength of Materials', creditLoad: 3, lecturers: ['Dr. Abdul Rasheed'], departmentId: 'dept-7' },

    // English
    { id: 'crs-18', code: 'ENG 101', title: 'Introduction to Literature', creditLoad: 2, lecturers: ['Dr. Chioma Uche'], departmentId: 'dept-8' },
    { id: 'crs-19', code: 'ENG 201', title: 'African Literature', creditLoad: 3, lecturers: ['Prof. Wole Soyinka Jr.'], departmentId: 'dept-8' },

    // History
    { id: 'crs-20', code: 'HIS 101', title: 'Introduction to History', creditLoad: 2, lecturers: ['Dr. Taiwo Adeyemi'], departmentId: 'dept-9' },

    // Economics
    { id: 'crs-21', code: 'ECO 101', title: 'Principles of Economics I', creditLoad: 3, lecturers: ['Dr. Nkechi Okonkwo'], departmentId: 'dept-11' },
    { id: 'crs-22', code: 'ECO 201', title: 'Microeconomics', creditLoad: 3, lecturers: ['Prof. Babatunde Lawal'], departmentId: 'dept-11' },

    // Political Science
    { id: 'crs-23', code: 'POL 101', title: 'Introduction to Political Science', creditLoad: 3, lecturers: ['Dr. Halima Suleiman'], departmentId: 'dept-12' },

    // Law
    { id: 'crs-24', code: 'LAW 101', title: 'Introduction to Law', creditLoad: 4, lecturers: ['Prof. Olanrewaju Fagbemi'], departmentId: 'dept-14' },
    { id: 'crs-25', code: 'LAW 201', title: 'Constitutional Law', creditLoad: 3, lecturers: ['Dr. Amaka Eze'], departmentId: 'dept-15' },

    // Anatomy
    { id: 'crs-26', code: 'ANA 201', title: 'Gross Anatomy I', creditLoad: 4, lecturers: ['Prof. Oladipo Akinyemi'], departmentId: 'dept-16' },

    // Physiology
    { id: 'crs-27', code: 'PHS 201', title: 'Human Physiology I', creditLoad: 4, lecturers: ['Dr. Funke Adekunle'], departmentId: 'dept-17' },
];

// ---- ROOMS ----
export const initialRooms = [
    { id: 'room-1', name: 'LT-A (Main Lecture Theatre)', capacity: 500 },
    { id: 'room-2', name: 'LT-B', capacity: 300 },
    { id: 'room-3', name: 'LT-C', capacity: 200 },
    { id: 'room-4', name: 'SCI-101', capacity: 80 },
    { id: 'room-5', name: 'SCI-201', capacity: 60 },
    { id: 'room-6', name: 'SCI-305', capacity: 150 },
    { id: 'room-7', name: 'ENG-101', capacity: 120 },
    { id: 'room-8', name: 'ENG-201', capacity: 80 },
    { id: 'room-9', name: 'ENG-305', capacity: 60 },
    { id: 'room-10', name: 'ARTS-101', capacity: 100 },
    { id: 'room-11', name: 'ARTS-201', capacity: 70 },
    { id: 'room-12', name: 'SOC-101', capacity: 90 },
    { id: 'room-13', name: 'SOC-201', capacity: 60 },
    { id: 'room-14', name: 'LAW-LT', capacity: 250 },
    { id: 'room-15', name: 'MED-101', capacity: 100 },
    { id: 'room-16', name: 'MED-LAB', capacity: 40 },
    { id: 'room-17', name: 'CSC-LAB-1', capacity: 50 },
    { id: 'room-18', name: 'CSC-LAB-2', capacity: 50 },
    { id: 'room-19', name: 'EXAM-HALL-1', capacity: 400 },
    { id: 'room-20', name: 'EXAM-HALL-2', capacity: 350 },
    { id: 'room-21', name: 'PHY-LAB', capacity: 40 },
    { id: 'room-22', name: 'CHM-LAB', capacity: 45 },
    { id: 'room-23', name: 'MULTI-PURPOSE HALL', capacity: 600 },
    { id: 'room-24', name: 'SEMINAR-ROOM-1', capacity: 30 },
];

// ---- SCHEDULE ITEMS ----
// type: 'lecture' | 'exam'
// day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday'
export const initialScheduleItems = [
    // Monday
    { id: 'sch-1', courseId: 'crs-1', roomId: 'room-1', day: 'Monday', startTime: '08:00', endTime: '10:00', type: 'lecture' },
    { id: 'sch-2', courseId: 'crs-6', roomId: 'room-2', day: 'Monday', startTime: '08:00', endTime: '10:00', type: 'lecture' },
    { id: 'sch-3', courseId: 'crs-13', roomId: 'room-7', day: 'Monday', startTime: '10:00', endTime: '12:00', type: 'lecture' },
    { id: 'sch-4', courseId: 'crs-18', roomId: 'room-10', day: 'Monday', startTime: '10:00', endTime: '12:00', type: 'lecture' },
    { id: 'sch-5', courseId: 'crs-21', roomId: 'room-12', day: 'Monday', startTime: '12:00', endTime: '14:00', type: 'lecture' },
    { id: 'sch-6', courseId: 'crs-3', roomId: 'room-4', day: 'Monday', startTime: '14:00', endTime: '16:00', type: 'lecture' },

    // Tuesday
    { id: 'sch-7', courseId: 'crs-9', roomId: 'room-1', day: 'Tuesday', startTime: '08:00', endTime: '10:00', type: 'lecture' },
    { id: 'sch-8', courseId: 'crs-2', roomId: 'room-17', day: 'Tuesday', startTime: '10:00', endTime: '12:00', type: 'lecture' },
    { id: 'sch-9', courseId: 'crs-15', roomId: 'room-7', day: 'Tuesday', startTime: '10:00', endTime: '12:00', type: 'lecture' },
    { id: 'sch-10', courseId: 'crs-24', roomId: 'room-14', day: 'Tuesday', startTime: '12:00', endTime: '14:00', type: 'lecture' },
    { id: 'sch-11', courseId: 'crs-11', roomId: 'room-22', day: 'Tuesday', startTime: '14:00', endTime: '16:00', type: 'lecture' },
    { id: 'sch-12', courseId: 'crs-26', roomId: 'room-15', day: 'Tuesday', startTime: '14:00', endTime: '16:00', type: 'lecture' },

    // Wednesday
    { id: 'sch-13', courseId: 'crs-4', roomId: 'room-17', day: 'Wednesday', startTime: '08:00', endTime: '10:00', type: 'lecture' },
    { id: 'sch-14', courseId: 'crs-7', roomId: 'room-5', day: 'Wednesday', startTime: '08:00', endTime: '10:00', type: 'lecture' },
    { id: 'sch-15', courseId: 'crs-14', roomId: 'room-8', day: 'Wednesday', startTime: '10:00', endTime: '12:00', type: 'lecture' },
    { id: 'sch-16', courseId: 'crs-22', roomId: 'room-12', day: 'Wednesday', startTime: '10:00', endTime: '12:00', type: 'lecture' },
    { id: 'sch-17', courseId: 'crs-19', roomId: 'room-10', day: 'Wednesday', startTime: '12:00', endTime: '14:00', type: 'lecture' },
    { id: 'sch-18', courseId: 'crs-25', roomId: 'room-14', day: 'Wednesday', startTime: '14:00', endTime: '16:00', type: 'lecture' },

    // Thursday
    { id: 'sch-19', courseId: 'crs-5', roomId: 'room-4', day: 'Thursday', startTime: '08:00', endTime: '10:00', type: 'lecture' },
    { id: 'sch-20', courseId: 'crs-10', roomId: 'room-21', day: 'Thursday', startTime: '08:00', endTime: '10:00', type: 'lecture' },
    { id: 'sch-21', courseId: 'crs-16', roomId: 'room-9', day: 'Thursday', startTime: '10:00', endTime: '12:00', type: 'lecture' },
    { id: 'sch-22', courseId: 'crs-12', roomId: 'room-6', day: 'Thursday', startTime: '10:00', endTime: '12:00', type: 'lecture' },
    { id: 'sch-23', courseId: 'crs-23', roomId: 'room-13', day: 'Thursday', startTime: '12:00', endTime: '14:00', type: 'lecture' },
    { id: 'sch-24', courseId: 'crs-27', roomId: 'room-15', day: 'Thursday', startTime: '14:00', endTime: '16:00', type: 'lecture' },

    // Friday
    { id: 'sch-25', courseId: 'crs-8', roomId: 'room-5', day: 'Friday', startTime: '08:00', endTime: '10:00', type: 'lecture' },
    { id: 'sch-26', courseId: 'crs-17', roomId: 'room-7', day: 'Friday', startTime: '10:00', endTime: '12:00', type: 'lecture' },
    { id: 'sch-27', courseId: 'crs-20', roomId: 'room-11', day: 'Friday', startTime: '10:00', endTime: '12:00', type: 'lecture' },

    // Exams (spread across the week)
    { id: 'sch-28', courseId: 'crs-1', roomId: 'room-19', day: 'Monday', startTime: '09:00', endTime: '12:00', type: 'exam' },
    { id: 'sch-29', courseId: 'crs-6', roomId: 'room-20', day: 'Monday', startTime: '09:00', endTime: '12:00', type: 'exam' },
    { id: 'sch-30', courseId: 'crs-9', roomId: 'room-19', day: 'Monday', startTime: '14:00', endTime: '17:00', type: 'exam' },
    { id: 'sch-31', courseId: 'crs-11', roomId: 'room-20', day: 'Tuesday', startTime: '09:00', endTime: '12:00', type: 'exam' },
    { id: 'sch-32', courseId: 'crs-2', roomId: 'room-19', day: 'Tuesday', startTime: '14:00', endTime: '17:00', type: 'exam' },
    { id: 'sch-33', courseId: 'crs-13', roomId: 'room-23', day: 'Wednesday', startTime: '09:00', endTime: '12:00', type: 'exam' },
    { id: 'sch-34', courseId: 'crs-24', roomId: 'room-19', day: 'Wednesday', startTime: '14:00', endTime: '17:00', type: 'exam' },
    { id: 'sch-35', courseId: 'crs-21', roomId: 'room-20', day: 'Thursday', startTime: '09:00', endTime: '12:00', type: 'exam' },
    { id: 'sch-36', courseId: 'crs-3', roomId: 'room-19', day: 'Thursday', startTime: '14:00', endTime: '17:00', type: 'exam' },
    { id: 'sch-37', courseId: 'crs-18', roomId: 'room-23', day: 'Friday', startTime: '09:00', endTime: '12:00', type: 'exam' },
];
