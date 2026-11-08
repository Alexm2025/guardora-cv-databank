'use strict';

/*
 * Re-reads every stored CV with the current CV reader and rebuilds profiles and the search index.
 * Guardora also does this by itself at start-up after an update that improves the reader.
 * Keeps website-form contact details and hand corrections. Run with Guardora stopped:
 *   node tools/reparse-all.js            (uses DATA_DIR from .env, default "data")
 */

process.env.DISABLE_SOURCES = '1';
const { reparseAll } = require('../server/maintenance');
console.log('Re-read ' + reparseAll() + ' CVs.');
