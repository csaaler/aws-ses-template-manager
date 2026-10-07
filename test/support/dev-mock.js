'use strict'

// Runs the app against an in-memory fake SES (npm run dev:mock). Nothing reaches AWS.
// The seeded "hostile" template carries XSS payloads that should stay inert in the UI.
const { installFakeSes } = require('./fake-ses');

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
