# Security

## Reporting

Please report security issues privately to the project maintainer before opening a public issue.

## Safe issue reports

When filing issues, avoid sharing:

- iPhone serial numbers or device identifiers.
- Personal coordinates, home/work locations, or route screenshots.
- `.env` files, API tokens, logs, or local paths that identify your machine.

## Device tooling

Greenapple can call local developer-device tooling such as `pymobiledevice3` when you choose to connect a device. Review commands before running elevated tunnel helpers, and only use tools installed from sources you trust.

The app should not require accounts, cloud sync, or bundled private credentials.
