# OAT Notebook Journal

A lightweight notebook-style journal with a passphrase-only login and a simple JSON-backed API.

## Features
- Passphrase login (default: `Ozemoya`, enforced by backend)
- Notebook-style saved writeups view
- Create, edit, and delete entries
- Local storage for the front end
- JSON file storage for the backend API

## Project Structure
- `index.html` — Frontend UI (static)
- `server.js` — Backend API (Node.js, no deps)
- `data/notebooks.json` — Backend storage (local)

## Getting Started

### 1) Start the backend API
```bash
node server.js
```
The API runs at `http://localhost:3000`.

Optional: override the passphrase.
```bash
set PASSPHRASE=YourSecret
node server.js
```

### 2) Open the frontend
Open `index.html` directly in your browser, or run a simple static server if you prefer.

## API Endpoints (Backend)
- `GET /health`
- `GET /notebooks`
- `POST /notebooks` `{ "title": "Notebook name" }`
- `GET /notebooks/:id`
- `DELETE /notebooks/:id`
- `GET /notebooks/:id/pages`
- `POST /notebooks/:id/pages` `{ "title": "Page", "blocks": [...] }`
- `GET /notebooks/:id/pages/:pageId`
- `PUT /notebooks/:id/pages/:pageId` `{ "title": "...", "blocks": [...] }`
- `DELETE /notebooks/:id/pages/:pageId`

## Notes
- The frontend saves entries through the backend API.
- The backend stores notebook pages in `data/notebooks.json`.

## License
MIT
