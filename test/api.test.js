'use strict'

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeSes } = require('./support/fake-ses');
const { startServer } = require('./support/server');
const { getDynamicFields } = require('../src/templates');

let fake, app;

const welcome = {
  TemplateName: 'welcome',
  SubjectPart: 'Hi {{ name }}',
  TextPart: 'Hello {{name}} from {{ company.name }}',
  HtmlPart: '<p>Hello {{name}}</p><p>{{ unsubscribe_url }}</p>'
};

before(async () => { app = await startServer(); });
after(async () => { await app.close(); });
beforeEach(() => {
  fake?.mock.restore();
  fake = installFakeSes({ 'us-east-1': [welcome], 'eu-west-1': [] });
});

test('list-templates returns the TemplatesMetadata shape the table expects', async () => {
  const res = await app.request('/list-templates?region=us-east-1');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    items: { TemplatesMetadata: [{ Name: 'welcome', CreatedTimestamp: '2024-01-02T03:04:05.000Z' }] }
  });
});

test('list-templates is scoped to the requested region', async () => {
  const body = await (await app.request('/list-templates?region=eu-west-1')).json();
  assert.deepEqual(body.items.TemplatesMetadata, []);
});

test('get-template returns the template plus deduplicated dynamic fields', async () => {
  const res = await app.request('/get-template/welcome?region=us-east-1');
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.TemplateName, 'welcome');
  assert.equal(data.HtmlPart, welcome.HtmlPart);
  assert.deepEqual(data.dynamicFields, ['name', 'company.name', 'unsubscribe_url']);
});

test('get-template for a missing template returns 500 with code and message', async () => {
  const res = await app.request('/get-template/nope?region=us-east-1');
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), {
    code: 'TemplateDoesNotExistException',
    message: 'Template nope does not exist.'
  });
});

test('create-template stores the template and rejects duplicates', async () => {
  const form = { TemplateName: 'new', SubjectPart: 's', TextPart: 't', HtmlPart: '<b>h</b>', region: 'us-east-1' };
  const res = await app.request('/create-template', { method: 'POST', form });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'Created');
  assert.deepEqual(fake.regions.get('us-east-1').get('new').template,
    { TemplateName: 'new', SubjectPart: 's', TextPart: 't', HtmlPart: '<b>h</b>' });

  const dupe = await app.request('/create-template', { method: 'POST', form });
  assert.equal(dupe.status, 500);
  assert.equal((await dupe.json()).code, 'AlreadyExistsException');
});

test('create-template accepts HTML bodies up to the SES 500KB limit', async () => {
  const HtmlPart = `<p>${'x'.repeat(500 * 1024)}</p>`;
  const res = await app.request('/create-template', {
    method: 'POST',
    form: { TemplateName: 'big', SubjectPart: 's', TextPart: '', HtmlPart, region: 'us-east-1' }
  });
  assert.equal(res.status, 200);
  assert.equal(fake.regions.get('us-east-1').get('big').template.HtmlPart.length, HtmlPart.length);
});

test('update-template replaces the stored template', async () => {
  const res = await app.request('/update-template', {
    method: 'PUT',
    form: { TemplateName: 'welcome', SubjectPart: 'new subject', TextPart: 'x', HtmlPart: '<i>y</i>', region: 'us-east-1' }
  });
  assert.equal(res.status, 200);
  assert.equal(fake.regions.get('us-east-1').get('welcome').template.SubjectPart, 'new subject');
});

test('delete-template removes the template', async () => {
  const res = await app.request('/delete-template/welcome?region=us-east-1', { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(fake.regions.get('us-east-1').has('welcome'), false);
});

test('send-template sends with the given addresses and template data', async () => {
  const templateData = JSON.stringify({ name: 'Ada' });
  const res = await app.request('/send-template', {
    method: 'POST',
    form: { templateName: 'welcome', source: 'from@example.com', toAddress: 'to@example.com', templateData, region: 'us-east-1' }
  });
  assert.equal(res.status, 200);
  assert.deepEqual(fake.sent, [{
    region: 'us-east-1',
    Destination: { ToAddresses: ['to@example.com'] },
    Source: 'from@example.com',
    Template: 'welcome',
    TemplateData: templateData
  }]);
});

test('invalid or missing regions are rejected before reaching SES', async () => {
  for (const path of ['/list-templates', '/list-templates?region=evil.example%23', '/list-templates?region=us-east-1&region=eu-west-1']) {
    const res = await app.request(path);
    assert.equal(res.status, 400, path);
    assert.equal((await res.json()).code, 'InvalidRegion');
  }
  const res = await app.request('/create-template', { method: 'POST', form: { TemplateName: 'x', region: 'nope' } });
  assert.equal(res.status, 400);
  assert.equal(fake.mock.calls().length, 0);
});

test('pages render with all view placeholders resolved', async () => {
  for (const [path, marker] of [['/', 'id="templateListTable"'], ['/create-template', 'id="createTemplateForm"'], ['/update-template', 'id="updateTemplateForm"']]) {
    const res = await app.request(path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.ok(html.includes(marker), `${path} contains ${marker}`);
    assert.ok(!html.includes('{{'), `${path} has no unresolved placeholders`);
    assert.ok(!/\son[a-z]+=/i.test(html), `${path} has no inline event handlers (blocked by CSP)`);
  }
});

test('the create form leaves the name editable and the update form disables it', async () => {
  const create = await (await app.request('/create-template')).text();
  const update = await (await app.request('/update-template')).text();
  assert.match(create, /id="templateName" placeholder="Template Name" >/);
  assert.match(update, /id="templateName" placeholder="Template Name" disabled>/);
});

test('CodeMirror is served from the npm package', async () => {
  const res = await app.request('/plugins/codemirror/mode/htmlmixed/htmlmixed.js');
  assert.equal(res.status, 200);
});

test('getDynamicFields extracts mustache tags', () => {
  assert.deepEqual(getDynamicFields('{{a}} {{ b.c }} {{ d-e }} {{}}'), ['a', 'b.c']);
  assert.deepEqual(getDynamicFields(undefined), []);
});
