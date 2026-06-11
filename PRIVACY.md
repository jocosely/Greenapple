# Privacy

Greenapple is designed as a local-first desktop app.

## What stays on your computer

- Saved places, recent places, route settings, and color themes are stored in your browser/WebView local storage.
- Device connection state is used locally to talk to your connected development device.
- Tunnel and command logs are local only. On Windows native builds, they may be written under `%LOCALAPPDATA%\Greenapple`.

## Network requests

Greenapple does not include accounts, analytics, advertising SDKs, or app telemetry.

The map UI can make requests to map providers when you use the map, search, or road routing:

- OpenStreetMap/CARTO tiles for the default map.
- Nominatim/OSRM-style public services if configured by the app code for search or routing.

Those providers may receive map viewport, search text, or route coordinates as part of normal map functionality.

## Secrets

- Do not commit `.env` files.
- Do not commit personal device logs, screenshots with serial numbers, or local build folders.
- The repository intentionally does not bundle a Python virtual environment, private keys, or local tokens.

## Deleting local data

Use your browser/WebView developer storage tools or delete the app data folder for Greenapple. On Windows native builds, local app data is stored under `%LOCALAPPDATA%\Greenapple`.
