'use strict'

const path = require('path');
const express = require('express');
const { router: templatesRouter } = require('./templates');
const { renderPage } = require('./views');
const { toErrorPayload } = require('./ses');
const { securityHeaders, allowHosts, sameOriginOnly } = require('./security');

const ROOT = path.join(__dirname, '..');
const CODEMIRROR_DIR = path.dirname(require.resolve('codemirror/package.json'));

function createApp({ allowedHostnames = [] } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(allowHosts(allowedHostnames));
  app.use(securityHeaders);

  app.use('/plugins/codemirror', express.static(CODEMIRROR_DIR));
  app.use(express.static(path.join(ROOT, 'public')));

  app.get('/', (req, res) => res.type('html').send(renderPage('index')));
  app.get('/create-template', (req, res) => res.type('html').send(renderPage('create-template')));
  app.get('/update-template', (req, res) => res.type('html').send(renderPage('update-template')));

  // SES templates are capped at 500KB, so 1mb leaves room for form encoding
  app.use(sameOriginOnly);
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(templatesRouter);

  app.use((req, res) => {
    res.status(404).json({ code: 'NotFound', message: `Cannot ${req.method} ${req.path}` });
  });

  app.use((err, req, res, next) => {
    // body-parser errors carry a 4xx status; anything else is an AWS/runtime error
    if (err.status && err.status < 500) {
      return res.status(err.status).json({ code: err.type || 'BadRequest', message: err.message });
    }
    if (!err.$metadata) console.error(err);
    res.status(500).json(toErrorPayload(err));
  });

  return app;
}

module.exports = { createApp };
