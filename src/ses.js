'use strict'

const { SESClient } = require('@aws-sdk/client-ses');

// One client per region, all sharing the named profile from .env
const clients = new Map();

function getSesClient(region) {
  if (!clients.has(region)) {
    clients.set(region, new SESClient({
      region,
      profile: process.env.AWS_PROFILE_NAME || 'default'
    }));
  }
  return clients.get(region);
}

// The frontend reads `code` and `message` from error responses (the shape aws-sdk v2 errors serialized to)
function toErrorPayload(err) {
  return {
    code: err.name || err.code || 'Error',
    message: err.message || 'Unknown error'
  };
}

module.exports = { getSesClient, toErrorPayload };
