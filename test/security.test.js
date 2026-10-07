'use strict'

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { installFakeSes } = require('./support/fake-ses');
const { startServer } = require('./support/server');

let fake, app;

before(async () => {
  fake = installFakeSes({ 'us-east-1': [{ TemplateName: 'welcome', SubjectPart: 's', TextPart: '', HtmlPart: '' }] });
  app = await startServer();
});
after(async () => { await app.close(); fake.mock.restore(); });

const sendForm = { templateName: 'welcome', source: 'a@example.com', toAddress: 'b@example.com', templateData: '{}', region: 'us-east-1' };

test('cross-site form posts are rejected (CSRF)', async () => {
  const viaOrigin = await app.request('/send-template', {
    method: 'POST', form: sendForm, headers: { origin: 'https://evil.example' }
  });
  assert.equal(viaOrigin.status, 403);

  const viaFetchMetadata = await app.request('/create-template', {
    method: 'POST', form: { TemplateName: 'x', region: 'us-east-1' }, headers: { 'sec-fetch-site': 'cross-site' }
  });
  assert.equal(viaFetchMetadata.status, 403);

  const sameSite = await app.request('/delete-template/welcome?region=us-east-1', {
    method: 'DELETE', headers: { 'sec-fetch-site': 'same-site', origin: 'http://localhost:3000' }
  });
  assert.equal(sameSite.status, 403);

  assert.equal(fake.mock.calls().length, 0);
});

test('same-origin browser requests are allowed', async () => {
  const res = await app.request('/list-templates?region=us-east-1', {
    headers: { 'sec-fetch-site': 'same-origin', origin: app.base }
  });
  assert.equal(res.status, 200);
});

test('cross-site navigations to pages are still allowed', async () => {
  const res = await app.request('/', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } });
  assert.equal(res.status, 200);
});

// fetch() does not allow overriding Host, so use node:http
function statusWithHost(path, host) {
  return new Promise((resolve, reject) => {
    http.get(app.base + path, { headers: { host } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
}

test('requests for a foreign Host are rejected (DNS rebinding)', async () => {
  for (const path of ['/', '/list-templates?region=us-east-1']) {
    assert.equal(await statusWithHost(path, 'rebind.evil.example:3333'), 403, path);
  }
  for (const host of ['localhost:3333', '127.0.0.1:3333', '[::1]:3333']) {
    assert.equal(await statusWithHost('/', host), 200, host);
  }
});

test('responses carry security headers', async () => {
  const res = await app.request('/');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' https:\/\/code\.jquery\.com https:\/\/cdn\.jsdelivr\.net(;|$)/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('send-template is rate limited to 30 requests per minute', async () => {
  const statuses = [];
  for (let i = 0; i < 31; i++) {
    statuses.push((await app.request('/send-template', { method: 'POST', form: sendForm })).status);
  }
  assert.deepEqual(statuses.slice(0, 30), Array(30).fill(200));
  assert.equal(statuses[30], 429);
  assert.equal(fake.sent.length, 30);
});
