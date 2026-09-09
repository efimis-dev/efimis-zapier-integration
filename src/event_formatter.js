'use strict';

const {
  toPublicEventPayload,
  toPublicEventType,
} = require('./event_names');

const getNestedValue = (object, keys) =>
  keys.reduce(
    (value, key) => (value && value[key] !== undefined ? value[key] : undefined),
    object,
  );

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const removeDeliveryRequestId = (payload) =>
  Object.fromEntries(
    Object.entries(payload || {}).filter(
      ([key]) => key.toLowerCase() !== 'requestid',
    ),
  );

const getDeduplicationId = (z, payload, eventType, recordId, sourceId) => {
  const stableEvent = canonicalize({
    eventType: eventType || null,
    recordId: recordId || null,
    sourceId: sourceId || null,
    payload: removeDeliveryRequestId(payload),
  });
  return z.hash('sha256', z.JSON.stringify(stableEvent));
};

const formatEvent = (z, payload) => {
  const publicPayload = toPublicEventPayload(payload);
  const eventType = toPublicEventType(
    publicPayload.Type || publicPayload.type,
  );
  const eventData = publicPayload.Data || publicPayload.data || {};
  const recordData = eventData.data || eventData.Data || {};
  const recordId = eventData.id || eventData.Id || recordData.id || recordData.Id;
  const sourceId =
    eventData.sourceId ||
    eventData.SourceId ||
    recordData.sourceId ||
    recordData.SourceId;
  const matterId = eventType?.includes('Matter') ? recordId : undefined;
  const id = getDeduplicationId(
    z,
    publicPayload,
    eventType,
    recordId,
    sourceId,
  );

  return {
    id,
    event_type: eventType,
    record_id: recordId,
    source_id: sourceId,
    matter_id: matterId,
    matter_title:
      recordData.title ||
      recordData.Title ||
      getNestedValue(eventData, ['matter', 'title']) ||
      getNestedValue(eventData, ['Matter', 'Title']),
    raw_payload: z.JSON.stringify(publicPayload),
  };
};

module.exports = { formatEvent };
