'use strict';

const crypto = require('crypto');

const GUID_PATTERN = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;
const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;

const getHeader = (headers, ...names) => {
  for (const name of names) {
    const expectedName = name.toLowerCase();
    const key = Object.keys(headers || {}).find((headerName) => {
      const normalizedName = headerName.toLowerCase();
      return (
        normalizedName === expectedName ||
        normalizedName === `http-${expectedName}`
      );
    });
    if (key) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
};

const parseWebhookSecret = (secret) => {
  const value = typeof secret === 'string' ? secret.trim() : '';
  const match = GUID_PATTERN.exec(value);
  if (!match) {
    throw new Error(
      'Webhook Secret must be a GUID in the form 12345678-0000-0000-0000-123456789012.',
    );
  }

  const reverseBytes = (hex) => hex.match(/../g).reverse().join('');
  return {
    value,
    key: Buffer.from(
      `${reverseBytes(match[1])}${reverseBytes(match[2])}${reverseBytes(match[3])}${match[4]}${match[5]}`,
      'hex',
    ),
  };
};

const verifyWebhookDelivery = (bundle) => {
  const headers = bundle.rawRequest?.headers || {};
  // Prefer the public Efimis names while accepting the current API's legacy
  // delivery headers so existing webhook subscriptions continue to work.
  const requestId = getHeader(
    headers,
    'X-EFIMIS-REQUEST-ID',
    'X-PE2-REQUEST-ID',
  );
  const timestamp = getHeader(
    headers,
    'X-EFIMIS-TIMESTAMP',
    'X-PE2-TIMESTAMP',
  );
  const signature = getHeader(
    headers,
    'X-EFIMIS-WEBHOOK-SIGNATURE',
    'X-PE2-WEBHOOK-SIGNATURE',
  );
  const tenantAlias = getHeader(
    headers,
    'X-EFIMIS-TENANT-ALIAS',
    'X-PE2-TENANT-ALIAS',
  );

  if (!requestId || !timestamp || !signature || !tenantAlias) {
    throw new Error('Webhook delivery is missing required Efimis headers.');
  }

  const sentAt = Date.parse(timestamp);
  if (
    !Number.isFinite(sentAt) ||
    Math.abs(Date.now() - sentAt) > MAX_TIMESTAMP_AGE_MS
  ) {
    throw new Error('Webhook delivery timestamp is invalid or stale.');
  }

  const expectedTenant = bundle.authData?.firm_alias;
  if (
    !expectedTenant ||
    String(tenantAlias).toLowerCase() !== String(expectedTenant).toLowerCase()
  ) {
    throw new Error('Webhook delivery tenant does not match this connection.');
  }

  const payloadRequestId =
    bundle.cleanedRequest?.requestId || bundle.cleanedRequest?.RequestId;
  if (!payloadRequestId || String(payloadRequestId) !== String(requestId)) {
    throw new Error('Webhook delivery request ID does not match its payload.');
  }

  const { key } = parseWebhookSecret(bundle.inputData?.webhookSecret);
  const digest = crypto
    .createHmac('sha256', key)
    .update(`${requestId}|${timestamp}`, 'utf8')
    .digest('base64');
  const expectedSignature = Buffer.from(`HMACSHA256:${digest}`, 'utf8');
  const receivedSignature = Buffer.from(String(signature), 'utf8');

  if (
    receivedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    throw new Error('Webhook delivery signature is invalid.');
  }
};

module.exports = {
  parseWebhookSecret,
  verifyWebhookDelivery,
};
