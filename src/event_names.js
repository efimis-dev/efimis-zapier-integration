'use strict';

const PUBLIC_EVENT_PREFIX = 'Efimis.Mk2.';
const API_EVENT_PREFIX = 'PE.Mk2.';

const replacePrefix = (eventType, sourcePrefix, targetPrefix) => {
  if (
    typeof eventType !== 'string' ||
    !eventType.toLowerCase().startsWith(sourcePrefix.toLowerCase())
  ) {
    return eventType;
  }

  return `${targetPrefix}${eventType.slice(sourcePrefix.length)}`;
};

const toPublicEventType = (eventType) =>
  replacePrefix(eventType, API_EVENT_PREFIX, PUBLIC_EVENT_PREFIX);

const toApiEventType = (eventType) =>
  replacePrefix(eventType, PUBLIC_EVENT_PREFIX, API_EVENT_PREFIX);

const toPublicEventPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const publicPayload = { ...payload };
  if (Object.prototype.hasOwnProperty.call(publicPayload, 'Type')) {
    publicPayload.Type = toPublicEventType(publicPayload.Type);
  }
  if (Object.prototype.hasOwnProperty.call(publicPayload, 'type')) {
    publicPayload.type = toPublicEventType(publicPayload.type);
  }
  return publicPayload;
};

module.exports = {
  toApiEventType,
  toPublicEventPayload,
  toPublicEventType,
};
