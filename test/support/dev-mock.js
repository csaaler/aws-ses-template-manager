'use strict'

// Runs the app against an in-memory fake SES (npm run dev:mock). Nothing reaches AWS.
// The seeded "hostile" template carries XSS payloads that should stay inert in the UI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installFakeSes } = require('./fake-ses');

// Fake AWS config so the profile selector lists made-up profiles instead of the real ones in ~/.aws.
// Set before server.js loads .env, which never overrides variables that are already set.
const awsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ses-dev-mock-'));
fs.writeFileSync(path.join(awsDir, 'config'), '[default]\n[profile staging]\n[profile production]\n[sso-session corp]\n');
fs.writeFileSync(path.join(awsDir, 'credentials'), '[sandbox]\n');
process.env.AWS_CONFIG_FILE = path.join(awsDir, 'config');
process.env.AWS_SHARED_CREDENTIALS_FILE = path.join(awsDir, 'credentials');
process.env.AWS_PROFILE_NAME = 'default';

installFakeSes({
  'us-east-1': [
    {
      TemplateName: 'welcome-email',
      SubjectPart: 'Welcome, {{ name }}!',
      TextPart: 'Hi {{name}}, thanks for joining {{ company.name }}.',
      HtmlPart: '<html><head><style>h1 { color: #2b6cb0; }</style></head><body><h1>Welcome, {{name}}!</h1><p>Thanks for joining {{ company.name }}.</p></body></html>'
    },
    {
      TemplateName: `hostile"><img src=x onerror="window.__pwned='name'">`,
      SubjectPart: 'Hostile',
      TextPart: '',
      HtmlPart: `<h2>Hostile template</h2><img src=x onerror="parent.__pwned='preview-onerror'"><script>parent.__pwned='preview-script'</script>`
    }
  ]
});

console.log('Using in-memory fake SES; no AWS calls will be made.');
require('../../server');
