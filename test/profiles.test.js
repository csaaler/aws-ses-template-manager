'use strict'

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeSes } = require('./support/fake-ses');
const { startServer } = require('./support/server');
const { listProfiles } = require('../src/profiles');

const ENV_KEYS = ['AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_PROFILE_NAME'];
let savedEnv, awsDir, fake, app;

before(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  awsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ses-profiles-test-'));
  fs.writeFileSync(path.join(awsDir, 'config'), [
    '[default]', 'region = us-east-1',
    '[profile staging]', 'sso_session = corp',
    '[ profile  spaced ]',
    '[sso-session corp]', 'sso_region = us-east-1',
    '[services local]',
    '  [profile indented]'
  ].join('\n'));
  fs.writeFileSync(path.join(awsDir, 'credentials'), '[staging]\naws_access_key_id = x\n[legacy]\n');
  process.env.AWS_CONFIG_FILE = path.join(awsDir, 'config');
  process.env.AWS_SHARED_CREDENTIALS_FILE = path.join(awsDir, 'credentials');
  process.env.AWS_PROFILE_NAME = 'from-env';
  app = await startServer();
});

after(async () => {
  await app.close();
  fs.rmSync(awsDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

beforeEach(() => {
  fake?.mock.restore();
  fake = installFakeSes({ 'us-east-1': [] });
});

const usedProfile = async () => fake.mock.calls().at(-1).thisValue.config.profile;

test('profiles come from both files, deduplicated and sorted, skipping non-profile sections', () => {
  assert.deepEqual(listProfiles(), ['default', 'indented', 'legacy', 'spaced', 'staging']);
});

test('missing AWS files yield no profiles', () => {
  const saved = process.env.AWS_CONFIG_FILE;
  process.env.AWS_CONFIG_FILE = path.join(awsDir, 'nope');
  process.env.AWS_SHARED_CREDENTIALS_FILE = path.join(awsDir, 'nope');
  try {
    assert.deepEqual(listProfiles(), []);
  } finally {
    process.env.AWS_CONFIG_FILE = saved;
    process.env.AWS_SHARED_CREDENTIALS_FILE = path.join(awsDir, 'credentials');
  }
});

test('GET /profiles lists the profiles and the .env default', async () => {
  const res = await app.request('/profiles');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    profiles: ['default', 'indented', 'legacy', 'spaced', 'staging'],
    defaultProfile: 'from-env'
  });
});

test('requests use the profile they name, or the .env default when none is given', async () => {
  assert.equal((await app.request('/list-templates?region=us-east-1&profile=staging')).status, 200);
  assert.equal(await usedProfile(), 'staging');

  assert.equal((await app.request('/list-templates?region=us-east-1')).status, 200);
  assert.equal(await usedProfile(), 'from-env');

  const form = { TemplateName: 'x', SubjectPart: 's', TextPart: 't', HtmlPart: 'h', region: 'us-east-1', profile: 'legacy' };
  assert.equal((await app.request('/create-template', { method: 'POST', form })).status, 200);
  assert.equal(await usedProfile(), 'legacy');
});

test('unknown or repeated profiles are rejected before reaching SES', async () => {
  for (const query of ['profile=nope', 'profile=corp', 'profile=staging&profile=legacy']) {
    const res = await app.request(`/list-templates?region=us-east-1&${query}`);
    assert.equal(res.status, 400, query);
    assert.equal((await res.json()).code, 'InvalidProfile');
  }
  const res = await app.request('/delete-template/x?region=us-east-1&profile=nope', { method: 'DELETE' });
  assert.equal(res.status, 400);
  assert.equal(fake.mock.calls().length, 0);
});

test('profiles added while the app runs are picked up without a restart', async () => {
  fs.appendFileSync(path.join(awsDir, 'credentials'), '[added-later]\n');
  assert.equal((await app.request('/list-templates?region=us-east-1&profile=added-later')).status, 200);
  assert.equal(await usedProfile(), 'added-later');
});
