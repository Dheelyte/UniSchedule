<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Keep the user guide and page previews in step with the app

Whenever a feature is added, changed or removed, in the same change:

1. **Update the user guide** in `backend/guide/`: the page for the screen it's on (one file per page; `backend/guide/README.md` lists them), plus `roles.md` if who can use it changed, `glossary.md` if it introduces or changes a term, and `faq.md` if it changes an answer there. Describe what the user sees and can do, in plain language. Remove what no longer exists. The guide is published in the app as the Help centre (`/help`, signed in only), served by the backend filtered for the reader's role: each file is a page, and a new file must be linked from `backend/guide/README.md` to appear in its menu. Write standard Markdown; it's rendered with `marked`.
   - **Mark who it's for.** Anything not for every signed-in role must be marked with the roles that can use it (a whole page, a section, or lines; see "Who sees what" in `backend/guide/README.md`). A role must never be told about a feature it can't use. Questions for students and visitors go in `faq.md` tagged `public`, which also shows them on the public FAQ (`/faq`).
2. **Update the page preview** in `src/lib/tours.js`: add, reword or remove the step, and keep the feature's `data-tour` attribute in the app. Steps for features only some roles see need no `roles` filter (a step whose element isn't on screen is skipped); use `roles` only when everyone sees the element but it means something different.
3. **Keep the anchors.** Each feature's guide section starts with `<a id="name"></a>`, where `name` is its `data-tour` name. Don't rename one without updating every link to it; links from the app and elsewhere rely on them.
4. **Run `npm test` and the backend's `tests/test_help.py`.** `src/lib/tours.test.mjs` fails when a preview step points at a `data-tour` name that no longer exists, when a step's "Learn more" link has no matching page or section in the guide, when a guide page isn't linked from the index, or when a link inside the guide is broken.

This applies to backend changes that change what users see or can do (for example new rules, limits or permissions), not only to UI changes.
