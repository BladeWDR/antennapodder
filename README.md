# AntennaPodder

AntennaPodder is a lightweight, standalone companion web player and synchronization server for the [AntennaPod](https://antennapod.org/) Android application.

It is not associated in any way with the AntennaPod or gPodder projects.

**Full Disclosure: This app was 100% coded with Gemini. Use at your own risk.**

I am vehemently opposed to exposing this directly directly to the internet. Put it behind a firewall and access the sync endpoint over a VPN.

## Screenshots

![screenshot showing the web interface of AntennaPodder](docs/screenshot.png)

---

## Key Features

- **Reliable 2-Way Sync with AntennaPod:**
  - Changes in AntennaPod (subscriptions, playback progress, played status) sync to the web app.
  - Changes in the web app (adding feeds, removing feeds, listening, scrubbing, marking played) immediately sync back to AntennaPod.
  - Dual protocol support: compatible with both AntennaPod's **Nextcloud** provider and standard **gpodder.net** provider.
- **Audio and Video Playback:**
  - Full HTML5 player for both audio podcasts and video podcasts (MP4, WebM, M4V).
  - High-resolution artwork for audio episodes and inline video player for video episodes.
  - MediaSession API integration for hardware media keys and lock screen controls.
- **Customizable Player Controls:**
  - Previous episode, skip back X seconds, play / pause, skip forward X seconds, next episode.
  - User-configurable skip forward and backward seconds (via the Settings panel).
  - Variable playback speed controls (0.75x, 1.0x, 1.25x, 1.5x, 1.75x, 2.0x).
  - Volume slider with one-click mute toggle.
  - Persistent bottom player bar with expandable full Now Playing screen.
- **Feed and Library Management:**
  - Easily subscribe by RSS / Atom feed URL.
  - Integrated podcast directory search (search podcasts by name and subscribe with one click).
  - Unsubscribing immediately syncs feed removal to AntennaPod.
  - Periodic background feed refresh keeps episodes up to date.
- **Themes:**
  - Designed with the **Catppuccin Mocha** dark palette by default.
  - One-click toggle to **Catppuccin Latte** light palette.
- **Minimal Dependencies & Lightweight Footprint:**
  - Built with Node.js and standard built-in modules (`node:http`, `node:sqlite`, `node:crypto`).
  - Only a single production dependency: [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser).
  - Zero external database services needed (SQLite with WAL mode).

---

## Installation via Docker (Recommended)

### Using Docker Compose

Create a `docker-compose.yml` file:

```yaml
services:
  antennapodder:
    image: antennapodder:latest
    build: .
    container_name: antennapodder
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - DATA_DIR=/data
      - ANTENNAPODDER_USER=admin
      - ANTENNAPODDER_PASS=admin
    volumes:
      - antennapodder_data:/data

volumes:
  antennapodder_data:
    driver: local
```

Start the container:

```bash
docker compose up -d
```

Open your browser at `http://localhost:3000` (or `http://<your-server-ip>:3000`).

### Using Docker CLI

```bash
docker build -t antennapodder .

docker run -d \
  --name antennapodder \
  --restart unless-stopped \
  -p 3000:3000 \
  -v antennapodder_data:/data \
  -e ANTENNAPODDER_USER=admin \
  -e ANTENNAPODDER_PASS=admin \
  antennapodder
```

---

## Connecting AntennaPod to AntennaPodder

AntennaPodder supports two setup methods in AntennaPod:

### Method 1: Using the "Nextcloud" Provider in AntennaPod

1. Open AntennaPod on your Android device.
2. Navigate to **Settings** > **Synchronization** > **Provider** and select **Nextcloud**.
3. Enter your server URL:
   ```text
   http://<your-server-ip>:3000
   ```
   (or your HTTPS domain if running behind a reverse proxy like Caddy, Nginx, or Traefik).
4. Enter your username and password.
5. Tap **Log in**. AntennaPod will synchronize your subscriptions and playback progress.

### Method 2: Using the "gpodder.net" Provider in AntennaPod

1. Open AntennaPod on your Android device.
2. Navigate to **Settings** > **Synchronization** > **Provider** and select **gpodder.net**.
3. Tap **Server URL** (or Custom Server) and enter:
   ```text
   http://<your-server-ip>:3000
   ```
4. Enter your username and password.
5. Tap **Log in**.

---

## Configuration & Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port the HTTP server listens on |
| `DATA_DIR` | `./data` | Directory where SQLite database (`antennapodder.db`) is stored |
| `ANTENNAPODDER_USER` | `admin` | Initial admin username created on first launch |
| `ANTENNAPODDER_PASS` | `admin` | Initial admin password created on first launch |

Password and seek skip duration settings can also be modified in the Web UI Settings panel.

---

## Development & Testing

### Running locally

Requirements: Node.js 22+

```bash
npm install
npm start
```

### Running tests

The test suite runs unit and integration tests using Node's built-in test runner:

```bash
npm test
```

---

## Project Structure

- [`src/server.js`](file:///home/scott/git/antennapodder/src/server.js): HTTP server, routing, static asset delivery, and background feed refresher.
- [`src/db.js`](file:///home/scott/git/antennapodder/src/db.js): SQLite database schema, password hashing, subscription deltas, and episode action logging.
- [`src/feed-parser.js`](file:///home/scott/git/antennapodder/src/feed-parser.js): Robust RSS 2.0 and Atom podcast feed parser with iTunes namespace support.
- [`src/gpodder.js`](file:///home/scott/git/antennapodder/src/gpodder.js): gPodder API v2 endpoints and Nextcloud gpoddersync compatibility routes.
- [`src/web-api.js`](file:///home/scott/git/antennapodder/src/web-api.js): Web client REST API for authentication, library, playback states, search, and settings.
- [`public/`](file:///home/scott/git/antennapodder/public): Web interface assets (HTML, Catppuccin CSS theme, dual audio/video player).
- [`test/`](file:///home/scott/git/antennapodder/test): Automated test suites for database, gPodder sync, feed parsing, and end-to-end sync.
