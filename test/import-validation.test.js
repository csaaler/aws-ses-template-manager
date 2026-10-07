'use strict'

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateTemplateFile,
  isValidTemplateName,
  rowStatuses,
  summarize,
  MAX_TEMPLATE_BYTES
} = require('../public/import-validation');

const template = (overrides = {}) => ({
  TemplateName: 'acme-prod-password-reset',
  SubjectPart: 'Reset your password',
  HtmlPart: '<p>Hi {{name}}</p>',
  TextPart: 'Hi {{name}}',
  ...overrides
});
const file = (value) => JSON.stringify(value);

test('a complete template in the create-template shape is valid', () => {
  assert.deepEqual(validateTemplateFile('password-reset.json', file({ Template: template() })), {
    ok: true,
    template: template()
  });
});

test('the .json extension is checked case-insensitively', () => {
  assert.equal(validateTemplateFile('PASSWORD-RESET.JSON', file({ Template: template() })).ok, true);
  assert.deepEqual(validateTemplateFile('password-reset.html', '<p>hi</p>'), {
    ok: false,
    reason: 'Not a .json file'
  });
});

test('invalid JSON is reported with the parser message', () => {
  const result = validateTemplateFile('broken.json', '{ "Template": ');
  assert.equal(result.ok, false);
  assert.match(result.reason, /^Not valid JSON: .+/);
});

test('the top level must be an object holding only a Template object', () => {
  for (const value of [[], null, 'text', 42, {}, { Template: 'x' }, { Template: [] }, { Template: template(), Extra: 1 }]) {
    const result = validateTemplateFile('t.json', file(value));
    assert.equal(result.ok, false, JSON.stringify(value));
    assert.equal(result.reason, 'Expected a top-level `Template` object');
  }
});

test('template fields at the top level get a hint to wrap them', () => {
  const result = validateTemplateFile('t.json', file(template()));
  assert.equal(result.ok, false);
  assert.equal(result.reason,
    'Expected a top-level `Template` object (found template fields at the top level; wrap them in `{ "Template": … }`)');
  assert.equal(result.name, 'acme-prod-password-reset');
});

test('unknown fields inside Template are rejected', () => {
  const { TextPart, ...rest } = template();
  const result = validateTemplateFile('t.json', file({ Template: { ...rest, TEXTPart: TextPart, Foo: 1 } }));
  assert.deepEqual(result, {
    ok: false,
    reason: 'Unexpected field: TEXTPart, Foo',
    name: 'acme-prod-password-reset',
    subject: 'Reset your password'
  });
});

test('missing, empty, whitespace-only and non-string fields are listed in canonical order', () => {
  const { SubjectPart, ...noSubject } = template();
  const result = validateTemplateFile('t.json', file({ Template: { ...noSubject, TextPart: '  \n ', HtmlPart: 5 } }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'Missing or empty: SubjectPart, HtmlPart, TextPart');
  assert.equal(result.name, 'acme-prod-password-reset');
});

test('templates at or above the SES size limit are rejected, measured in UTF-8 bytes', () => {
  const fixed = Buffer.byteLength(template().TemplateName + template().SubjectPart + template().TextPart);
  const justUnder = 'x'.repeat(MAX_TEMPLATE_BYTES - fixed - 1);
  assert.equal(validateTemplateFile('t.json', file({ Template: template({ HtmlPart: justUnder }) })).ok, true);

  // 'é' is 2 bytes in UTF-8, so this is under the limit in characters but over it in bytes
  const multiByte = 'é'.repeat(Math.ceil((MAX_TEMPLATE_BYTES - fixed) / 2));
  const result = validateTemplateFile('t.json', file({ Template: template({ HtmlPart: multiByte }) }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /^Too large \(\d+ KB; SES limit is 500 KB\)$/);
});

test('template names follow the SES rules', () => {
  assert.equal(isValidTemplateName('acme-prod_password-reset2'), true);
  assert.equal(isValidTemplateName('a'.repeat(64)), true);
  for (const name of ['', 'a'.repeat(65), 'has space', 'dot.name', 'slash/name', 'ümlaut']) {
    assert.equal(isValidTemplateName(name), false, name);
  }
});

test('row statuses: new, exists, invalid name, duplicate name and incomplete', () => {
  const rows = [
    { ok: true, name: 'brand-new' },
    { ok: true, name: 'already-there' },
    { ok: true, name: 'bad name' },
    { ok: true, name: 'twin' },
    { ok: true, name: 'twin' },
    { ok: false, name: 'twin' },  // incomplete rows never count towards duplicates
    { ok: true, name: 'bad name' }  // an invalid name is reported as invalid, not as a duplicate
  ];
  assert.deepEqual(rowStatuses(rows, new Set(['already-there', 'twin'])), [
    'new', 'exists', 'invalid-name', 'duplicate-name', 'duplicate-name', 'incomplete', 'invalid-name'
  ]);
});

test('summary counts and whether the import can start', () => {
  assert.deepEqual(summarize(['new', 'new', 'exists', 'incomplete']), {
    ready: 2, conflicts: 1, excluded: 1, blocked: 0, importable: 3, canImport: true
  });
  assert.equal(summarize(['new', 'duplicate-name', 'duplicate-name']).canImport, false);
  assert.equal(summarize(['new', 'invalid-name']).canImport, false);
  assert.equal(summarize(['incomplete']).canImport, false);
  assert.equal(summarize([]).canImport, false);
});

const sampleDir = process.env.IMPORT_SAMPLE_DIR;
test('every template in IMPORT_SAMPLE_DIR is complete', { skip: !sampleDir && 'IMPORT_SAMPLE_DIR not set' }, () => {
  const files = fs.readdirSync(sampleDir).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 0, `no .json files in ${sampleDir}`);
  for (const name of files) {
    const result = validateTemplateFile(name, fs.readFileSync(path.join(sampleDir, name), 'utf8'));
    assert.equal(result.ok, true, `${name}: ${result.reason}`);
  }
});
