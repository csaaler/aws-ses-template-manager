// Validation for the template import page. Loaded by the browser (as window.ImportValidation)
// and by the Node tests (module.exports), so it must stay free of DOM and jQuery access.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ImportValidation = api;
  }
})(this, function () {
  'use strict';

  // the exact shape `aws ses create-template --cli-input-json` accepts
  const FIELDS = ['TemplateName', 'SubjectPart', 'HtmlPart', 'TextPart'];
  const MAX_TEMPLATE_BYTES = 500 * 1024;
  const TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

  const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
  const stringOrUndefined = (value) => (typeof value === 'string' ? value : undefined);

  // Returns { ok: true, template } or { ok: false, reason, name?, subject? }.
  // name/subject are included when readable, so incomplete rows can still be identified in the overview.
  function validateTemplateFile(fileName, text) {
    if (!/\.json$/i.test(fileName)) {
      return { ok: false, reason: 'Not a .json file' };
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, reason: `Not valid JSON: ${err.message}` };
    }

    const hasWrapper = isPlainObject(parsed)
      && Object.keys(parsed).length === 1
      && isPlainObject(parsed.Template);
    if (!hasWrapper) {
      const fieldsAtTopLevel = isPlainObject(parsed) && FIELDS.some((field) => field in parsed);
      const result = { ok: false, reason: 'Expected a top-level `Template` object' };
      if (fieldsAtTopLevel) {
        result.reason += ' (found template fields at the top level; wrap them in `{ "Template": … }`)';
        result.name = stringOrUndefined(parsed.TemplateName);
        result.subject = stringOrUndefined(parsed.SubjectPart);
      }
      return result;
    }

    const template = parsed.Template;
    const identity = {
      name: stringOrUndefined(template.TemplateName),
      subject: stringOrUndefined(template.SubjectPart)
    };

    const unexpected = Object.keys(template).filter((key) => !FIELDS.includes(key));
    if (unexpected.length > 0) {
      return { ok: false, reason: `Unexpected field: ${unexpected.join(', ')}`, ...identity };
    }

    const missing = FIELDS.filter((field) => typeof template[field] !== 'string' || template[field].trim() === '');
    if (missing.length > 0) {
      return { ok: false, reason: `Missing or empty: ${missing.join(', ')}`, ...identity };
    }

    const bytes = new TextEncoder().encode(FIELDS.map((field) => template[field]).join('')).length;
    if (bytes >= MAX_TEMPLATE_BYTES) {
      return { ok: false, reason: `Too large (${Math.ceil(bytes / 1024)} KB; SES limit is 500 KB)`, ...identity };
    }

    const clean = {};
    FIELDS.forEach((field) => { clean[field] = template[field]; });
    return { ok: true, template: clean };
  }

  function isValidTemplateName(name) {
    return typeof name === 'string' && TEMPLATE_NAME_PATTERN.test(name);
  }

  // rows: [{ ok, name }] in table order; existingNames: Set of names already in the region.
  // Returns one of 'incomplete' | 'invalid-name' | 'duplicate-name' | 'exists' | 'new' per row.
  function rowStatuses(rows, existingNames) {
    const counts = new Map();
    rows.forEach((row) => {
      if (row.ok && isValidTemplateName(row.name)) counts.set(row.name, (counts.get(row.name) || 0) + 1);
    });

    return rows.map((row) => {
      if (!row.ok) return 'incomplete';
      if (!isValidTemplateName(row.name)) return 'invalid-name';
      if (counts.get(row.name) > 1) return 'duplicate-name';
      return existingNames.has(row.name) ? 'exists' : 'new';
    });
  }

  function summarize(statuses) {
    const count = (...wanted) => statuses.filter((status) => wanted.includes(status)).length;
    const summary = {
      ready: count('new'),
      conflicts: count('exists'),
      excluded: count('incomplete'),
      blocked: count('invalid-name', 'duplicate-name')
    };
    summary.importable = statuses.length - summary.excluded;
    summary.canImport = summary.importable > 0 && summary.blocked === 0;
    return summary;
  }

  return { validateTemplateFile, isValidTemplateName, rowStatuses, summarize, FIELDS, MAX_TEMPLATE_BYTES };
});
