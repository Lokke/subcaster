# SubCaster

[![Build and Push Docker Image](https://github.com/Lokke/subcaster/actions/workflows/docker-build.yml/badge.svg)](https://github.com/Lokke/subcaster/actions/workflows/docker-build.yml)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Flokke%2Fsubcaster-blue?logo=docker)](https://github.com/Lokke/subcaster/pkgs/container/subcaster)

Web interface for radio moderators. Provides access to music from OpenSubsonic-compatible servers (Navidrome, Gonic, Ampache, Astiga, LMS, Nextcloud Music, ownCloud Music, Supysonic) with live streaming to AzuraCast.
<img width="1846" height="999" alt="Screenshot 2025-09-24 002355" src="https://github.com/user-attachments/assets/b3c522a6-95bc-417a-9f3c-15ff7dfa8fd9" />

## Features

- Music library browser for OpenSubsonic servers
- Dual-deck audio player with crossfader
- Microphone input with live mixing
- Direct streaming to AzuraCast
- Smart metadata transmission
- Browser-based interface

## License

Non-commercial use only.

See LICENSE and COMMERCIAL-LICENSE.md for details.

### Third-Party Licenses

This project uses Material Icons (MaterialIcons-Regular.woff2) provided by Google under the Apache License 2.0. See LICENSE-MATERIAL-ICONS for the full license text.

## 🐳 Docker Deployment

### Quick Start (Pre-built Image)

The easiest way to run SubCaster is using the pre-built Docker image from GitHub Container Registry:

```bash
# Pull latest image
docker pull ghcr.io/lokke/subcaster:latest

# Run with docker-compose
docker-compose -f docker-compose.env.yml up -d
```

**Image automatically rebuilds on every commit!** ✅

### Deployment Options

We provide 3 deployment configurations:

| File | Use Case | Documentation |
|------|----------|---------------|
| `docker-compose.production.yml` | Standalone (all ENV in file) | For Portainer/Remote |
| `docker-compose.env.yml` | With `.env` file | **Recommended** |
| `docker-compose.ghcr.yml` | Minimal | Manual config |

📖 **Full deployment guide:** [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md)

📖 **CI/CD setup:** [DOCKER_CI_CD.md](DOCKER_CI_CD.md)

### Environment Variables

Create a `.env` file with your configuration:

```bash
# Copy example
cp .env.example .env

# Edit with your values
nano .env
```

**Essential Variables:**

- `VITE_OPENSUBSONIC_URL` - Your music server URL
- `VITE_AZURACAST_SERVERS` - Your radio server URL(s)
- `VITE_DISCORD_CHANNEL_ID` - Discord channel for song requests (optional)

**Security Note:** 🔒
- Variables with `VITE_` prefix are **public** (embedded in frontend)
- Variables **without** `VITE_` are **private** (server-side only)
- Never put secrets in `VITE_*` variables!

**Full variable list:** See `.env.example` or [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md)

### Update to Latest Version

```bash
# Pull new image
docker-compose -f docker-compose.env.yml pull

# Restart with new version
docker-compose -f docker-compose.env.yml up -d
```

Check logs:

```bash
docker logs -f subcaster
```

## Manual Installation

Install dependencies:

```bash
npm install
```

Configure streaming in `.env`:

```env
VITE_STREAM_USERNAME=username
VITE_STREAM_PASSWORD=password
```


Start development server:

```bash
npm run dev
```


Open interface at http://localhost:5173

