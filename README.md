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

Wichtig: Danach einmal **"Clear cache and deploy"** auslösen, weil Vite Environment Variables beim Build in das Bundle geschrieben werden.

### Fallback (wenn `VITE_GAS_URL` im Build leer ist)

Die App zeigt dann oben ein Eingabefeld, in das du die GAS-URL einmalig eintragen kannst (wird im Browser gespeichert).

Hinweis: Wenn du das Apps Script änderst, musst du eine neue Bereitstellung erstellen und die URL ggf. aktualisieren.
