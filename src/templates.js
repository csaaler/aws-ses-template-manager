'use strict'

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  ListTemplatesCommand,
  GetTemplateCommand,
  CreateTemplateCommand,
  UpdateTemplateCommand,
  DeleteTemplateCommand,
  SendTemplatedEmailCommand
} = require('@aws-sdk/client-ses');
const { getSesClient } = require('./ses');
const { isValidRegion } = require('./security');
const { listProfiles, defaultProfile, isKnownProfile } = require('./profiles');

function getDynamicFields(contentStr) {
  // a helper function which will convert a string into an array of any mustache dynamic fields
  let dynamicFieldsArr = [];
  if (contentStr) {
    const matchRegex = contentStr.match(/{{\s*[\w\.]+\s*}}/g);  // match on any mustache templates
    if (matchRegex) {
      dynamicFieldsArr = matchRegex.map(function (x) { return x.match(/[\w\.]+/)[0]; });
    }
  }

  return dynamicFieldsArr;
}

// Resolves the SES client for the region and profile sent by the client (query string for GET/DELETE, body otherwise).
// A missing or empty profile means the default profile from .env.
function sesFor(req, res) {
  const params = (req.method === 'GET' || req.method === 'DELETE' ? req.query : req.body) || {};
  const { region } = params;
  const profile = params.profile || defaultProfile();
  if (!isValidRegion(region)) {
    res.status(400).json({ code: 'InvalidRegion', message: `Invalid AWS region '${region}'` });
    return null;
  }
  if (!isKnownProfile(profile)) {
    res.status(400).json({ code: 'InvalidProfile', message: `Unknown AWS profile '${profile}'` });
    return null;
  }
  return getSesClient(region, profile);
}

function templateFromBody(body) {
  return {
    TemplateName: body.TemplateName,
    HtmlPart: body.HtmlPart,
    SubjectPart: body.SubjectPart,
    TextPart: body.TextPart
  };
}

const router = express.Router();

router.get('/profiles', (req, res) => {
  res.json({ profiles: listProfiles(), defaultProfile: defaultProfile() });
});

router.get('/list-templates', async (req, res) => {
  const ses = sesFor(req, res);
  if (!ses) return;

  const { $metadata, ...data } = await ses.send(new ListTemplatesCommand({
    MaxItems: Number(req.query.MaxItems) || 5000
  }));
  res.json({ items: data });
});

router.get('/get-template/:TemplateName', async (req, res) => {
  const ses = sesFor(req, res);
  if (!ses) return;

  const { Template } = await ses.send(new GetTemplateCommand({ TemplateName: req.params.TemplateName }));
  const { SubjectPart, TextPart, HtmlPart } = Template;
  const dynamicFields = Array.from(new Set([
    ...getDynamicFields(SubjectPart),
    ...getDynamicFields(TextPart),
    ...getDynamicFields(HtmlPart)
  ]));
  res.json({ data: { ...Template, dynamicFields } });
});

router.post('/create-template', async (req, res) => {
  const ses = sesFor(req, res);
  if (!ses) return;

  await ses.send(new CreateTemplateCommand({ Template: templateFromBody(req.body) }));
  res.status(200).send('Created');
});

router.put('/update-template', async (req, res) => {
  const ses = sesFor(req, res);
  if (!ses) return;

  await ses.send(new UpdateTemplateCommand({ Template: templateFromBody(req.body) }));
  res.sendStatus(200);
});

router.delete('/delete-template/:TemplateName', async (req, res) => {
  const ses = sesFor(req, res);
  if (!ses) return;

  await ses.send(new DeleteTemplateCommand({ TemplateName: req.params.TemplateName }));
  res.sendStatus(200);
});

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { code: 'TooManyRequests', message: 'Too many test emails sent, please wait a minute.' }
});

router.post('/send-template', sendLimiter, async (req, res) => {
  const ses = sesFor(req, res);
  if (!ses) return;

  await ses.send(new SendTemplatedEmailCommand({
    Destination: { ToAddresses: [req.body.toAddress] },
    Source: req.body.source,
    Template: req.body.templateName,
    TemplateData: req.body.templateData
  }));
  res.sendStatus(200);
});

module.exports = { router, getDynamicFields };
