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

In [src/App.jsx](src/App.jsx) muss `GAS_URL` auf die URL deiner GAS-Web-App gesetzt werden.

Hinweis: Wenn du das Apps Script änderst, musst du eine neue Bereitstellung erstellen und die URL ggf. aktualisieren.
