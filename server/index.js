'use strict';

/* Guardora server: the API, the app, and the background workers that collect CVs around the clock. */

const path = require('node:path');
const express = require('express');
const config = require('./config');
const { get } = require('./db');
const { loadUser, sameOrigin, HttpError } = require('./auth');
const { SETUP_TOKEN } = require('./setup-token');
const mailbox = require('./sources/mailbox');
const website = require('./sources/website');
const backup = require('./backup');
const campaigns = require('./campaigns');
require('./maintenance').upgradeIfNeeded();

const app = express();
app.disable('x-powered-by');
if (config.TRUST_PROXY) app.set('trust proxy', 1);

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests'
].join('; ');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': config.PRODUCTION ? CSP : CSP.replace('; upgrade-insecure-requests', ''),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow'
  });
  if (config.PRODUCTION) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

/* ---------- API ---------- */

const api = express.Router();
api.use(express.json({ limit: '1mb' }));
api.use(sameOrigin);
api.use(loadUser);
api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
const auth = require('./routes/auth');
api.use('/', auth.router);
api.use('/account', auth.me);
api.use('/', require('./routes/candidates'));
api.use('/', require('./routes/insights'));
api.use('/', require('./routes/admin'));
const shares = require('./routes/shares');
api.use('/', shares.router);
api.use('/public', shares.publicRouter);
api.use('/', require('./routes/mail'));
api.use((req, res, next) => next(new HttpError(404, 'Not found.')));
app.use('/api', api);

/* ---------- App files ---------- */

const PDFJS = path.dirname(require.resolve('pdfjs-dist/package.json'));
const longCache = { maxAge: '30d', immutable: true };
app.use('/vendor/pdfjs/build', express.static(path.join(PDFJS, 'build'), longCache));
app.use('/vendor/pdfjs/cmaps', express.static(path.join(PDFJS, 'cmaps'), longCache));
app.use('/vendor/pdfjs/standard_fonts', express.static(path.join(PDFJS, 'standard_fonts'), longCache));
app.use('/vendor/pdfjs/wasm', express.static(path.join(PDFJS, 'wasm'), longCache));
app.use(express.static(config.PUBLIC_DIR, {
  index: false,
  setHeaders: (res, file) => {
    // The app shell and service worker must always be fresh; versioned assets can be cached.
    if (/\b(sw\.js|index\.html|manifest\.webmanifest)$/.test(file)) res.set('Cache-Control', 'no-cache');
    else res.set('Cache-Control', 'public, max-age=3600');
  }
}));
// Shortlist page for client companies (no account; the link itself is the key).
app.get('/s/:token', (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.sendFile(path.join(config.PUBLIC_DIR, 'share.html'));
});
// Single-page app: every other address loads the app, which shows the right screen.
app.get(/^\/(?!api\/|vendor\/).*/, (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(config.PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = 'That file is larger than ' + config.MAX_UPLOAD_MB + ' MB.'; }
  if (err.type === 'entity.parse.failed') { status = 400; message = 'Bad request.'; }
  if (status >= 500) {
    console.error(new Date().toISOString(), req.method, req.originalUrl, err);
    message = 'Something went wrong on the server. Please try again.';
  }
  res.status(status).json({ ok: false, error: message });
});

/* ---------- Start ---------- */

const PID_FILE = path.join(config.DATA_DIR, 'guardora.pid');
const server = app.listen(config.PORT, config.HOST, () => {
  require('node:fs').writeFileSync(PID_FILE, String(process.pid)); // lets "Remove Guardora background.bat" stop exactly this process
  console.log('Guardora is running on http://localhost:' + config.PORT + (config.PRODUCTION ? ' (production)' : ''));
  if (!get('SELECT 1 AS x FROM users LIMIT 1')) {
    console.log('\n  First start: open the address above and create your owner account.');
    console.log('  Setup code: ' + SETUP_TOKEN + '\n');
  }
  if (!config.DISABLE_SOURCES) {
    mailbox.start();
    website.start();
  }
  campaigns.start(); // scheduled emails (not a CV source: always on)
  backup.schedule();
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log('Stopping Guardora…');
  require('node:fs').rmSync(PID_FILE, { force: true });
  server.close();
  website.stop();
  campaigns.stop();
  await Promise.race([mailbox.stop(), new Promise((r) => setTimeout(r, 3000))]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

module.exports = app;
