'use strict';

const getConfiguredApiUrl = () => {
  const apiUrl = String(process.env.API_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!apiUrl) {
    throw new Error('The Efimis API_URL environment variable is required.');
  }
  return apiUrl;
};

const getFirmAlias = (bundle) => {
  const firmAlias = String(bundle.authData?.firm_alias || '').trim();
  if (!firmAlias) {
    throw new Error('An Efimis firm alias is required.');
  }
  return firmAlias;
};

const encodePathSegment = (segment) => {
  if (segment === undefined || segment === null || String(segment) === '') {
    throw new Error('Efimis API path segments cannot be empty.');
  }
  return encodeURIComponent(String(segment));
};

const buildEfimisApiUrl = (bundle, ...segments) => {
  const baseUrl = `${getConfiguredApiUrl()}/${encodePathSegment(
    getFirmAlias(bundle),
  )}/api/v1`;
  return segments.length
    ? `${baseUrl}/${segments.map(encodePathSegment).join('/')}`
    : baseUrl;
};

module.exports = { buildEfimisApiUrl };
