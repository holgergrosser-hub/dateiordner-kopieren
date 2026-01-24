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

Netlify → Site settings → Environment variables setzen:

- **Empfohlen (für Proxy):** `GAS_URL=https://.../exec`
- Alternativ: `VITE_GAS_URL=https://.../exec` (wird auch vom Proxy gelesen)

Wichtig: Wenn du **nur** `GAS_URL` setzt (Proxy), ist **kein** Rebuild für die Function nötig.
Wenn du `VITE_GAS_URL` im Frontend nutzen willst, danach einmal **"Clear cache and deploy"** auslösen,
weil Vite Environment Variables beim Build in das Bundle geschrieben werden.

### WICHTIG: Trennung sauber halten (Option B)

Damit ihr nicht aus Versehen wieder die falsche App deployed (z.B. das Hauptprojekt `nc-rescue`), richtet diese Webapp als **eigene Netlify Site** ein:

- **Base directory:** `_external/dateiordner-kopieren`
- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Functions directory:** `netlify/functions`

Zusatz (für Netlify Deployments / Custom Domains):
- `VITE_USE_NETLIFY_PROXY=true` (ist in `netlify.toml` bereits gesetzt)

Erwarteter Endpoint in Production: `/.netlify/functions/gas-proxy`

Wenn dieser Endpoint fehlt, zeigt die App ab jetzt eine rote Fehlermeldung (Guardrail).

### Fallback (wenn `VITE_GAS_URL` im Build leer ist)

Die App zeigt dann oben ein Eingabefeld, in das du die GAS-URL einmalig eintragen kannst (wird im Browser gespeichert).

Hinweis: Wenn du das Apps Script änderst, musst du eine neue Bereitstellung erstellen und die URL ggf. aktualisieren.

### Actions (API)

Die Web-App spricht mit GAS über einen `action`-Parameter.

- `getFolderInfo` → `{ sourceUrl }`
- `copyFolderStart` → `{ sourceUrl, newFolderName }` → startet einen Async-Job, gibt `jobId` zurück
- `copyFolderStatus` → `{ jobId }` → Polling, liefert `status: running|done|error` + `progress`
- `listFiles` → `{ folderId }` → Dateien im Alt-Ordner (rekursiv, sync – kann bei großen Ordnern timeouten)
- `listFilesStart` → `{ folderId }` → startet Dateiliste-Job (async), gibt `jobId` zurück
- `listFilesStatus` → `{ jobId }` → Polling, liefert `files`-Chunks + `progress`
- `renameFiles` → `{ folderId, searchPattern, replacePattern }`

Hinweis: Lokal (ohne Netlify Proxy) wird weiterhin das Legacy-Action `copyFolder` synchron genutzt.

### Apps Script Code

Eine passende Referenz-Implementierung liegt in `apps-script/Code.gs` (im Repo) und kann 1:1 in ein GAS-Projekt kopiert werden.

Wichtig für große Ordner: Das Kopieren läuft in kleinen Schritten bei jedem `copyFolderStatus`-Poll weiter, damit keine HTTP-Timeouts entstehen (kein Trigger nötig).
