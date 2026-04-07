const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const REQUIRED_PASSPHRASE = process.env.PASSPHRASE || 'Ozemoya';

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'notebooks.json');

// -------------------- FILE SETUP --------------------
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ notebooks: [] }, null, 2));
  }
}

function readData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// -------------------- HELPERS --------------------
function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Passphrase'
  });
  res.end(JSON.stringify(data));
}

function checkAuth(req, res) {
  const pass = req.headers['x-passphrase'];
  if (pass !== REQUIRED_PASSPHRASE) {
    send(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Too large'));
      }
    });

    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// -------------------- SERVER --------------------
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(res, 204, {});
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    // ✅ ROOT ROUTE (fixes your "Not Found")
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, { message: 'Notebook API is running 🚀' });
    }

    // ✅ HEALTH CHECK
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true });
    }

    // -------------------- NOTEBOOKS --------------------
    if (parts[0] === 'notebooks') {
      if (!checkAuth(req, res)) return;

      const data = readData();

      // GET all notebooks
      if (req.method === 'GET' && parts.length === 1) {
        return send(res, 200, data.notebooks);
      }

      // CREATE notebook
      if (req.method === 'POST' && parts.length === 1) {
        const body = await parseBody(req);
        const now = new Date().toISOString();

        const notebook = {
          id: uid(),
          title: body.title || 'Untitled Notebook',
          createdAt: now,
          updatedAt: now,
          pages: []
        };

        data.notebooks.push(notebook);
        writeData(data);

        return send(res, 201, notebook);
      }

      const notebookId = parts[1];
      const notebook = data.notebooks.find(n => n.id === notebookId);

      if (!notebook) {
        return send(res, 404, { error: 'Notebook not found' });
      }

      // GET single notebook
      if (req.method === 'GET' && parts.length === 2) {
        return send(res, 200, notebook);
      }

      // DELETE notebook
      if (req.method === 'DELETE' && parts.length === 2) {
        data.notebooks = data.notebooks.filter(n => n.id !== notebookId);
        writeData(data);
        return send(res, 200, { ok: true });
      }

      // -------------------- PAGES --------------------
      if (parts[2] === 'pages') {

        // GET pages
        if (req.method === 'GET' && parts.length === 3) {
          return send(res, 200, notebook.pages);
        }

        // CREATE page
        if (req.method === 'POST' && parts.length === 3) {
          const body = await parseBody(req);
          const now = new Date().toISOString();

          const page = {
            id: uid(),
            title: body.title || 'Untitled Page',
            blocks: body.blocks || [],
            tags: body.tags || [],
            date: body.date || now,
            createdAt: now,
            updatedAt: now
          };

          notebook.pages.push(page);
          notebook.updatedAt = now;
          writeData(data);

          return send(res, 201, page);
        }

        const pageId = parts[3];
        const page = notebook.pages.find(p => p.id === pageId);

        if (!page) {
          return send(res, 404, { error: 'Page not found' });
        }

        // UPDATE page
        if (req.method === 'PUT') {
          const body = await parseBody(req);
          const now = new Date().toISOString();

          if (body.title) page.title = body.title;
          if (body.blocks) page.blocks = body.blocks;
          if (body.tags) page.tags = body.tags;
          if (body.date) page.date = body.date;

          page.updatedAt = now;
          notebook.updatedAt = now;

          writeData(data);
          return send(res, 200, page);
        }

        // DELETE page
        if (req.method === 'DELETE') {
          notebook.pages = notebook.pages.filter(p => p.id !== pageId);
          notebook.updatedAt = new Date().toISOString();

          writeData(data);
          return send(res, 200, { ok: true });
        }
      }
    }

    // ❌ FALLBACK
    return send(res, 404, { error: 'Route not found' });

  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

// -------------------- START SERVER --------------------
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
