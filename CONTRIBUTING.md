# Contributing

Thank you for helping improve the Efimis Zapier integration.

## Set up the project

Use Node.js 22 and Zapier Platform CLI 19.1.0. From the repository root:

```bash
npm install --global zapier-platform-cli@19.1.0
cd src
npm ci
```

The included Dev Container provides the same versions automatically.

## Make and verify changes

- Keep changes focused and add or update tests for changed behaviour.
- Do not commit credentials, `.env` files, `.zapierapprc`, or real customer data.
- Keep committed Zapier samples static, synthetic, and anonymised.
- Run `npm run check` and `npm audit --audit-level=high` from `src` before opening a pull request.
- Describe the user-visible effect and the checks you ran in the pull request.

Use an Efimis sandbox—not a production tenant—for manual integration testing.

## Report security issues privately

Do not include suspected vulnerabilities in a public issue or pull request. Follow
the private reporting instructions in [`SECURITY.md`](SECURITY.md).
