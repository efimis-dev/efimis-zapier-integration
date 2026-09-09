# Changelog

## 2.0.4

- Use Efimis-branded event names in Zapier inputs, outputs, documentation, and samples while translating them to the current Efimis API namespace.
- Accept Efimis-branded webhook headers while retaining compatibility with existing Efimis webhook deliveries.

## 2.0.3

- Accept Zapier's `Http-`-prefixed, Camel-Cased inbound webhook headers when verifying Efimis deliveries.
- Add regression coverage for a correctly signed MatterUpdated delivery using Zapier-normalized header names.

## 2.0.2

- Reject Efimis tenant error strings during connection testing and surface the returned reason.
- Preserve successful tenant-envelope validation and stable firm-name or firm-alias connection labels.

## 2.0.1

- Accept non-empty JSON string responses from the Efimis tenant endpoint during connection testing. This behaviour is superseded by 2.0.2.
- Use the firm alias as the connection label when the tenant response does not include a firm name.

## 2.0.0

- Update trigger/efimis_events with automatic subscription management, signature verification, retry-safe deduplication, consistent output fields, and samples covering all supported Efimis event families.
- Update search/apiV1ClientsGet and search/apiV1ClientGetById with validated Efimis response handling, safe URL construction, and anonymised samples.
- Update search/apiV1MattersGet and search/apiV1MatterGetById with validated Efimis response handling, safe URL construction, and anonymised samples.
- Update create/apiV1MatterCreate to omit blank optional values and return the created matter record.
- Update create/apiV1MatterUpdate to preserve explicit field clears and return the complete updated matter record.
- Add live selectors for divisions, matter types, clients, matters, and billing contacts.
- Improve session authentication, error messages, documentation, testing, and development tooling.
