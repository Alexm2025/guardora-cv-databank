'use strict';

/* One-time code needed to create the owner account on first start, so a stranger who finds the
   address before you do cannot claim it. Printed in the server log; set SETUP_CODE to choose it. */

const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L look-alikes
const random = () => Array.from(crypto.randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('');

const SETUP_TOKEN = (process.env.SETUP_CODE || random()).trim().toUpperCase();

module.exports = { SETUP_TOKEN };
