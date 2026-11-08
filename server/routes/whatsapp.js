'use strict';

/* Linking WhatsApp (owner only) and its options. */

const express = require('express');
const { requireRole, audit } = require('../auth');
const whatsapp = require('../sources/whatsapp');

const router = express.Router();
const owner = requireRole('owner');

router.get('/whatsapp', owner, (req, res) => {
  res.json({ ok: true, status: whatsapp.status, options: whatsapp.options(), linked: whatsapp.isLinked() });
});

router.post('/whatsapp/connect', owner, async (req, res) => {
  await whatsapp.enable();
  audit(req, 'whatsapp.connect');
  res.json({ ok: true, status: whatsapp.status });
});

router.post('/whatsapp/unlink', owner, async (req, res) => {
  await whatsapp.unlink();
  audit(req, 'whatsapp.unlinked');
  res.json({ ok: true });
});

router.put('/whatsapp/options', owner, (req, res) => {
  const b = req.body || {};
  if ('groups' in b) whatsapp.setSetting('whatsapp_groups', b.groups ? '1' : '0');
  if ('history' in b) whatsapp.setSetting('whatsapp_history', b.history ? '1' : '0');
  audit(req, 'whatsapp.options', '', JSON.stringify(whatsapp.options()));
  res.json({ ok: true, options: whatsapp.options() });
});

module.exports = router;
