# Page previews

Every page of the app has a short step-by-step preview that points at each feature and explains it. It plays automatically the first time you open a page. The public pages (the home page, signing in, download, verify, common questions and contributors) don't have one.

<a id="tour"></a>
## Using a preview

- **Next** and **Back** move between steps; so do the arrow keys and Enter.
- **Skip** or **Esc** closes it. It still counts as seen.
- **Done** on the last step closes it.
- **Learn more in the guide** opens that feature's section of the [Help centre](help-centre.md) in a new tab.

The preview only covers what's on your screen: a feature your role can't use isn't mentioned, and a feature that isn't there yet (for example, conflicts when there are none) is skipped.

<a id="tour-help"></a>
## The "?" button

Bottom right of every page:

- **Show this page's preview:** play it again at any time.
- **Turn previews off:** stop them playing automatically everywhere. You can still open one from here.
- **Turn previews on:** start again; every page plays its preview the next time you open it.
- **Open the guide for this page:** the [Help centre](help-centre.md) page about where you are.
- **Help centre:** the guide's home page.

## Where it's remembered

On your account, so it follows you to other devices and browsers.

<!-- roles: SUPER_ADMIN -->
While [viewing as another role](glossary.md#impersonation), previews don't play automatically, but you can open one from the "?" button.
<!-- /roles -->

<a id="previews-developers" data-roles="SUPER_ADMIN"></a>
## For developers

The text of every preview is in `src/lib/tours.js`. Each step points at a feature by its `data-tour` attribute in the app. A test (`src/lib/tours.test.mjs`) fails if a step points at a name that no longer exists, or if its "Learn more" link has no matching section in this guide. Preferences are stored on the user (`tours_enabled`, `tours_seen`) through `/api/v1/tours`.
