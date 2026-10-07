'use strict'

// In-memory stand-in for SES, so the app can be exercised without touching a real AWS account
const { mockClient } = require('aws-sdk-client-mock');
const {
  SESClient,
  ListTemplatesCommand,
  GetTemplateCommand,
  CreateTemplateCommand,
  UpdateTemplateCommand,
  DeleteTemplateCommand,
  SendTemplatedEmailCommand,
  AlreadyExistsException,
  TemplateDoesNotExistException
} = require('@aws-sdk/client-ses');

const metadata = { $metadata: { httpStatusCode: 400 } };

function installFakeSes(seed = {}) {
  const regions = new Map();  // region -> Map(name -> { template, createdAt })
  const sent = [];
  const mock = mockClient(SESClient);

  const storeFor = async (getClient) => {
    const region = await getClient().config.region();
    if (!regions.has(region)) regions.set(region, new Map());
    return regions.get(region);
  };

  const existing = (store, name) => {
    if (!store.has(name)) {
      throw new TemplateDoesNotExistException({ message: `Template ${name} does not exist.`, ...metadata });
    }
    return store.get(name);
  };

  mock.on(ListTemplatesCommand).callsFake(async (input, getClient) => {
    const store = await storeFor(getClient);
    return {
      $metadata: { httpStatusCode: 200 },
      TemplatesMetadata: [...store.entries()].map(([Name, { createdAt }]) => ({ Name, CreatedTimestamp: createdAt }))
    };
  });

  mock.on(GetTemplateCommand).callsFake(async (input, getClient) => {
    const { template } = existing(await storeFor(getClient), input.TemplateName);
    return { $metadata: { httpStatusCode: 200 }, Template: { ...template } };
  });

  mock.on(CreateTemplateCommand).callsFake(async (input, getClient) => {
    const store = await storeFor(getClient);
    if (store.has(input.Template.TemplateName)) {
      throw new AlreadyExistsException({ message: `Template ${input.Template.TemplateName} already exists.`, Name: input.Template.TemplateName, ...metadata });
    }
    store.set(input.Template.TemplateName, { template: { ...input.Template }, createdAt: new Date() });
    return {};
  });

  mock.on(UpdateTemplateCommand).callsFake(async (input, getClient) => {
    existing(await storeFor(getClient), input.Template.TemplateName).template = { ...input.Template };
    return {};
  });

  mock.on(DeleteTemplateCommand).callsFake(async (input, getClient) => {
    const store = await storeFor(getClient);
    existing(store, input.TemplateName);
    store.delete(input.TemplateName);
    return {};
  });

  mock.on(SendTemplatedEmailCommand).callsFake(async (input, getClient) => {
    existing(await storeFor(getClient), input.Template);
    sent.push({ region: await getClient().config.region(), ...input });
    return { MessageId: `fake-${sent.length}` };
  });

  for (const [region, templates] of Object.entries(seed)) {
    regions.set(region, new Map(templates.map(t => [t.TemplateName, { template: t, createdAt: new Date('2024-01-02T03:04:05Z') }])));
  }

  return { mock, regions, sent };
}

module.exports = { installFakeSes };
