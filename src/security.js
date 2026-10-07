'use strict'

const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://code.jquery.com https://cdn.jsdelivr.net",
  // email templates rendered in the preview iframe inherit this policy, so their styles, fonts and images must load
  "style-src 'self' 'unsafe-inline' https:",
  "font-src https: data:",
  "img-src * data: blob:",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin'
  });
  next();
}

function forbidden(res, message) {
  res.status(403).json({ code: 'Forbidden', message });
}

function hostnameOf(hostHeader) {
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

// Rejects requests addressed to an unexpected Host, which defeats DNS rebinding attacks
function allowHosts(extraHostnames = []) {
  const allowed = new Set([...LOOPBACK_HOSTNAMES, ...extraHostnames].map(h => h.toLowerCase()));
  return (req, res, next) => {
    const hostname = hostnameOf(req.headers.host || '');
    if (!hostname || !allowed.has(hostname.toLowerCase())) {
      return forbidden(res, `Host '${req.headers.host}' is not allowed. Add it to ALLOWED_HOSTS in .env if this is intended.`);
    }
    next();
  };
}

// Rejects API calls initiated by other websites (CSRF). Requests without browser
// provenance headers (e.g. curl) are allowed, as they cannot carry a victim's session.
function sameOriginOnly(req, res, next) {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return forbidden(res, 'Cross-site requests are not allowed.');
  }
  const origin = req.headers.origin;
  if (origin && origin !== `${req.protocol}://${req.headers.host}`) {
    return forbidden(res, 'Cross-origin requests are not allowed.');
  }
  next();
}

const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;

function isValidRegion(region) {
  return typeof region === 'string' && REGION_PATTERN.test(region);
}

module.exports = { securityHeaders, allowHosts, sameOriginOnly, isValidRegion, LOOPBACK_HOSTNAMES };
