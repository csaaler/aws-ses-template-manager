# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local GUI for managing AWS SES email templates (list, create, update, delete, duplicate, send test emails) across regions. An Express 5 server talks to SES using AWS SDK v3. The frontend is static HTML with jQuery, Bootstrap 4 and CodeMirror 5.

## Commands

- `npm start`: runs the app at http://127.0.0.1:3333. `npm run dev` does the same and restarts on file changes.
- `npm run dev:mock`: runs the app against an in-memory fake SES (`test/support/fake-ses.js`), so no AWS calls are made. Use it for any manual or browser testing. It points `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` at fake profiles and seeds a "hostile" template with XSS payloads; a successful exploit sets `window.__pwned`.
- `npm test`: runs all tests (`node --test test/*.test.js`). For a single file: `node --test test/api.test.js`. For a single test: add `--test-name-pattern="<regex>"`.

Configuration lives in `.env`, which is loaded with `process.loadEnvFile`. It sets `HOST`, `PORT`, `AWS_PROFILE_NAME` (the default profile, which can be switched in the UI) and `ALLOWED_HOSTS`. Running with `npm start` talks to the real AWS SES with the selected profile, and sends and deletes are live.

## Architecture

**Server (`src/`).** `server.js` reads the env and calls `createApp()` from `src/app.js`. The middleware order matters:
1. Host allowlist, to stop DNS rebinding.
2. Security headers, including a strict CSP.
3. Static files.
4. Page routes.
5. `sameOriginOnly`, which rejects cross-site requests (CSRF).
6. Body parsers (1mb limit, because SES templates can be up to 500KB).
7. The API router in `src/templates.js`.

The API URLs match what the frontend calls (`/list-templates`, `/get-template/:name`, etc.). Errors come back as `{code, message}`, which the frontend reads.

**Region and profile are per request, chosen by the client.** The client keeps them in `localStorage.region` and `localStorage.profile`. `global.js` reads both once per page load into `awsContext`, so a tab keeps acting on the account its header shows even if another tab switches. If that happens, a banner tells the user to reload. Every API call sends both as query params (GET/DELETE, via `contextQuery()`/`templateUrl`) or body fields (POST/PUT, via `...awsContext`). `sesFor()` validates them and returns a cached `SESClient` per profile and region (`src/ses.js`). An empty profile means `AWS_PROFILE_NAME`. Profiles are listed from `~/.aws/config` and `~/.aws/credentials` by `src/profiles.js` (served at `/profiles`), and only listed profiles or the `.env` default are accepted. The header (`views/partials/header.html`) shows the profile dropdown and region on every page, and switching asks for confirmation in a modal.

**Views.** `views/*.html` are rendered once and cached by `src/views.js`, which supports `{{> partial}}` includes and `{{ var }}` substitution. The only per-page variables are the template form settings in `TEMPLATE_FORMS`. CodeMirror is served from `node_modules/codemirror` at `/plugins/codemirror`.

**Client (`public/`).** Each page loads `global.js` plus its own script:
- `global.js` holds the shared helpers: `escapeHtml`, `templateUrl`, `setTemplatePreview` and `populateTextSectionContent`. It also runs a GitHub version check against the hardcoded `currentVersion`.
- `index.js` handles the table, region selector, and the delete, duplicate and send-test modals. Duplicating goes through `/create-template?d-origin=&d-name=`.
- `create-template.js` and `update-template.js` handle the shared form in `views/partials/template-form.html`.
- `import-templates.js` drives the import page (`/import-templates`). It reads user-selected JSON files in the browser and creates or updates them one at a time through the existing endpoints, asking Replace/Skip on conflicts. Its validation lives in `import-validation.js`, which has no DOM access and is loaded both by the page (`window.ImportValidation`) and by `test/import-validation.test.js`.

Keep these invariants:
- The CSP forbids inline scripts and handlers, so bind events in JS, never with `onclick=` attributes. A test enforces this.
- Template names and fields reaching the DOM must go through `escapeHtml` or `.text()`.
- URLs must use `encodeURIComponent` or `templateUrl`.
- Template HTML is only ever rendered in the `sandbox="allow-same-origin"` preview iframe, without `allow-scripts`, or parsed with `DOMParser`.

**CodeMirror quirks.** The editor instance lives on `window.codeMirrorEditor`. Its edits don't reliably fire DOM `input` events on the form, so the page scripts also listen for the editor's own `change` event and ignore events whose target is `codeMirrorEditor.getInputField()`.

**Tests.** `aws-sdk-client-mock` patches `SESClient` globally, so `installFakeSes()` must run before requests are made, and `mock.restore()` must run between tests. The `send-template` rate limiter (30/min) is a module-level singleton shared within a test file.
