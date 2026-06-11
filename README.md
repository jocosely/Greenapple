<a id="readme-top"></a>

# Greenapple

<p align="center">
  <img src="public/logo.png" alt="Greenapple" width="160" />
</p>

Greenapple is a desktop map tool for testing location changes and route movement on connected developer devices. It has a dark map UI, saved places, route playback, patrol routes, and a native Windows WebView2 build.

No accounts. No subscriptions. No telemetry.

<p align="center">
  <img src="docs/greenapple-screenshot.png" alt="Greenapple desktop map interface" width="900" />
</p>

## Table of Contents

- [About The Project](#about-the-project)
  - [Built With](#built-with)
- [Features](#features)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Usage](#usage)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Privacy](#privacy)
- [License](#license)
- [Contact](#contact)
- [Acknowledgments](#acknowledgments)

## About The Project

Greenapple is meant to be a clean local app for map-based location testing. It focuses on a simple workflow: connect a developer device, pick a place or route on the map, and run that movement from the desktop.

Main features:

- Static location changes
- Route playback
- Patrol routes
- Saved and recent places
- Route speed controls
- Local app settings
- Native Windows WebView2 app

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

- React
- TypeScript
- Vite
- Tailwind CSS
- MapLibre GL
- Zustand
- .NET Windows Forms
- WebView2

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Features

### Static location

Static mode is for holding one selected location during testing. You can click the map, search for a place, or move the marker and keep that point active.

- Shows the selected place name on the map.
- Keeps the marker visible while you work.
- Saves recent places locally for quick reuse.
- Includes optional small GPS drift for more natural movement tests.

### Route playback

Route mode is for testing movement between two points. Pick a start, pick a destination, preview the path, then start the route.

- Road mode follows routed driving paths when route data is available.
- Boat mode allows direct water or off-road movement.
- Speed can be adjusted before or during movement.
- Route progress, distance, and estimated timing are shown in the controls.
- Routes can pause, resume, stop, or hold at the destination.

### Patrol routes

Patrol mode is for repeated movement across multiple stops. Add points in order and Greenapple can loop through them for longer tests.

- Useful for repeated location checks.
- Supports multi-stop paths instead of only point-to-point movement.
- Can loop back to the first point.
- Keeps the route visible while editing.

### Saved and recent places

Saved and recent places reduce repeat setup. Locations are kept locally so common test spots are easy to open again.

- Bookmark important locations.
- Open recent test locations quickly.
- Keep favorite spots separate from temporary route points.
- No account or cloud sync is required.

### Local settings

Settings are stored on the computer running the app. Greenapple is built to stay local-first and avoid account-based setup.

- Theme colors can be adjusted.
- Device display name can be changed.
- Route speed preferences are kept locally.
- Saved places and app preferences stay on the machine.

### Native Windows build

Greenapple can run as a native Windows WebView2 app. The release build ships as a single `.exe` with the web UI bundled inside it.

- No browser tab required for the packaged app.
- Uses the same interface as the local development build.
- Includes the Windows app icon and native window controls.

### Device tooling hooks

The desktop bridge is set up for local developer-device tooling. Python command paths can be configured through environment variables, and device logs or local virtual environments are not meant to be committed.

- Local command hooks are kept separate from the UI.
- Python paths can be configured per machine.
- Build output does not include local virtual environments.
- Privacy notes are documented in [PRIVACY.md](PRIVACY.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

These steps run Greenapple locally from source.

### Prerequisites

- Node.js 20+
- npm
- .NET 9 SDK
- Microsoft Edge WebView2 Runtime
- Optional: Python with `pymobiledevice3` for iPhone developer-device workflows

### Installation

Clone the repo:

```powershell
git clone https://github.com/jocosely/Greenapple.git
cd Greenapple
```

Install packages:

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

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

Open Greenapple, connect a supported developer device, then use the map controls to choose a location or route.

Route mode lets you pick route points and start movement at a selected speed. Static mode keeps the current selected location fixed. Saved places and recent places are stored locally.

For iPhone workflows, install `pymobiledevice3` yourself and point Greenapple at that Python install:

```powershell
$env:GREENAPPLE_PYTHON="C:\Path\To\Python\python.exe"
$env:GREENAPPLE_TUNNEL_PYTHON="C:\Path\To\Python313\python.exe"
```

Keep local virtual environments, logs, device identifiers, and tunnel output out of Git.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- Improve route editing
- Add more route import/export options
- Add better connection diagnostics
- Add more saved theme controls
- Package a cleaner Windows release flow

See the repository issues for planned work and bugs.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

This repo is private while the project is being cleaned up. Once it is public, contributions can go through normal pull requests.

Before pushing changes:

```powershell
npm run typecheck
npm run build
npm audit
```

Check that `.env`, logs, build output, and local device data are not staged.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Privacy

See [PRIVACY.md](PRIVACY.md).

Greenapple stores app settings locally. Map, search, and route features may contact whichever map/routing providers are configured.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Discord - `hidings.`

Project Link: [https://github.com/jocosely/Greenapple](https://github.com/jocosely/Greenapple)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

- React
- Vite
- MapLibre GL
- WebView2
- Tailwind CSS

<p align="right">(<a href="#readme-top">back to top</a>)</p>
