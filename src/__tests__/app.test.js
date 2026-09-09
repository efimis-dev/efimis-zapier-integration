const app = require('../index');
const zapierSchema = require('zapier-platform-core/src/tools/schema');
const { RefreshAuthError } = require('zapier-platform-core/src/errors');
const throwForStaleAuth = require('zapier-platform-core/src/http-middlewares/after/throw-for-stale-auth');
const crypto = require('crypto');
const samples = require('../samples/static_samples.json');
const { formatEvent } = require('../event_formatter');
const { buildEfimisApiUrl } = require('../efimis_url');

const ORIGINAL_API_URL = process.env.API_URL;

beforeEach(() => {
  if (!process.env.API_URL) {
    process.env.API_URL = 'https://api.example.test';
  }
});

afterAll(() => {
  if (ORIGINAL_API_URL === undefined) {
    delete process.env.API_URL;
  } else {
    process.env.API_URL = ORIGINAL_API_URL;
  }
});

const WEBHOOK_SECRET = '12345678-0000-0000-0000-123456789012';
const WEBHOOK_KEY = Buffer.from(
  '78563412000000000000123456789012',
  'hex',
);
const signWebhook = (requestId, timestamp) =>
  `HMACSHA256:${crypto
    .createHmac('sha256', WEBHOOK_KEY)
    .update(`${requestId}|${timestamp}`, 'utf8')
    .digest('base64')}`;

const webhookBundle = (payload, overrides = {}) => {
  const requestId = overrides.requestId || 'delivery-request-123';
  const timestamp = overrides.timestamp || new Date().toISOString();
  return {
    authData: {
      firm_alias: overrides.firmAlias || 'example-firm',
    },
    inputData: {
      webhookSecret: overrides.webhookSecret || WEBHOOK_SECRET,
    },
    cleanedRequest: {
      requestId,
      ...payload,
      ...(overrides.payloadRequestId
        ? { requestId: overrides.payloadRequestId }
        : {}),
    },
    rawRequest: {
      headers: {
        'x-efimis-request-id': requestId,
        'X-EFIMIS-Timestamp': timestamp,
        'x-efimis-webhook-signature':
          overrides.signature || signWebhook(requestId, timestamp),
        'X-EFIMIS-TENANT-ALIAS': overrides.tenantAlias || 'example-firm',
      },
    },
  };
};

describe('Efimis webhook trigger', () => {
  const originalApiUrl = process.env.API_URL;

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.API_URL;
    } else {
      process.env.API_URL = originalApiUrl;
    }
  });

  test('uses the subscription identifier to remove the webhook', async () => {
    process.env.API_URL = 'https://api.example.test';

    const subscribeResponse = {
      status: 201,
      throwForStatus: jest.fn(),
    };
    const unsubscribeResponse = {
      status: 204,
      throwForStatus: jest.fn(),
    };
    const z = {
      JSON,
      hash: jest.fn().mockReturnValue(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
      console: {
        log: jest.fn(),
      },
      request: jest
        .fn()
        .mockResolvedValueOnce(subscribeResponse)
        .mockResolvedValueOnce(unsubscribeResponse),
    };
    const bundle = {
      authData: {
        firm_alias: 'example-firm',
      },
      inputData: {
        webhookSecret: WEBHOOK_SECRET,
        events:
          'Efimis.Mk2.Accounting.V1.MatterUpdated, Efimis.Mk2.Accounting.V1.ClientUpdated',
      },
      meta: { zap: { id: 'zap-123' } },
      targetUrl: 'https://hooks.zapier.test/example',
    };

    const subscribeData =
      await app.triggers.efimis_events.operation.performSubscribe(z, bundle);
    const unsubscribeData =
      await app.triggers.efimis_events.operation.performUnsubscribe(z, {
        ...bundle,
        subscribeData,
      });

    const subscribeRequest = z.request.mock.calls[0][0];
    const unsubscribeRequest = z.request.mock.calls[1][0];

    expect({
      subscribeData,
      unsubscribeData,
      subscribeRequest: {
        ...subscribeRequest,
        body: JSON.parse(subscribeRequest.body),
      },
      unsubscribeRequest,
    }).toEqual({
      subscribeData: {
        id: 'webhook_0123456789abcdef0123456789abcdef',
      },
      unsubscribeData: {
        id: 'webhook_0123456789abcdef0123456789abcdef',
      },
      subscribeRequest: {
        url: 'https://api.example.test/example-firm/api/v1/webhooks',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          id: 'webhook_0123456789abcdef0123456789abcdef',
          events: [
            'PE.Mk2.Accounting.V1.MatterUpdated',
            'PE.Mk2.Accounting.V1.ClientUpdated',
          ],
          enabled: true,
          url: 'https://hooks.zapier.test/example',
          secret: WEBHOOK_SECRET,
        },
      },
      unsubscribeRequest: {
        url: 'https://api.example.test/example-firm/api/v1/webhooks/webhook_0123456789abcdef0123456789abcdef',
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    });
    expect(subscribeResponse.throwForStatus).toHaveBeenCalled();
    expect(unsubscribeResponse.throwForStatus).toHaveBeenCalled();
  });

  test('normalizes and deduplicates selected webhook events', async () => {
    process.env.API_URL = 'https://api.example.test';
    const response = {
      status: 201,
      throwForStatus: jest.fn(),
    };
    const z = {
      JSON,
      hash: jest.fn().mockReturnValue('0'.repeat(64)),
      request: jest.fn().mockResolvedValue(response),
      console: { log: jest.fn() },
    };

    await app.triggers.efimis_events.operation.performSubscribe(z, {
      authData: { firm_alias: 'example-firm' },
      inputData: {
        webhookSecret: WEBHOOK_SECRET,
        events:
          ' Efimis.Mk2.Accounting.V1.MatterUpdated, , PE.Mk2.Accounting.V1.MatterUpdated, Efimis.Mk2.Accounting.V1.ClientUpdated ',
      },
      meta: { zap: { id: 'zap-123' } },
      targetUrl: 'https://hooks.zapier.test/example',
    });

    expect(JSON.parse(z.request.mock.calls[0][0].body).events).toEqual([
      'PE.Mk2.Accounting.V1.MatterUpdated',
      'PE.Mk2.Accounting.V1.ClientUpdated',
    ]);
  });

  test('keeps the webhook ID stable when Zapier rotates the target URL', async () => {
    process.env.API_URL = 'https://api.example.test';
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      request: jest.fn().mockResolvedValue({
        status: 201,
        throwForStatus: jest.fn(),
      }),
      console: { log: jest.fn() },
    };
    const bundle = {
      authData: { firm_alias: 'example-firm' },
      inputData: {
        webhookSecret: WEBHOOK_SECRET,
        events: 'Efimis.Mk2.Accounting.V1.MatterUpdated',
      },
      meta: { zap: { id: 'zap-123' } },
    };

    const first = await app.triggers.efimis_events.operation.performSubscribe(
      z,
      { ...bundle, targetUrl: 'https://hooks.zapier.test/first' },
    );
    const second = await app.triggers.efimis_events.operation.performSubscribe(
      z,
      { ...bundle, targetUrl: 'https://hooks.zapier.test/second' },
    );

    expect(first.id).toBe(second.id);
    expect(JSON.parse(z.request.mock.calls[0][0].body).id).toBe(first.id);
    expect(JSON.parse(z.request.mock.calls[1][0].body).id).toBe(first.id);
    expect(JSON.parse(z.request.mock.calls[0][0].body).url).not.toBe(
      JSON.parse(z.request.mock.calls[1][0].body).url,
    );
  });

  test('uses the Zapier target URL when Zap ID metadata is unavailable', async () => {
    process.env.API_URL = 'https://api.example.test';
    const z = {
      JSON,
      hash: jest.fn().mockReturnValue('a'.repeat(64)),
      request: jest.fn().mockResolvedValue({
        status: 201,
        throwForStatus: jest.fn(),
      }),
      console: { log: jest.fn() },
    };

    const result = await app.triggers.efimis_events.operation.performSubscribe(
      z,
      {
        authData: { firm_alias: 'example-firm' },
        inputData: {
          webhookSecret: WEBHOOK_SECRET,
          events: 'Efimis.Mk2.Accounting.V1.MatterUpdated',
        },
        targetUrl: 'https://hooks.zapier.test/example',
      },
    );

    expect(z.hash).toHaveBeenCalledWith(
      'sha256',
      'https://hooks.zapier.test/example',
    );
    expect(result).toEqual({ id: `webhook_${'a'.repeat(32)}` });
    expect(z.request).toHaveBeenCalledTimes(1);
  });

  test('rejects an empty webhook event selection before subscribing', async () => {
    const z = {
      hash: jest.fn().mockReturnValue('0'.repeat(64)),
      request: jest.fn(),
    };

    await expect(
      app.triggers.efimis_events.operation.performSubscribe(z, {
        authData: { firm_alias: 'example-firm' },
        inputData: {
          webhookSecret: WEBHOOK_SECRET,
          events: ' , , ',
        },
        targetUrl: 'https://hooks.zapier.test/example',
      }),
    ).rejects.toThrow('Select at least one Efimis webhook event');
    expect(z.request).not.toHaveBeenCalled();
  });

  test('surfaces webhook subscription failures', async () => {
    process.env.API_URL = 'https://api.example.test';

    const subscriptionError = new Error('Subscription rejected');
    const z = {
      JSON,
      hash: jest.fn().mockReturnValue(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
      console: {
        log: jest.fn(),
      },
      request: jest.fn().mockResolvedValue({
        status: 400,
        throwForStatus: () => {
          throw subscriptionError;
        },
      }),
    };
    const bundle = {
      authData: {
        firm_alias: 'example-firm',
      },
      inputData: {
        webhookSecret: WEBHOOK_SECRET,
        events: 'Efimis.Mk2.Accounting.V1.MatterUpdated',
      },
      meta: { zap: { id: 'zap-123' } },
      targetUrl: 'https://hooks.zapier.test/example',
    };

    await expect(
      app.triggers.efimis_events.operation.performSubscribe(z, bundle),
    ).rejects.toBe(subscriptionError);
  });

  test('skips webhook removal when Zapier has no subscription ID', async () => {
    const z = {
      request: jest.fn(),
      console: { log: jest.fn() },
    };

    await expect(
      app.triggers.efimis_events.operation.performUnsubscribe(z, {
        authData: { firm_alias: 'example-firm' },
        subscribeData: {},
      }),
    ).resolves.toEqual({});
    expect(z.request).not.toHaveBeenCalled();
    expect(z.console.log).toHaveBeenCalledWith(
      'No Efimis webhook subscription to remove',
    );
  });

  test('surfaces webhook unsubscription failures', async () => {
    process.env.API_URL = 'https://api.example.test';

    const unsubscriptionError = new Error('Unsubscription rejected');
    const z = {
      console: {
        log: jest.fn(),
      },
      request: jest.fn().mockResolvedValue({
        status: 500,
        throwForStatus: () => {
          throw unsubscriptionError;
        },
      }),
    };
    const bundle = {
      authData: {
        firm_alias: 'example-firm',
      },
      subscribeData: {
        id: 'webhook_abc123',
      },
    };

    await expect(
      app.triggers.efimis_events.operation.performUnsubscribe(z, bundle),
    ).rejects.toBe(unsubscriptionError);
  });

  test('formats webhook payloads for Zapier field mapping', async () => {
    const z = {
      JSON,
      hash: jest.fn().mockReturnValue(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
      console: {
        log: jest.fn(),
      },
    };
    const bundle = webhookBundle({
        Type: 'PE.Mk2.App.ApiTypes.V1.MatterUpdated',
        Data: {
          id: 'matter_123',
          data: {
            id: 'matter_123',
            title: 'Updated test matter',
          },
          sourceId: 'source_456',
        },
    });

    await expect(
      app.triggers.efimis_events.operation.perform(z, bundle),
    ).resolves.toEqual([
      {
        id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        event_type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
        record_id: 'matter_123',
        source_id: 'source_456',
        matter_id: 'matter_123',
        matter_title: 'Updated test matter',
        raw_payload:
          '{"requestId":"delivery-request-123","Type":"Efimis.Mk2.App.ApiTypes.V1.MatterUpdated","Data":{"id":"matter_123","data":{"id":"matter_123","title":"Updated test matter"},"sourceId":"source_456"}}',
      },
    ]);
    expect(z.console.log).toHaveBeenCalledWith('Received efimis event', {
      event_type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
      record_id: 'matter_123',
      source_id: 'source_456',
    });
    expect(z.console.log.mock.calls.flat()).not.toContain(bundle.cleanedRequest);
  });

  test('accepts Zapier-normalized webhook security headers', async () => {
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      console: { log: jest.fn() },
    };
    const bundle = webhookBundle({
      Type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
      Data: {
        id: 'matter_123',
        data: { id: 'matter_123', title: 'Updated test matter' },
        sourceId: 'source_456',
      },
    });
    const headers = bundle.rawRequest.headers;
    bundle.rawRequest.headers = {
      'Http-X-Efimis-Request-Id': headers['x-efimis-request-id'],
      'Http-X-Efimis-Timestamp': headers['X-EFIMIS-Timestamp'],
      'Http-X-Efimis-Webhook-Signature':
        headers['x-efimis-webhook-signature'],
      'Http-X-Efimis-Tenant-Alias': headers['X-EFIMIS-TENANT-ALIAS'],
    };

    await expect(
      app.triggers.efimis_events.operation.perform(z, bundle),
    ).resolves.toEqual([
      expect.objectContaining({
        event_type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
        record_id: 'matter_123',
      }),
    ]);
  });

  test('accepts the current API legacy webhook security headers', async () => {
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      console: { log: jest.fn() },
    };
    const bundle = webhookBundle({
      Type: 'PE.Mk2.App.ApiTypes.V1.MatterUpdated',
      Data: { id: 'matter_123' },
    });
    const headers = bundle.rawRequest.headers;
    bundle.rawRequest.headers = {
      'x-pe2-request-id': headers['x-efimis-request-id'],
      'X-PE2-Timestamp': headers['X-EFIMIS-Timestamp'],
      'x-pe2-webhook-signature': headers['x-efimis-webhook-signature'],
      'X-PE2-TENANT-ALIAS': headers['X-EFIMIS-TENANT-ALIAS'],
    };

    await expect(
      app.triggers.efimis_events.operation.perform(z, bundle),
    ).resolves.toEqual([
      expect.objectContaining({
        event_type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
        record_id: 'matter_123',
      }),
    ]);
  });

  test('rejects a malformed webhook secret before subscribing', async () => {
    const z = {
      hash: jest.fn().mockReturnValue('0'.repeat(64)),
      request: jest.fn(),
    };

    await expect(
      app.triggers.efimis_events.operation.performSubscribe(z, {
        authData: { firm_alias: 'example-firm' },
        inputData: {
          webhookSecret: 'not-a-guid',
          events: 'Efimis.Mk2.Accounting.V1.MatterUpdated',
        },
        targetUrl: 'https://hooks.zapier.test/example',
      }),
    ).rejects.toThrow('Webhook Secret must be a GUID');
    expect(z.request).not.toHaveBeenCalled();
  });

  test('rejects webhook deliveries with an invalid signature', async () => {
    const bundle = webhookBundle(
      { Type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated', Data: {} },
      { signature: 'HMACSHA256:not-valid' },
    );

    await expect(
      app.triggers.efimis_events.operation.perform({ console: { log: jest.fn() } }, bundle),
    ).rejects.toThrow('signature is invalid');
  });

  test('rejects stale webhook deliveries', async () => {
    const bundle = webhookBundle(
      { Type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated', Data: {} },
      { timestamp: '2020-01-01T00:00:00.000Z' },
    );

    await expect(
      app.triggers.efimis_events.operation.perform({ console: { log: jest.fn() } }, bundle),
    ).rejects.toThrow('timestamp is invalid or stale');
  });

  test('rejects webhook deliveries beyond the allowed future clock skew', async () => {
    const bundle = webhookBundle(
      { Type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated', Data: {} },
      { timestamp: new Date(Date.now() + 6 * 60 * 1000).toISOString() },
    );

    await expect(
      app.triggers.efimis_events.operation.perform({ console: { log: jest.fn() } }, bundle),
    ).rejects.toThrow('timestamp is invalid or stale');
  });

  test.each([
    'x-efimis-request-id',
    'X-EFIMIS-Timestamp',
    'x-efimis-webhook-signature',
    'X-EFIMIS-TENANT-ALIAS',
  ])('rejects webhook deliveries missing the %s header', async (header) => {
    const bundle = webhookBundle({
      Type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
      Data: {},
    });
    delete bundle.rawRequest.headers[header];

    await expect(
      app.triggers.efimis_events.operation.perform({ console: { log: jest.fn() } }, bundle),
    ).rejects.toThrow('missing required Efimis headers');
  });

  test('rejects webhook deliveries for another tenant', async () => {
    const bundle = webhookBundle(
      { Type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated', Data: {} },
      { tenantAlias: 'another-firm' },
    );

    await expect(
      app.triggers.efimis_events.operation.perform({ console: { log: jest.fn() } }, bundle),
    ).rejects.toThrow('tenant does not match');
  });

  test('rejects webhook deliveries whose request ID differs from the body', async () => {
    const bundle = webhookBundle(
      { Type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated', Data: {} },
      { payloadRequestId: 'different-request-id' },
    );

    await expect(
      app.triggers.efimis_events.operation.perform({ console: { log: jest.fn() } }, bundle),
    ).rejects.toThrow('request ID does not match');
  });

  test('deduplicates webhook retries without using requestId', async () => {
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      console: {
        log: jest.fn(),
      },
    };
    const payload = {
      Type: 'Efimis.Mk2.Accounting.V1.WorkflowEvent',
      Data: {
        id: 'workflow_123',
        sourceId: 'source_456',
        status: 'Ready',
      },
    };

    const firstResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(payload, { requestId: 'delivery-request-123' }),
    );
    const secondResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(payload, { requestId: 'delivery-request-456' }),
    );

    expect(firstResult[0].id).toBe(secondResult[0].id);
    expect(firstResult[0].id).not.toContain('delivery-request');
  });

  test('distinguishes different event payloads that share correlation fields', async () => {
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      console: { log: jest.fn() },
    };
    const firstPayload = {
      Type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
      Data: {
        id: 'matter_123',
        sourceId: 'source_456',
        data: { id: 'matter_123', title: 'First title' },
      },
    };
    const secondPayload = {
      ...firstPayload,
      Data: {
        ...firstPayload.Data,
        data: { id: 'matter_123', title: 'Second title' },
      },
    };

    const firstResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(firstPayload),
    );
    const secondResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(secondPayload),
    );

    expect(firstResult[0].id).not.toBe(secondResult[0].id);
  });

  test('uses canonical object-key ordering for webhook IDs', async () => {
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      console: { log: jest.fn() },
    };
    const firstPayload = {
      Type: 'Efimis.Mk2.App.ApiTypes.V1.ClientUpdated',
      Data: {
        id: 'client_123',
        data: { id: 'client_123', sortName: 'Example Client' },
      },
    };
    const secondPayload = {
      Data: {
        data: { sortName: 'Example Client', id: 'client_123' },
        id: 'client_123',
      },
      Type: 'Efimis.Mk2.App.ApiTypes.V1.ClientUpdated',
    };

    const firstResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(firstPayload, { requestId: 'delivery-request-123' }),
    );
    const secondResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(secondPayload, { requestId: 'delivery-request-456' }),
    );

    expect(firstResult[0].id).toBe(secondResult[0].id);
  });

  test('uses canonical array and null values for webhook IDs', async () => {
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      console: { log: jest.fn() },
    };
    const firstPayload = {
      Type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
      Data: {
        id: 'matter_123',
        data: {
          id: 'matter_123',
          title: null,
          tags: [
            { value: 'urgent', label: 'Urgent' },
            { label: 'Review', value: 'review' },
          ],
        },
      },
    };
    const secondPayload = {
      Data: {
        data: {
          tags: [
            { label: 'Urgent', value: 'urgent' },
            { value: 'review', label: 'Review' },
          ],
          title: null,
          id: 'matter_123',
        },
        id: 'matter_123',
      },
      Type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
    };

    const firstResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(firstPayload, { requestId: 'delivery-request-123' }),
    );
    const secondResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(secondPayload, { requestId: 'delivery-request-456' }),
    );

    expect(firstResult[0].id).toBe(secondResult[0].id);
  });

  test('excludes top-level requestId from webhook IDs regardless of casing', async () => {
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      console: { log: jest.fn() },
    };
    const payload = {
      Type: 'Efimis.Mk2.App.ApiTypes.V1.ClientUpdated',
      Data: {
        id: 'client_123',
        data: { id: 'client_123', sortName: 'Example Client' },
      },
    };

    const firstResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(payload, {
        requestId: 'delivery-request-123',
      }),
    );
    const secondResult = await app.triggers.efimis_events.operation.perform(
      z,
      {
        ...webhookBundle(payload, {
          requestId: 'delivery-request-456',
        }),
        cleanedRequest: {
          RequestId: 'delivery-request-456',
          ...payload,
        },
      },
    );

    expect(firstResult[0].id).toBe(secondResult[0].id);
  });

  test('keeps nested requestId values in webhook IDs as business payload', async () => {
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      console: { log: jest.fn() },
    };
    const basePayload = {
      Type: 'Efimis.Mk2.App.ApiTypes.V1.WorkflowEvent',
      Data: {
        id: 'workflow_123',
        sourceId: 'source_456',
        data: {
          requestId: 'business-request-123',
        },
      },
    };
    const changedNestedPayload = {
      ...basePayload,
      Data: {
        ...basePayload.Data,
        data: {
          requestId: 'business-request-456',
        },
      },
    };

    const firstResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(basePayload),
    );
    const secondResult = await app.triggers.efimis_events.operation.perform(
      z,
      webhookBundle(changedNestedPayload),
    );

    expect(firstResult[0].id).not.toBe(secondResult[0].id);
  });

  test('loads sample webhook data from real Efimis REST matter records', async () => {
    process.env.API_URL = 'https://api.example.test';
    const response = {
      json: {
        data: {
          rows: [
            {
              id: 'matter_123',
              title: 'REST sample matter',
              matterNumber: 'M-100',
            },
          ],
        },
      },
      throwForStatus: jest.fn(),
    };
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      request: jest.fn().mockResolvedValue(response),
    };

    const results = await app.triggers.efimis_events.operation.performList(z, {
      authData: { firm_alias: 'example-firm' },
      inputData: { events: 'Efimis.Mk2.Accounting.V1.MatterUpdated' },
    });

    expect(z.request).toHaveBeenCalledWith({
      url: 'https://api.example.test/example-firm/api/v1/matters',
      method: 'GET',
      params: {
        pageIndex: 0,
        pageSize: 1,
      },
    });
    expect(response.throwForStatus).toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      event_type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
      record_id: 'matter_123',
      source_id: 'perform_list_sample',
      matter_id: 'matter_123',
      matter_title: 'REST sample matter',
    });
    expect(Object.keys(results[0]).sort()).toEqual([
      'event_type',
      'id',
      'matter_id',
      'matter_title',
      'raw_payload',
      'record_id',
      'source_id',
    ]);
  });

  test('uses the first sampleable event from a comma-separated selection', async () => {
    process.env.API_URL = 'https://api.example.test';
    const response = {
      json: { data: { rows: [{ id: 'client_123', sortName: 'Client' }] } },
      throwForStatus: jest.fn(),
    };
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      request: jest.fn().mockResolvedValue(response),
    };

    const results = await app.triggers.efimis_events.operation.performList(z, {
      authData: { firm_alias: 'example-firm' },
      inputData: {
        events:
          'Efimis.Mk2.Accounting.V1.ApprovalStarted, Efimis.Mk2.Accounting.V1.ClientUpdated',
      },
    });

    expect(z.request.mock.calls[0][0].url).toContain('/api/v1/clients');
    expect(results[0].event_type).toBe(
      'Efimis.Mk2.App.ApiTypes.V1.ClientUpdated',
    );
  });

  test.each([
    ['ClientUpdated', 'clients'],
    ['EmployeeCreated', 'employees'],
    ['SupplierUpdated', 'suppliers'],
    ['WorkItemFinalised', 'workitems'],
    ['InvoiceIssued', 'invoices'],
    ['DivisionUpdated', 'divisions'],
  ])(
    'loads a real %s sample from the %s REST endpoint',
    async (eventName, endpoint) => {
      process.env.API_URL = 'https://api.example.test';
      const response = {
        json: {
          success: true,
          data: { rows: [{ id: `${endpoint}_123`, name: 'Sample record' }] },
        },
        throwForStatus: jest.fn(),
      };
      const z = {
        JSON,
        hash: (algorithm, value) =>
          crypto.createHash(algorithm).update(value).digest('hex'),
        request: jest.fn().mockResolvedValue(response),
      };

      const results = await app.triggers.efimis_events.operation.performList(
        z,
        {
          authData: { firm_alias: 'example-firm' },
          inputData: { events: `Efimis.Mk2.Accounting.V1.${eventName}` },
        },
      );

      expect(z.request.mock.calls[0][0].url).toBe(
        `https://api.example.test/example-firm/api/v1/${endpoint}`,
      );
      expect(results[0]).toMatchObject({
        event_type: `Efimis.Mk2.App.ApiTypes.V1.${eventName}`,
        record_id: `${endpoint}_123`,
        source_id: 'perform_list_sample',
      });
    },
  );

  test('uses a real matter as the generic fallback for events without list endpoints', async () => {
    process.env.API_URL = 'https://api.example.test';
    const response = {
      json: { data: { rows: [{ id: 'matter_123', title: 'Sample matter' }] } },
      throwForStatus: jest.fn(),
    };
    const z = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
      request: jest.fn().mockResolvedValue(response),
    };

    const results = await app.triggers.efimis_events.operation.performList(z, {
      authData: { firm_alias: 'example-firm' },
      inputData: { events: 'Efimis.Mk2.Accounting.V1.ApprovalStarted' },
    });

    expect(z.request.mock.calls[0][0].url).toContain('/api/v1/matters');
    expect(results[0].event_type).toBe(
      'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
    );
  });

  test('surfaces Efimis business failures while loading webhook samples', async () => {
    process.env.API_URL = 'https://api.example.test';
    const response = {
      json: { success: false, reason: 'Sample access denied' },
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await expect(
      app.triggers.efimis_events.operation.performList(z, {
        authData: { firm_alias: 'example-firm' },
        inputData: { events: 'Efimis.Mk2.Accounting.V1.ClientUpdated' },
      }),
    ).rejects.toThrow('Sample access denied');
  });

  test('returns the static sample when Efimis has no sample records', async () => {
    process.env.API_URL = 'https://api.example.test';
    const response = {
      json: { data: { rows: [] } },
      throwForStatus: jest.fn(),
    };
    const z = {
      request: jest.fn().mockResolvedValue(response),
    };

    await expect(
      app.triggers.efimis_events.operation.performList(z, {
        authData: { firm_alias: 'example-firm' },
        inputData: { events: 'Efimis.Mk2.Accounting.V1.MatterUpdated' },
      }),
    ).resolves.toEqual([samples.efimis_events]);
  });
});

describe('Efimis REST URL construction', () => {
  const originalApiUrl = process.env.API_URL;

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.API_URL;
    } else {
      process.env.API_URL = originalApiUrl;
    }
  });

  test('normalizes the base URL and encodes tenant and record segments', () => {
    process.env.API_URL = '  https://api.example.test///  ';

    expect(
      buildEfimisApiUrl(
        { authData: { firm_alias: 'firm/alias?' } },
        'matters',
        'record/with?#',
      ),
    ).toBe(
      'https://api.example.test/firm%2Falias%3F/api/v1/matters/record%2Fwith%3F%23',
    );
  });

  test('rejects missing API configuration before making a request', () => {
    delete process.env.API_URL;

    expect(() =>
      buildEfimisApiUrl(
        { authData: { firm_alias: 'example-firm' } },
        'matters',
      ),
    ).toThrow('API_URL environment variable is required');
  });

  test('rejects a missing firm alias before making a request', () => {
    process.env.API_URL = 'https://api.example.test';

    expect(() => buildEfimisApiUrl({ authData: {} }, 'matters')).toThrow(
      'firm alias is required',
    );
  });
});

describe('Efimis response envelopes', () => {
  const bundle = {
    authData: { firm_alias: 'example-firm' },
    inputData: { id: 'record_123' },
    meta: { page: 0 },
  };

  const operations = [
    ['find matters', app.searches.apiV1MattersGet.operation.perform],
    ['get matter', app.searches.apiV1MatterGetById.operation.perform],
    ['find clients', app.searches.apiV1ClientsGet.operation.perform],
    ['get client', app.searches.apiV1ClientGetById.operation.perform],
    ['list dropdown records', app.resources.client.list.operation.perform],
  ];

  test.each(operations)(
    'surfaces the Efimis reason when %s returns a business failure',
    async (_name, perform) => {
      const response = {
        json: { success: false, reason: 'Efimis rejected the read' },
        throwForStatus: jest.fn(),
      };
      const z = {
        request: jest.fn().mockResolvedValue(response),
        console: { log: jest.fn() },
      };

      await expect(perform(z, bundle)).rejects.toThrow(
        'Efimis rejected the read',
      );
      expect(response.throwForStatus).toHaveBeenCalled();
    },
  );

  test.each([
    ['find matters', app.searches.apiV1MattersGet.operation.perform],
    ['find clients', app.searches.apiV1ClientsGet.operation.perform],
    ['list dropdown records', app.resources.client.list.operation.perform],
  ])('rejects a malformed row collection from %s', async (_name, perform) => {
    const response = {
      json: { success: true, data: {} },
      throwForStatus: jest.fn(),
    };
    const z = {
      request: jest.fn().mockResolvedValue(response),
      console: { log: jest.fn() },
    };

    await expect(perform(z, bundle)).rejects.toThrow(
      'invalid row collection',
    );
  });

  test.each([
    ['get matter', app.searches.apiV1MatterGetById.operation.perform],
    ['get client', app.searches.apiV1ClientGetById.operation.perform],
  ])('rejects a missing data property from %s', async (_name, perform) => {
    const response = {
      json: { success: true },
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await expect(perform(z, bundle)).rejects.toThrow('returned no data');
  });
});

describe('Efimis record URL encoding', () => {
  const reservedId = 'record/with?reserved#characters';
  const encodedId = 'record%2Fwith%3Freserved%23characters';

  test.each([
    [
      'client detail',
      app.searches.apiV1ClientGetById.operation.perform,
      'clients',
    ],
    [
      'matter detail',
      app.searches.apiV1MatterGetById.operation.perform,
      'matters',
    ],
  ])('encodes an ID in the %s URL', async (_name, perform, endpoint) => {
    process.env.API_URL = 'https://api.example.test';
    const response = {
      json: { success: true, data: { id: reservedId } },
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await perform(z, {
      authData: { firm_alias: 'example-firm' },
      inputData: { id: reservedId },
    });

    expect(z.request.mock.calls[0][0].url).toBe(
      `https://api.example.test/example-firm/api/v1/${endpoint}/${encodedId}`,
    );
  });

  test('encodes the matter ID in update and follow-up URLs', async () => {
    process.env.API_URL = 'https://api.example.test';
    const patchResponse = {
      json: { success: true, data: reservedId },
      throwForStatus: jest.fn(),
    };
    const getResponse = {
      json: { success: true, data: { id: reservedId } },
      throwForStatus: jest.fn(),
    };
    const z = {
      request: jest
        .fn()
        .mockResolvedValueOnce(patchResponse)
        .mockResolvedValueOnce(getResponse),
    };

    await app.creates.apiV1MatterUpdate.operation.perform(z, {
      authData: { firm_alias: 'example-firm' },
      inputData: { id: reservedId },
    });

    expect(z.request.mock.calls.map(([request]) => request.url)).toEqual([
      `https://api.example.test/example-firm/api/v1/matters/${encodedId}`,
      `https://api.example.test/example-firm/api/v1/matters/${encodedId}`,
    ]);
  });
});

describe('Efimis matter actions', () => {
  const originalApiUrl = process.env.API_URL;

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.API_URL;
    } else {
      process.env.API_URL = originalApiUrl;
    }
  });

  test('returns the created matter object instead of an array', async () => {
    process.env.API_URL = 'https://api.example.test';
    const createdMatter = {
      id: 'matter_123',
      title: 'New matter',
    };
    const response = {
      json: { success: true, data: createdMatter },
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await expect(
      app.creates.apiV1MatterCreate.operation.perform(z, {
        authData: { firm_alias: 'example-firm' },
        inputData: { title: 'New matter' },
      }),
    ).resolves.toEqual(createdMatter);
    expect(response.throwForStatus).toHaveBeenCalled();
  });

  test('omits blank optional fields from create requests', async () => {
    process.env.API_URL = 'https://api.example.test';
    const response = {
      json: { success: true, data: { id: 'matter_123' } },
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await app.creates.apiV1MatterCreate.operation.perform(z, {
      authData: { firm_alias: 'example-firm' },
      inputData: {
        title: 'New matter',
        divisionId: '',
        matterTypeId: undefined,
        clientId: null,
        billingContactId: 'contact_123',
      },
    });

    expect(z.request.mock.calls[0][0].body).toEqual({
      title: 'New matter',
      billingContactId: 'contact_123',
    });
  });

  test('fetches and returns the full matter after an update', async () => {
    process.env.API_URL = 'https://api.example.test';
    const updatedMatter = {
      id: 'matter_123',
      title: 'Updated matter',
    };
    const patchResponse = {
      json: { success: true, data: 'matter_123' },
      throwForStatus: jest.fn(),
    };
    const getResponse = {
      json: { success: true, data: updatedMatter },
      throwForStatus: jest.fn(),
    };
    const z = {
      request: jest
        .fn()
        .mockResolvedValueOnce(patchResponse)
        .mockResolvedValueOnce(getResponse),
    };

    await expect(
      app.creates.apiV1MatterUpdate.operation.perform(z, {
        authData: { firm_alias: 'example-firm' },
        inputData: { id: 'matter_123', title: 'Updated matter' },
      }),
    ).resolves.toEqual(updatedMatter);
    expect(z.request.mock.calls[1][0]).toEqual({
      url: 'https://api.example.test/example-firm/api/v1/matters/matter_123',
      method: 'GET',
    });
    expect(patchResponse.throwForStatus).toHaveBeenCalled();
    expect(getResponse.throwForStatus).toHaveBeenCalled();
  });

  test('omits blank update fields but preserves explicit null clears', async () => {
    process.env.API_URL = 'https://api.example.test';
    const patchResponse = {
      json: { success: true, data: 'matter_123' },
      throwForStatus: jest.fn(),
    };
    const getResponse = {
      json: { success: true, data: { id: 'matter_123' } },
      throwForStatus: jest.fn(),
    };
    const z = {
      request: jest
        .fn()
        .mockResolvedValueOnce(patchResponse)
        .mockResolvedValueOnce(getResponse),
    };

    await app.creates.apiV1MatterUpdate.operation.perform(z, {
      authData: { firm_alias: 'example-firm' },
      inputData: {
        id: 'matter_123',
        title: '',
        divisionId: undefined,
        matterTypeId: 'matter-type_123',
        clientId: null,
      },
    });

    expect(z.request.mock.calls[0][0].body).toEqual({
      matterTypeId: 'matter-type_123',
      clientId: null,
    });
  });

  test('does not fetch a matter when Efimis rejects the update', async () => {
    process.env.API_URL = 'https://api.example.test';
    const response = {
      json: { success: false, reason: 'Matter update was rejected' },
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await expect(
      app.creates.apiV1MatterUpdate.operation.perform(z, {
        authData: { firm_alias: 'example-firm' },
        inputData: { id: 'matter_123' },
      }),
    ).rejects.toThrow('Matter update was rejected');
    expect(z.request).toHaveBeenCalledTimes(1);
  });
});

describe('Efimis authentication', () => {
  test('rejects a tenant string response with the Efimis reason', async () => {
    const response = {
      json: 'Firm alias was not found',
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await expect(
      app.authentication.test(z, {
        authData: { firm_alias: 'example-firm' },
      }),
    ).rejects.toThrow('Firm alias was not found');
    expect(response.throwForStatus).toHaveBeenCalled();
  });

  test('validates the tenant envelope and preserves it for the connection label', async () => {
    const tenantResult = {
      success: true,
      data: { firmName: 'Example Legal' },
    };
    const response = {
      json: tenantResult,
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    const connection = await app.authentication.test(z, {
      authData: { firm_alias: 'example-firm' },
    });

    expect(connection).toEqual({
      firm_alias: 'example-firm',
      firmName: 'Example Legal',
    });
    expect(response.throwForStatus).toHaveBeenCalled();
    expect(
      app.authentication.connectionLabel(null, { inputData: connection }),
    ).toBe('Efimis - Example Legal');
  });

  test('rejects an empty tenant string response', async () => {
    const response = {
      json: '   ',
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await expect(
      app.authentication.test(z, {
        authData: { firm_alias: 'example-firm' },
      }),
    ).rejects.toThrow('Authentication test returned an invalid Efimis response');
  });

  test('rejects a tenant-level authentication failure', async () => {
    const response = {
      json: { success: false, reason: 'Tenant is unavailable' },
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await expect(
      app.authentication.test(z, {
        authData: { firm_alias: 'example-firm' },
      }),
    ).rejects.toThrow('Tenant is unavailable');
  });

  test('stores a non-empty access token as the Zapier session key', async () => {
    const response = {
      json: { access_token: 'access-token-123' },
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await expect(
      app.authentication.sessionConfig.perform(z, {}),
    ).resolves.toEqual({ sessionKey: 'access-token-123' });
    expect(response.throwForStatus).toHaveBeenCalled();
  });

  test('rejects a token response without a usable access token', async () => {
    const response = {
      json: { access_token: '   ' },
      throwForStatus: jest.fn(),
    };
    const z = { request: jest.fn().mockResolvedValue(response) };

    await expect(
      app.authentication.sessionConfig.perform(z, {}),
    ).rejects.toThrow('did not return an access token');
  });
});

describe('Zapier app definition', () => {
  test('publishes version 2.0.4 with only the efimis_events trigger key', () => {
    expect(app.version).toBe('2.0.4');
    expect(Object.keys(app.triggers)).toContain('efimis_events');
    expect(Object.keys(app.triggers)).not.toContain('prime_events');
  });

  test('masks the webhook signing secret in the Zap editor', () => {
    const compiledApp = zapierSchema.compileApp(app);
    const webhookSecretField =
      compiledApp.triggers.efimis_events.operation.inputFields.find(
        (field) => field.key === 'webhookSecret',
      );

    expect(webhookSecretField.type).toBe('password');
  });

  test('compiles without schema errors', () => {
    const compiledApp = zapierSchema.compileApp(app);

    expect(zapierSchema.validateApp(compiledApp)).toEqual([]);
  });

  test('uses Zapier session auth so 401 responses trigger auth refresh', () => {
    const compiledApp = zapierSchema.compileApp(app);

    expect(compiledApp.authentication.type).toBe('session');
    expect(typeof compiledApp.authentication.sessionConfig.perform).toBe(
      'function',
    );
    expect(compiledApp.afterResponse).toHaveLength(0);
    expect(() => throwForStaleAuth({ status: 401 })).toThrow(RefreshAuthError);
    const okResponse = { status: 200 };
    expect(throwForStaleAuth(okResponse)).toBe(okResponse);
  });

  test('adds the session token to authenticated requests when present', () => {
    const compiledApp = zapierSchema.compileApp(app);
    const request = compiledApp.beforeRequest[0]({}, {}, {
      authData: { sessionKey: 'access-token-123' },
    });

    expect(request.headers.Authorization).toBe('Bearer access-token-123');
    expect(() => compiledApp.beforeRequest[0]({}, {}, {})).not.toThrow();
  });

  test('exposes dynamic selectors for ID fields', () => {
    const compiledApp = zapierSchema.compileApp(app);
    const getClientFields =
      compiledApp.searches.apiV1ClientGetById.operation.inputFields;
    const getMatterFields =
      compiledApp.searches.apiV1MatterGetById.operation.inputFields;
    const createMatterFields =
      compiledApp.creates.apiV1MatterCreate.operation.inputFields;
    const updateMatterFields =
      compiledApp.creates.apiV1MatterUpdate.operation.inputFields;
    const updateMatterTypeField = updateMatterFields.find(
      (field) => field.key === 'matterTypeId',
    );
    const dynamicSourceKey = updateMatterTypeField.dynamic.split('.')[0];
    const fieldsWithDynamicSources = [
      getClientFields.find((field) => field.key === 'id'),
      getMatterFields.find((field) => field.key === 'id'),
      createMatterFields.find((field) => field.key === 'clientId'),
      createMatterFields.find((field) => field.key === 'billingContactId'),
      updateMatterFields.find((field) => field.key === 'id'),
      updateMatterFields.find((field) => field.key === 'matterTypeId'),
      updateMatterFields.find((field) => field.key === 'clientId'),
      updateMatterFields.find((field) => field.key === 'billingContactId'),
    ];

    expect({
      allDynamicSourcesExist: fieldsWithDynamicSources.every(
        (field) =>
          typeof field.dynamic === 'string' &&
          compiledApp.triggers[field.dynamic.split('.')[0]] !== undefined,
      ),
      dynamicSourceExists:
        compiledApp.triggers[dynamicSourceKey] !== undefined,
      webhookIdRemoved:
        compiledApp.triggers.efimis_events.operation.inputFields.every(
          (field) => field.key !== 'webhookId',
        ),
      webhookOutputFields:
        compiledApp.triggers.efimis_events.operation.outputFields.map(
          (field) => field.key,
        ),
    }).toEqual({
      allDynamicSourcesExist: true,
      dynamicSourceExists: true,
      webhookIdRemoved: true,
      webhookOutputFields: [
        'event_type',
        'record_id',
        'source_id',
        'matter_id',
        'matter_title',
        'raw_payload',
      ],
    });
  });

  test('formats client dropdown records and supports paging', async () => {
    const originalApiUrl = process.env.API_URL;
    process.env.API_URL = 'https://api.example.test';

    try {
      const response = {
        json: {
          data: {
            rows: [
              {
                id: 'client_123',
                clientNumber: 'C-100',
                sortName: 'Example Client',
              },
            ],
          },
        },
        throwForStatus: jest.fn(),
      };
      const z = {
        request: jest.fn().mockResolvedValue(response),
      };

      const choices = await app.resources.client.list.operation.perform(z, {
        authData: { firm_alias: 'example-firm' },
        meta: { page: 0 },
      });

      expect(z.request).toHaveBeenCalledWith({
        url: 'https://api.example.test/example-firm/api/v1/clients',
        method: 'GET',
        params: {
          pageIndex: 0,
          pageSize: 100,
        },
      });
      expect(response.throwForStatus).toHaveBeenCalled();
      expect(choices).toEqual([
        {
          id: 'client_123',
          name: 'C-100 — Example Client',
        },
      ]);
    } finally {
      if (originalApiUrl === undefined) {
        delete process.env.API_URL;
      } else {
        process.env.API_URL = originalApiUrl;
      }
    }
  });
});

describe('Static samples', () => {
  test('uses Zapier output fields for the webhook trigger sample', () => {
    const rawPayload = JSON.parse(samples.efimis_events.raw_payload);
    const formatter = {
      JSON,
      hash: (algorithm, value) =>
        crypto.createHash(algorithm).update(value).digest('hex'),
    };

    expect(samples.efimis_events).toEqual({
      id: expect.any(String),
      event_type: expect.any(String),
      record_id: expect.any(String),
      source_id: expect.any(String),
      matter_id: expect.any(String),
      matter_title: expect.any(String),
      raw_payload: expect.any(String),
    });
    expect(samples.efimis_events).not.toHaveProperty('Type');
    expect(samples.efimis_events).not.toHaveProperty('Data');
    expect(samples.efimis_events.event_type).toBe(
      'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
    );
    expect(rawPayload).toMatchObject({
      requestId: expect.any(String),
      type: samples.efimis_events.event_type,
      data: {
        id: samples.efimis_events.record_id,
        sourceId: samples.efimis_events.source_id,
      },
    });
    expect(rawPayload).not.toHaveProperty('Type');
    expect(rawPayload).not.toHaveProperty('Data');
    expect(samples.efimis_events).toEqual(formatEvent(formatter, rawPayload));
  });

  test.each([
    'apiV1MattersGet',
    'apiV1MatterGetById',
    'apiV1ClientsGet',
    'apiV1ClientGetById',
    'apiV1MatterCreate',
    'apiV1MatterUpdate',
  ])('keeps the %s sample as a single record object', (sampleKey) => {
    expect(samples[sampleKey]).toEqual(expect.objectContaining({
      id: expect.any(String),
    }));
    expect(Array.isArray(samples[sampleKey])).toBe(false);
  });
});
