'use strict';

const { getSuccessfulData } = require('./efimis_response');
const { buildEfimisApiUrl } = require('./efimis_url');

const getResponseData = (response) => response.json ?? response.data;

const getConnectionData = (result, bundle) => {
  const firmAlias = bundle.authData.firm_alias;

  if (typeof result === 'string') {
    const reason = result.trim();
    throw new Error(
      reason || 'Authentication test returned an invalid Efimis response.',
    );
  }

  const data = getSuccessfulData(result, 'Authentication test');
  const firmName =
    typeof data?.firmName === 'string' ? data.firmName.trim() : '';

  return {
    firm_alias: firmAlias,
    ...(firmName ? { firmName } : {}),
  };
};

const test = async (z, bundle) => {
    const response = await z.request({
        url: buildEfimisApiUrl(bundle, 'tenants'),
        method: 'GET'
    });
    response.throwForStatus();
    const result = getResponseData(response);
    return getConnectionData(result, bundle);
}

const getEfimisAuthToken = async (z, bundle) => {
  const response = await z.request({
    url: process.env.AUTH_URL,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: {
      grant_type: 'client_credentials',
      scope: process.env.SCOPES,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
    },
  });

  response.throwForStatus();
  const token = getResponseData(response)?.access_token;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Efimis authentication did not return an access token.');
  }

  return {
    sessionKey: token,
  };
};

const includeSessionKeyHeader = (request, z, bundle) => {
   if (bundle.authData?.sessionKey && !request.headers?.Authorization) {
    request.headers = {
      ...request.headers,
      Authorization: `Bearer ${bundle.authData.sessionKey}`,
    }
  }
  return request;
};

module.exports = {
  config: {
    type: 'session',
    sessionConfig: { perform: getEfimisAuthToken },
    fields: [
        {
            key: 'firm_alias',
            type: 'string',
            required: true,
            label: 'Firm Alias',
            helpText: 'Enter the firm alias used in your Efimis API URL. See the [Efimis developer portal](https://developer.efimis.com/) for onboarding information.',
        },
    ],
    test,
    connectionLabel: (z, bundle) =>
      `Efimis - ${bundle.inputData.firmName || bundle.inputData.firm_alias}`,
  },
  befores: [includeSessionKeyHeader],
  afters: [],
};
