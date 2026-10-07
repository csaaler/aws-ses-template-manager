'use strict'

const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { createApp } = require('./src/app');
const { LOOPBACK_HOSTNAMES } = require('./src/security');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 3333;
const allowedHostnames = [
  host,
  ...(process.env.ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean)
];

if (!LOOPBACK_HOSTNAMES.includes(host)) {
  console.warn(`WARNING: listening on ${host}. Anyone who can reach this address can manage and send SES templates with your AWS credentials.`);
}

createApp({ allowedHostnames }).listen(port, host, () => {
  console.log(`AWS SES Template Manager running at http://${host}:${port} (AWS profile '${process.env.AWS_PROFILE_NAME || 'default'}')`);
});
