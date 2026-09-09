
const samples = require('../samples/static_samples.json');
const {
  parseWebhookSecret,
  verifyWebhookDelivery,
} = require('../webhook_security');
const { formatEvent } = require('../event_formatter');
const {
  toApiEventType,
  toPublicEventType,
} = require('../event_names');
const { buildEfimisApiUrl } = require('../efimis_url');

const perform = async (z, bundle) => {
  verifyWebhookDelivery(bundle);
  const payload = bundle.cleanedRequest;
  const event = formatEvent(z, payload);
  z.console.log('Received efimis event', {
    event_type: event.event_type,
    record_id: event.record_id,
    source_id: event.source_id,
  });
  return [event];
}

const SAMPLE_SOURCE_BY_EVENT_PREFIX = {
  Matter: 'matters',
  Client: 'clients',
  Employee: 'employees',
  Supplier: 'suppliers',
  WorkItem: 'workitems',
  Invoice: 'invoices',
  Division: 'divisions',
};

const parseSelectedEvents = (value, { required = false } = {}) => {
  const events = [
    ...new Set(
      String(value || '')
        .split(',')
        .map((event) => event.trim())
        .filter(Boolean)
        .map(toPublicEventType),
    ),
  ];

  if (required && events.length === 0) {
    throw new Error('Select at least one Efimis webhook event.');
  }

  return events;
};

const getWebhookId = (z, bundle) => {
  const zapId = bundle.meta?.zap?.id;
  const stableSource =
    zapId !== undefined && zapId !== null && String(zapId).trim() !== ''
      ? zapId
      : bundle.targetUrl;
  if (!stableSource) {
    throw new Error('Zapier did not provide subscription identity metadata.');
  }
  return `webhook_${z.hash('sha256', String(stableSource)).slice(0, 32)}`;
};

const getSampleSource = (events) => {
  for (const subscriptionType of events) {
    const eventName = subscriptionType.split('.').pop();
    const prefix = Object.keys(SAMPLE_SOURCE_BY_EVENT_PREFIX).find((key) =>
      eventName.startsWith(key),
    );
    if (prefix) {
      return {
        endpoint: SAMPLE_SOURCE_BY_EVENT_PREFIX[prefix],
        eventName,
      };
    }
  }

  return { endpoint: 'matters', eventName: 'MatterUpdated' };
};

const performList = async (z, bundle) => {
  const selectedEvents = parseSelectedEvents(bundle.inputData?.events);
  const sampleSource = getSampleSource(selectedEvents);
  const response = await z.request({
    url: buildEfimisApiUrl(bundle, sampleSource.endpoint),
    method: 'GET',
    params: {
      pageIndex: 0,
      pageSize: 1,
    },
  });
  response.throwForStatus();

  if (response.json?.success === false) {
    throw new Error(response.json.reason || 'Load webhook sample failed');
  }

  const record = response.json?.data?.rows?.[0];
  if (!record) {
    return [samples.efimis_events];
  }

  return [
    formatEvent(z, {
      Type: `Efimis.Mk2.App.ApiTypes.V1.${sampleSource.eventName}`,
      Data: {
        id: record.id,
        data: record,
        sourceId: 'perform_list_sample',
      },
    }),
  ];
};

const subscribe = async (z, bundle) => {
  const webhookSecret = parseWebhookSecret(
    bundle.inputData.webhookSecret,
  ).value;
  const events = parseSelectedEvents(bundle.inputData.events, {
    required: true,
  });
  const webhookUrl = buildEfimisApiUrl(bundle, 'webhooks');
  const webhookId = getWebhookId(z, bundle);

  z.console.log(`Subscribing to webhook at: ${webhookUrl}`);
  const options = {
    url: webhookUrl,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: z.JSON.stringify({
      id: webhookId,
      events: events.map(toApiEventType),
      enabled: true,
      url: bundle.targetUrl,
      secret: webhookSecret
    })
  };
  const response = await z.request(options);
  response.throwForStatus();
  z.console.log(`Webhook subscribed successfully: ${response.status}`);
  // The API returns 201 with an empty body, so return the identifiers Zapier
  // needs later; bundle.subscribeData is populated from this return value.
  return { id: webhookId };
}

const unsubscribe = async (z, bundle) => {
  const subscriptionId = bundle.subscribeData?.id;
  if (!subscriptionId) {
    z.console.log('No Efimis webhook subscription to remove');
    return {};
  }

  const webhookUrl = buildEfimisApiUrl(bundle, 'webhooks', subscriptionId);
  z.console.log(`Webhook unsubscribing: ${webhookUrl}`);
  const options = {
    url: webhookUrl,
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  };
  const response = await z.request(options);
  response.throwForStatus();
  return { id: subscriptionId };
}

module.exports = {
  key: 'efimis_events',
  noun: 'Events',
  display: {
    label: 'Webhook Event',
    description: 'Triggers when a new event occurs in Efimis.',
  },
  operation: {
    type: 'hook',
    sample: samples.efimis_events,
    perform,
    performList,
    performSubscribe: subscribe,
    performUnsubscribe: unsubscribe,
    outputFields: [
      { key: 'event_type', label: 'Event Type' },
      { key: 'record_id', label: 'Record ID' },
      { key: 'source_id', label: 'Source ID' },
      { key: 'matter_id', label: 'Matter ID' },
      { key: 'matter_title', label: 'Matter Title' },
      { key: 'raw_payload', label: 'Raw Payload' },
    ],
    inputFields: [
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      required: true,
      type: 'password',
      helpText: 'A GUID used to verify Efimis webhook signatures, for example 12345678-0000-0000-0000-123456789012.'
    },
    {
      key: 'events',
      label: 'Webhook Events',
      required: true,
      type: 'text',
      helpText: 'A comma-separated list of fully qualified event names. See the [Efimis Webhooks API documentation](https://developer.efimis.com/api/webhooks/) for supported events.'
    }
    ],
  },
}
