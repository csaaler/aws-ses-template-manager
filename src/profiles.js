'use strict'

const fs = require('fs');
const os = require('os');
const path = require('path');

// Same locations and overrides the AWS SDK and CLI use
const configFile = () => process.env.AWS_CONFIG_FILE || path.join(os.homedir(), '.aws', 'config');
const credentialsFile = () => process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), '.aws', 'credentials');

function sectionNames(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return [...text.matchAll(/^\s*\[\s*([^\]]+?)\s*\]/gm)].map(m => m[1]);
}

// Profile names, as in `aws configure list-profiles`. The config file names them `[default]` or `[profile x]`
// and also holds non-profile sections such as `[sso-session x]`; the credentials file names them `[x]`.
// Read on every call so profiles added while the app runs show up without a restart.
function listProfiles() {
  const fromConfig = sectionNames(configFile())
    .map(name => name === 'default' ? name : name.match(/^profile\s+(\S+)$/)?.[1])
    .filter(Boolean);
  const fromCredentials = sectionNames(credentialsFile());
  return [...new Set([...fromConfig, ...fromCredentials])].sort();
}

function defaultProfile() {
  return process.env.AWS_PROFILE_NAME || 'default';
}

// The .env profile is always accepted, even when it only exists through environment credentials
function isKnownProfile(profile) {
  return typeof profile === 'string' && (profile === defaultProfile() || listProfiles().includes(profile));
}

module.exports = { listProfiles, defaultProfile, isKnownProfile };
