# Efimis Zapier Integration

This repository contains a reference Efimis integration for [Zapier](https://developer.zapier.com/). It uses the [Efimis API](https://developer.efimis.com/) for authentication, searches, actions, dynamic dropdowns, and webhook subscriptions.

This is not an official Efimis app in the Zapier App Directory. Each adopter registers and maintains their own private Zapier integration from this repository. A firm can invite its own testers or users to that private integration through Zapier if needed.

## What the integration provides

- A `Webhook Event` trigger for receiving Efimis events.
- Client and matter searches.
- Matter create and update actions.
- Dynamic dropdowns for divisions, matter types, clients, matters, and billing contacts.
- Static, anonymised samples for every trigger, search, and action.

## Prerequisites

- An Efimis sandbox tenant.
- An Efimis integration with a client ID, client secret, API scope, API URL, and authentication URL.
- A [Zapier developer account](https://developer.zapier.com/).
- Git.
- Either:
  - Docker, Visual Studio Code, and the Dev Containers extension; or
  - Node.js 22 and `zapier-platform-cli` 19.1.0.

If you do not have an Efimis sandbox or integration credentials, contact `connections@efimis.com`.

## Development setup

### Recommended: Dev Container

The included Dev Container uses Node.js 22 and installs the Zapier Platform CLI automatically.

```bash
git clone https://github.com/efimis-dev/efimis-zapier-integration.git
cd efimis-zapier-integration
code .
```

In Visual Studio Code, run `Dev Containers: Reopen in Container` from the Command Palette. Then install the project dependencies:

```bash
cd src
npm ci
```

### Local setup

Install Node.js 22, then:

```bash
npm install --global zapier-platform-cli@19.1.0
git clone https://github.com/efimis-dev/efimis-zapier-integration.git
cd efimis-zapier-integration/src
npm ci
```

All Zapier commands in this README must be run from the `src` directory.

## Register or link a private Zapier integration

Log in:

```bash
zapier-platform login
```

`login` stores the Zapier deploy key in your user profile. It does not link this checkout to an integration.

If you are linking this checkout to an existing Zapier integration:

```bash
zapier-platform link
```

If you are creating a new integration instead:

```bash
zapier-platform register "Efimis"
```

`register` and `link` create `src/.zapierapprc`, which identifies the private Zapier integration managed by this checkout. If the file already exists and points to the correct integration, do not register or link again. Never commit `.zapierapprc`.

## Configure Zapier environment variables

Each deployed Zapier version requires the following variables:

| Variable | Description |
|---|---|
| `API_URL` | Regional Efimis API origin only, such as `https://api.au.efimis.com` or `https://api.uk.efimis.com`; do not include the tenant alias or `/api/v1` |
| `AUTH_URL` | Complete Efimis OAuth token endpoint supplied with the integration credentials |
| `SCOPES` | OAuth scope supplied with the integration credentials, typically ending in `/.default` |
| `CLIENT_ID` | Efimis integration client ID |
| `CLIENT_SECRET` | Efimis integration client secret |

Set these under **Build → Advanced** for the relevant version in the [Zapier Developer Platform](https://developer.zapier.com/).

For a newly registered integration, push its first private version if necessary to make that version visible in the developer platform, then configure these variables before connecting an Efimis account or running a Zap. Environment variables are version-specific; Zapier copies them forward when a subsequent version is pushed, but later edits apply only to the selected version.

The firm alias is not an application environment variable. Each user enters their `firm_alias` when creating an Efimis connection in Zapier.

Never commit credentials or `.env` files.

## Test and validate

Run the unit and schema tests:

```bash
npm test -- --runInBand
```

Run Zapier's integration checks:

```bash
zapier-platform validate
```

Both commands should pass before pushing a version.

To run both in sequence:

```bash
npm run check
```

GitHub Actions runs the tests, local Zapier structural validation, and a dependency
audit on pushes and pull requests. These checks do not require Efimis credentials
or a linked Zapier integration. The workflow uses `validate --without-style`;
run `zapier-platform validate` manually for the additional checks that send the
app definition to Zapier.

For contribution and vulnerability-reporting guidance, see
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).

## Regenerate anonymised static samples

The committed samples are in `src/samples/static_samples.json`. They were derived from Efimis API response structures, with identifying and sensitive values replaced by synthetic data.

The generator:

- Authenticates to Efimis.
- Makes read-only client and matter API requests.
- Keeps raw responses in memory only.
- Applies best-effort anonymisation before writing data.
- Does not create or update Efimis records.

Use sandbox credentials only; do not run the generator against a production tenant. Put the Efimis sandbox values in a `.env` file outside this repository containing:

| Generator variable | Zapier equivalent |
|---|---|
| `EFIMIS_AUTH_URL` | `AUTH_URL` |
| `EFIMIS_CLIENT_ID` | `CLIENT_ID` |
| `EFIMIS_CLIENT_SECRET` | `CLIENT_SECRET` |
| `EFIMIS_API_SCOPE` | `SCOPES` |
| `EFIMIS_BASE_URL` | `API_URL` |
| `EFIMIS_TENANT_ALIAS` | Connection `firm_alias` |

From the `src` directory:

```bash
npm run samples:generate -- \
  --env /path/to/efimis.env \
  --output samples/static_samples.json
```

On Windows PowerShell, use a Windows path:

```powershell
npm.cmd run samples:generate -- `
  --env C:\path\to\.env `
  --output samples\static_samples.json
```

Treat generated output as potentially sensitive until it has been manually inspected. Review every field for identifying or confidential values before committing it, then rerun the tests and validator.

## Push a version to Zapier

For the first push to a newly registered private integration, keep the version already present in `src/package.json` and run:

```bash
npm test -- --runInBand
zapier-platform validate
zapier-platform push
```

Zapier integration versions are immutable. Before pushing a subsequent normal version, increment the package version:

```bash
npm version patch --no-git-tag-version
```

Then test, validate, and upload the new version:

```bash
npm test -- --runInBand
zapier-platform validate
zapier-platform push
```

For an isolated development build, use a snapshot instead:

```bash
zapier-platform push --snapshot dropdown-testing
```

`push` builds and uploads a private integration version. After pushing:

1. Confirm that the version has all required environment variables.
2. Connect an Efimis sandbox account in Zapier.
3. Test authentication, searches, actions, dropdowns, and webhook subscription/unsubscription in the Zap editor.
4. Keep the version private for this repository's self-managed deployment model. Zapier promotion is only for maintainers intentionally pursuing an official App Directory listing and carries additional publishing requirements.

## Using the integration

### Webhook Event trigger

The trigger requires:

- A newly generated random webhook secret in canonical GUID form.
- A comma-separated list of supported Efimis event names.

Generate a different random GUID for each Zap. Do not use the example GUID from documentation, reuse the Efimis `CLIENT_SECRET`, or share a webhook secret between Zaps. For example, use `uuidgen` on Linux/macOS or `[guid]::NewGuid()` in PowerShell.

The webhook identifier is generated automatically from Zapier's Zap metadata, with its unique callback URL used as a fallback. Users do not need to create or enter one.

Use fully qualified event names such as `Efimis.Mk2.Accounting.V1.MatterUpdated`. See the [Efimis Webhooks API documentation](https://developer.efimis.com/api/webhooks/) for subscription guidance and the current list of supported events.

Each active Zap creates one Efimis webhook subscription. Efimis permits a maximum of five webhook subscriptions per tenant, so disable unused Zaps before creating replacements.

Incoming deliveries are accepted only when the Efimis signature, timestamp,
tenant alias, and request ID headers are valid. Efimis may deliver an event more
than once, so the trigger derives Zapier's event ID from the canonical event
payload rather than the per-delivery request ID. This lets Zapier deduplicate
retries while keeping distinct payloads separate.

The `raw_payload` output contains the complete event payload and may include sensitive client, matter, invoice, or work-item data. Only map it into steps that are authorised to receive that information, and ensure Zapier task-history access and retention follow the firm's data-handling policy.

### Searches and actions

The integration currently provides:

- Find clients.
- Get a client by ID.
- Find matters.
- Get a matter by ID.
- Create a matter.
- Update a matter.

ID fields use live Efimis dropdowns so users can select readable names instead of manually copying internal identifiers.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
