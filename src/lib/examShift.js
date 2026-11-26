// Building the request for the "Shift exams" tool and describing its result.
// The server does the planning (Sundays, holidays and blocked slots); this only
// turns the form into a request and checks it is complete.

// Programmes the tool is offered in; ICE (exams Friday-Sunday) isn't supported yet.
// Kept in step with EXAM_SHIFT_REALMS in the backend.
export const EXAM_SHIFT_REALMS = ["UG"];

export const SHIFT_MODES = [
	{ key: "days", label: "By exam days" },
	{ key: "weeks", label: "By weeks" },
	{ key: "start_date", label: "To a new start date" },
];

/**
 * @returns {{ body?: object, error?: string }}
 */
export function buildShiftRequest(form) {
	const { semesterId, mode, amount, direction = "later", newStartDate, facultyIds = [], fromDate, toDate } = form;
	if (semesterId === null || semesterId === undefined) return { error: "Choose a semester first." };
	const body = { semester_id: semesterId, mode };

	if (mode === "start_date") {
		if (!newStartDate) return { error: "Choose the new date for the first exam." };
		body.new_start_date = newStartDate;
	} else if (mode === "days" || mode === "weeks") {
		const n = Number(amount);
		if (!Number.isInteger(n) || n < 1 || n > 60) {
			return { error: `Enter a whole number of ${mode === "days" ? "exam days" : "weeks"} from 1 to 60.` };
		}
		body.amount = direction === "earlier" ? -n : n;
	} else {
		return { error: "Choose how to shift the exams." };
	}

	if (facultyIds.length) body.faculty_ids = [...facultyIds];
	if (fromDate) body.from_date = fromDate;
	if (toDate) body.to_date = toDate;
	if (fromDate && toDate && fromDate > toDate) return { error: "The 'from' date is after the 'to' date." };
	return { body };
}

/** "Mon 10 Aug" for an ISO date string, without time-zone drift. */
export function shortDate(iso) {
	if (!iso) return "";
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** One line summarising a preview, e.g. "12 of 40 exams will move." */
export function describeShift(result) {
	if (!result) return "";
	if (result.selected === 0) return "No exams match these choices.";
	if (result.moving === 0) return "None of the chosen exams would change date.";
	const of = result.moving === result.selected ? "" : ` of ${result.selected}`;
	return `${result.moving}${of} exam${result.selected === 1 ? "" : "s"} will move.`;
}
