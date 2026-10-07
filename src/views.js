'use strict'

const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', 'views');

// Per-page values for the shared template form partial
const TEMPLATE_FORMS = {
  'create-template': { id: 'createTemplateForm', ctaText: 'Create', formClass: '', nameAttrs: '' },
  'update-template': { id: 'updateTemplateForm', ctaText: 'Update', formClass: 'd-none', nameAttrs: 'disabled' }
};

const read = (file) => fs.readFileSync(path.join(VIEWS_DIR, file), 'utf8');

// Supports `{{> partial-name}}` includes and `{{ var }}` substitution. Values are internal constants, never user input.
function render(source, vars) {
  return source
    .replace(/{{>\s*([\w-]+)\s*}}/g, (_, name) => render(read(`partials/${name}.html`), vars))
    .replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
      if (!(key in vars)) throw new Error(`Missing view variable '${key}'`);
      return vars[key];
    });
}

const cache = new Map();

function renderPage(name) {
  if (!cache.has(name)) {
    cache.set(name, render(read(`${name}.html`), TEMPLATE_FORMS[name] || {}));
  }
  return cache.get(name);
}

module.exports = { renderPage };
