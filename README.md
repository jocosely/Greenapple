# Greenapple

Greenapple is a desktop map tool for setting and testing location routes on connected developer devices. It is built around a dark map, saved places, route playback, patrol routes, and a native Windows WebView2 app.

No accounts. No subscriptions. No telemetry.

## Setup

Install dependencies:

```powershell
npm install
```

Run the local UI:

```powershell
npm run dev
```

Build the web app:

```powershell
npm run build
```

Build the native Windows app:

```powershell
npm run publish:native
```

The native build is written to:

```text
../../outputs/Greenapple-Native-WebView2
```

## Requirements

- Node.js 20+
- npm
- .NET 9 SDK
- Microsoft Edge WebView2 Runtime
- Optional: Python with `pymobiledevice3` for iPhone developer-device workflows

## Map token

A Mapbox token is optional. The app can run without one.

If you want to use one locally, copy `.env.example` to `.env` and set:

```text
VITE_MAPBOX_TOKEN=
```

Do not commit `.env`.

## Device tools

For iPhone workflows, install `pymobiledevice3` yourself and point Greenapple at that Python install:

```powershell
$env:GREENAPPLE_PYTHON="C:\Path\To\Python\python.exe"
$env:GREENAPPLE_TUNNEL_PYTHON="C:\Path\To\Python313\python.exe"
```

Keep local virtual environments, logs, device identifiers, and tunnel output out of Git.

## Privacy

See [PRIVACY.md](PRIVACY.md).

Greenapple stores app settings locally. Map, search, and route features may contact whichever map/routing providers are configured.

## Before pushing

```powershell
npm run typecheck
npm run build
npm audit
```

Check that `.env`, logs, build output, and local device data are not staged.

## License

MIT
