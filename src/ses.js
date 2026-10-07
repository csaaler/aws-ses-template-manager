'use strict'

const { SESClient } = require('@aws-sdk/client-ses');

// One client per profile and region
const clients = new Map();

function getSesClient(region, profile) {
  const key = `${profile}\n${region}`;
  if (!clients.has(key)) {
    clients.set(key, new SESClient({ region, profile }));
  }
  return clients.get(key);
}

// The frontend reads `code` and `message` from error responses (the shape aws-sdk v2 errors serialized to)
function toErrorPayload(err) {
  return {
    code: err.name || err.code || 'Error',
    message: err.message || 'Unknown error'
  };
}

module.exports = { getSesClient, toErrorPayload };
