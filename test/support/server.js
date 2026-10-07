'use strict'

const { createApp } = require('../../src/app');

// Starts the app on an ephemeral port and returns a small fetch helper that behaves like same-origin browser code
async function startServer() {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = (path, { method = 'GET', form, headers = {} } = {}) => fetch(base + path, {
    method,
    headers: {
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...headers
    },
    body: form ? new URLSearchParams(form).toString() : undefined
  });

  return { base, request, close: () => new Promise(resolve => server.close(resolve)) };
}

module.exports = { startServer };
