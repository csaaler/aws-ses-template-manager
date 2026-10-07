# Template import: design

Date: 2026-10-07. Status: draft for review.

## Goal

Import several SES templates at once from JSON files on disk, such as the `ses/*.json` files in an exported template bundle. Before anything is written to SES, the user sees an overview showing:

- which templates will be imported,
- which are incomplete or malformed and will not be imported,
- which already exist in the target region.

The user can rename templates before import. For each name that already exists, they choose to replace or skip it.

## Decisions

| Topic | Decision |
|---|---|
| Source | Only `.json` files the user selects. HTML and text files are not read. |
| Picking | A multi-select file picker limited to `.json`. The user opens the `ses/` folder and selects the files. |
| Selection | Every selected file becomes a row. Rows are removed with a ✕ button; there are no checkboxes. |
| Complete | Name, subject, HTML and text are all present and non-empty, in the exact `aws ses create-template --cli-input-json` shape. |
| Conflicts | The user is asked per template whether to Replace or Skip, with an "apply to all remaining conflicts" option. |
| Server | No new endpoints. The import calls the existing create and update template endpoints one template at a time. |

## Entry point

- The list page gets an **Import** button next to "Create New". It links to `/import-templates`.
- The import page reads the region from `localStorage.region`, the same source every other page uses. If no region is set, it redirects to `/`.
- The region appears in a banner at the top: "Templates are imported into **<region>** and are live immediately."

## Selecting files

- **Select JSON files** opens `<input type="file" multiple accept=".json,application/json">`.
- **Add more files** opens the same picker again and adds the new files to the existing list.
- Rows are keyed by file name. Selecting a file with the same name again replaces that file's row.
- `accept` is only a hint to the browser. Any file whose name doesn't end in `.json` (case-insensitive) becomes an incomplete row with the reason "Not a .json file".
- Files are read in the browser with `File.text()`. Their content is never sent to the server except as part of the final create or update calls.

## Validation

The checks below run in this order, and the first failure decides the row's reason. A row that fails any of them is **incomplete**: it is greyed out and sorted to the bottom, its name field is read-only, and it is never imported.

1. **Extension.** The file name must end in `.json`. Failure: "Not a .json file".
2. **Parse.** The content must be valid JSON. Failure: "Not valid JSON: <parser message>".
3. **Wrapper.** The top level must be an object with exactly one key, `Template`, whose value is an object.
   - Failure: "Expected a top-level `Template` object".
   - If the top level is instead an object holding template fields directly, the reason adds "(found template fields at the top level; wrap them in `{ "Template": … }`)".
4. **Fields.** `Template` may only contain `TemplateName`, `SubjectPart`, `HtmlPart` and `TextPart`.
   - Unknown keys fail with "Unexpected field: X, Y" (this catches typos such as `HTMLPart`).
   - All four fields must be non-empty strings, where whitespace-only counts as empty. Failure: "Missing or empty: SubjectPart, TextPart".
5. **Size.** The UTF-8 byte length of all four fields combined must be below 500 KB, the SES template limit. Failure: "Too large (<n> KB; SES limit is 500 KB)".

Name checks run after these. They are re-evaluated live whenever any name in the table changes, and they apply only to rows that passed the checks above:

- **Valid name**: must match `^[A-Za-z0-9_-]{1,64}$`. Otherwise the row is flagged ⚠️ "Invalid name: letters, numbers, _ and - only, max 64 characters".
- **Unique in the batch**: if two or more rows share a name, every one of them is flagged ⚠️ "Duplicate name in this import".

The name-check failures don't make a row incomplete, because the user can fix them by renaming. They do disable the Import button until they're resolved.

## Overview

```
Import templates into  [ eu-west-1 ]  ← templates go live in this region
[Select JSON files]  [Add more files]                       9 files selected

 File                          Template name                     Subject                         Status
 password-reset.json           [acme-prod-password-reset      ]  Reset your password             🟠 Exists – will ask   Preview  ✕
 email-verification.json       [acme-prod-email-verification  ]  Verify your email address       ✅ New                 Preview  ✕
 broken.json                    acme-prod-broken                 —                               ⚠️ Missing or empty:            ✕
                                                                                                    SubjectPart, TextPart
 7 ready · 1 needs a decision (already exists) · 1 won't be imported          [Import 8 templates]
```

**Columns**
- **File**: the file name.
- **Template name**: a text input prefilled from `TemplateName`.
- **Subject**: shown as text.
- **Status**: a badge with its reason.
- **Preview**: available on complete rows only.
- **✕**: removes the row.

**Statuses before import**
- ✅ **New**: the name doesn't exist in the region.
- 🟠 **Exists – will ask**: the name exists in the region.
- ⚠️ **Invalid name** or ⚠️ **Duplicate name in this import**.
- ⚠️ **Incomplete**, with its reason.

The names that already exist come from one `GET /list-templates` call when the page loads, held as a set. A rename compares against that set; it does not re-query SES.

**Preview** opens a modal containing a sandboxed iframe, using the same `setTemplatePreview` helper and `sandbox="allow-same-origin"` iframe as the editor. The template's scripts never run.

**Summary line**: "<x> ready · <y> need a decision (already exist) · <z> won't be imported".

**Import N templates button**
- N counts the complete rows, whether New or Exists.
- The button is disabled when N is 0 or when any complete row has an invalid or duplicate name.

## Import

- Rows are processed in table order, one at a time.
- While the import runs, all inputs and buttons are disabled.
- The table can't be edited after the import, so the page offers **Back to templates** (to `/`) and **Import more** (reloads the page) instead.

For each complete row:

1. **The name is new.** Call `POST /create-template` → **Created**.
   - If the response is `AlreadyExistsException` (the template appeared since the page loaded), treat the row as a conflict and continue with step 2.
2. **The name exists.** Show a Bootstrap modal, not a native `confirm()`:
   - Text: "**<name>** already exists in <region>. Replace it with <file>?"
   - Buttons: **Replace** and **Skip**, with a checkbox "Apply to all remaining conflicts".
   - Replace calls `PUT /update-template` → **Replaced**. Skip → **Skipped**.
   - When "apply to all" is checked, the choice is remembered and the dialog is not shown again for the rest of this import.
3. **Any other error** → **Failed: <SES message>**. The import continues with the next row.

When the import finishes, the Status column shows each outcome, and the summary line becomes "<a> created · <b> replaced · <c> skipped · <d> failed".

Nothing is ever deleted. The incomplete rows remain visible with their reasons.

## Code layout

- **`public/import-validation.js`** holds the pure functions:
  - `validateTemplateFile(fileName, text) → { ok, template?, reason? }`
  - `rowStatuses(rows, existingNames) → per-row status` and `summarize(statuses)`
  - The file is wrapped so it can be loaded both by the browser (as a global) and by Node tests (`module.exports`). It has no DOM access.
- **`public/import-templates.js`**: page state, rendering, the conflict modal and the import loop. It reuses `escapeHtml`, `regionQuery` and `setTemplatePreview` from `global.js`.
- **`views/import-templates.html`**: the page, built from the existing `header` partial and the same CDN tags as the other pages.
- **`src/app.js`**: adds `GET /import-templates`.
- **`views/index.html`**: adds the Import button.

All of this follows the existing invariants: no inline handlers (CSP), `escapeHtml` or `.text()` for every value from a file, and template HTML only ever rendered in the sandboxed iframe.

## Testing

- **`test/import-validation.test.js`**, using `node:test`:
  - one case for each rule in the Validation section, including the unwrapped-template hint, unknown-field typos, whitespace-only fields and the size limit measured in bytes rather than characters;
  - name rules, including the 64-character boundary;
  - duplicates across rows;
  - the New/Exists split.
  - When `IMPORT_SAMPLE_DIR` is set (for example to the `ses/` folder of a local template bundle), it also runs every `.json` file in that directory through validation and expects all of them to be complete. The test is skipped when the variable is unset, because the bundle isn't committed.
- **`test/api.test.js`**: adds a case for the replace path, where creating an existing name returns `AlreadyExistsException` and a following update succeeds.
- **Browser check** in Chrome against `npm run dev:mock`, using a scratch copy of the nine JSON files plus deliberately broken ones: invalid JSON, a missing wrapper, a missing field, a typo'd field and a non-`.json` file. Seed the fake SES so one name already exists. Then:
  - check the overview statuses;
  - rename a row to clear a conflict;
  - create a duplicate name and check it blocks Import;
  - check the Replace/Skip dialog, including "apply to all";
  - check the final outcomes.

## Out of scope

- Picking a folder, reading the `html/` and `text/` files, or reading zip files.
- A separate dry-run mode, deleting templates, and importing into several regions in one run.
- Any server-side bulk endpoint.
