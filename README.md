# dateiordner-kopieren

Kleine React/Vite-Webapp zum Kopieren/Umbenennen von Ordnern per Google Apps Script (GAS).

## Voraussetzungen

- Node.js + npm
- (optional) Google Apps Script Deployment (Web App URL)

## Setup

```bash
npm install
```

## Entwicklung

```bash
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Google Apps Script

Die App erwartet die URL deiner GAS-Web-App als Environment Variable:

- `VITE_GAS_URL=https://...`

### Lokal

Lege eine Datei `.env` an:

```bash
VITE_GAS_URL=https://script.google.com/macros/s/....../exec
```

### Netlify

Netlify → Site settings → Environment variables → `VITE_GAS_URL` setzen.

Hinweis: Wenn du das Apps Script änderst, musst du eine neue Bereitstellung erstellen und die URL ggf. aktualisieren.
