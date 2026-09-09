'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { formatEvent } = require('../event_formatter');

const getArgument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const envPath = getArgument('--env');
const outputPath = getArgument('--output');

if (!envPath || !outputPath) {
  throw new Error(
    'Usage: node scripts/generate_static_samples.js --env <path> --output <path>',
  );
}

const parseEnv = (contents) =>
  Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const key = line.slice(0, separator).trim();
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, '$2');
        return [key, value];
      }),
  );

const env = parseEnv(fs.readFileSync(path.resolve(envPath), 'utf8'));
const requiredEnvironment = [
  'EFIMIS_AUTH_URL',
  'EFIMIS_CLIENT_ID',
  'EFIMIS_CLIENT_SECRET',
  'EFIMIS_API_SCOPE',
  'EFIMIS_BASE_URL',
  'EFIMIS_TENANT_ALIAS',
];

const missingEnvironment = requiredEnvironment.filter((key) => !env[key]);
if (missingEnvironment.length) {
  throw new Error(
    `Missing required environment variables: ${missingEnvironment.join(', ')}`,
  );
}

const requestJson = async (label, url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  return response.json();
};

const getAccessToken = async () => {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: env.EFIMIS_API_SCOPE,
    client_id: env.EFIMIS_CLIENT_ID,
    client_secret: env.EFIMIS_CLIENT_SECRET,
  });

  const result = await requestJson('Efimis authentication', env.EFIMIS_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!result.access_token) {
    throw new Error('Efimis authentication returned no access token');
  }
  return result.access_token;
};

const digest = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex');

const identifierMap = new Map();
const anonymiseIdentifier = (value, key) => {
  const mapKey = String(value);
  if (identifierMap.has(mapKey)) {
    return identifierMap.get(mapKey);
  }

  const hash = digest(`${key}:${mapKey}`);
  let anonymised;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(mapKey)) {
    anonymised = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(
      13,
      16,
    )}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  } else if (/^[a-z][a-z0-9]*_[0-9a-f]+$/i.test(mapKey)) {
    anonymised = `${mapKey.split('_', 1)[0]}_${hash.slice(0, 32)}`;
  } else {
    anonymised = `example_${key.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${hash.slice(0, 8)}`;
  }

  identifierMap.set(mapKey, anonymised);
  return anonymised;
};

const isIdentifier = (key, value) =>
  /(^id$|id$|identifier$)/i.test(key) ||
  /^[a-z][a-z0-9]*_[0-9a-f]{16,}$/i.test(value) ||
  /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);

const anonymiseString = (value, key) => {
  if (!value) return value;
  if (isIdentifier(key, value)) return anonymiseIdentifier(value, key);
  if (/email/i.test(key) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return 'alex.taylor@example.com';
  }
  if (/phone|mobile|telephone/i.test(key)) return '+61 2 5550 0100';
  if (/first.?name|given.?name/i.test(key)) return 'Alex';
  if (/last.?name|family.?name|surname/i.test(key)) return 'Taylor';
  if (/name/i.test(key)) return 'Example Client';
  if (/title|description|notes?|summary/i.test(key)) {
    return 'Example matter for Zapier field mapping';
  }
  if (/address/i.test(key)) return '100 Example Street';
  if (/suburb|city|locality/i.test(key)) return 'Sydney';
  if (/post.?code|zip/i.test(key)) return '2000';
  if (/country/i.test(key)) return 'Australia';
  if (/url|uri|link/i.test(key)) return 'https://example.com/resource';
  if (/reference|number|code/i.test(key)) return 'EXAMPLE-001';
  if (
    /date|time|created|updated|modified/i.test(key) ||
    /^\d{4}-\d{2}-\d{2}T/.test(value)
  ) {
    return '2026-01-15T10:30:00Z';
  }
  return `Example ${key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`;
};

const anonymise = (value, key = 'value') => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.length ? [anonymise(value[0], key)] : [];
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        anonymise(childValue, childKey),
      ]),
    );
  }
  if (typeof value === 'string') return anonymiseString(value, key);
  if (typeof value === 'number') return Number.isInteger(value) ? 1 : 100.5;
  return value;
};

const main = async () => {
  const accessToken = await getAccessToken();
  const apiRoot = `${env.EFIMIS_BASE_URL.replace(/\/$/, '')}/${env.EFIMIS_TENANT_ALIAS.replace(
    /^\/|\/$/g,
    '',
  )}/api/v1`;
  const headers = { Authorization: `Bearer ${accessToken}` };

  const clients = await requestJson(
    'List clients',
    `${apiRoot}/clients?pageIndex=0&pageSize=1`,
    { headers },
  );
  const matters = await requestJson(
    'List matters',
    `${apiRoot}/matters?pageIndex=0&pageSize=1`,
    { headers },
  );

  const client = clients?.data?.rows?.[0];
  const matter = matters?.data?.rows?.[0];
  if (!client?.id || !matter?.id) {
    throw new Error('Efimis returned no client or matter record to sample');
  }

  const detailedClient = await requestJson(
    'Get client',
    `${apiRoot}/clients/${encodeURIComponent(client.id)}`,
    { headers },
  );
  const detailedMatter = await requestJson(
    'Get matter',
    `${apiRoot}/matters/${encodeURIComponent(matter.id)}`,
    { headers },
  );

  const clientListSample = anonymise(client);
  const clientDetailSample = anonymise(detailedClient.data);
  const matterListSample = anonymise(matter);
  const matterDetailSample = anonymise(detailedMatter.data);

  const eventPayload = {
    requestId: '12345678-0000-0000-0000-123456789012',
    type: 'Efimis.Mk2.App.ApiTypes.V1.MatterUpdated',
    data: {
      id: 'matter_0123456789abcdef0123456789abcdef',
      data: {
        id: 'matter_0123456789abcdef0123456789abcdef',
        title: 'Example matter for Zapier field mapping',
      },
      sourceId: 'example_source_001',
    },
  };

  const formatter = {
    JSON,
    hash: (algorithm, value) =>
      crypto.createHash(algorithm).update(value).digest('hex'),
  };

  const samples = {
    efimis_events: formatEvent(formatter, eventPayload),
    apiV1MattersGet: matterListSample,
    apiV1MatterGetById: matterDetailSample,
    apiV1ClientsGet: clientListSample,
    apiV1ClientGetById: clientDetailSample,
    apiV1MatterCreate: matterDetailSample,
    apiV1MatterUpdate: matterDetailSample,
  };

  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(samples, null, 2)}\n`);
  console.log(`Wrote anonymised samples to ${resolvedOutput}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
