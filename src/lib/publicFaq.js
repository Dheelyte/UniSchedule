// The public FAQ (/faq): the questions in backend/guide/faq.md tagged "public",
// read when the site is built. Only those questions are ever read here, so
// nothing meant for staff can reach the public page. Server Components only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Marked } from 'marked';

const FAQ_FILE = join(process.cwd(), 'backend', 'guide', 'faq.md');
const ANCHOR = /^<a id="([a-z0-9-]+)"(?:\s+data-roles="([^"]*)")?\s*><\/a>\s*$/;
const HEADING = /^##\s+(.+?)\s*$/;

/** The public questions: [{ id, question, html }], in the file's order. */
export function publicQuestions() {
	const lines = readFileSync(FAQ_FILE, 'utf8').split('\n');
	const questions = [];
	let current = null;
	let pending = null;
	for (const line of lines) {
		const anchor = line.match(ANCHOR);
		if (anchor) {
			pending = { id: anchor[1], roles: (anchor[2] || '').split(',').map((r) => r.trim()) };
			continue;
		}
		const heading = line.match(HEADING);
		if (heading) {
			current = pending && pending.roles.includes('public') ? { id: pending.id, question: heading[1], body: [] } : null;
			if (current) questions.push(current);
			pending = null;
			continue;
		}
		if (line.trim()) pending = null;
		// Role blocks inside a public answer are left out entirely.
		if (current) current.body.push(line);
	}
	const marked = new Marked({ gfm: true });
	return questions.map(({ id, question, body }) => {
		const text = body
			.join('\n')
			.replace(/<!--[\s\S]*?-->[\s\S]*?<!--\s*\/roles\s*-->/g, '')
			.replace(/<!--[\s\S]*?-->/g, '')
			// Only links to public pages stay links; guide links (staff-only) become text.
			.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => (href.startsWith('/') && !href.startsWith('/help') ? m : label));
		return { id, question, html: marked.parse(text.trim()) };
	});
}
