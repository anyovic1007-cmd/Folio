const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const REQUIRED_PASSPHRASE = process.env.PASSPHRASE || 'Ozemoya';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'notebooks.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { notebooks: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  }
}

function readData() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Passphrase'
  });
  res.end(JSON.stringify(payload));
}

function requirePassphrase(req, res) {
  const pass = req.headers['x-passphrase'];
  if (pass !== REQUIRED_PASSPHRASE) {
    json(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return json(res, 204, {});
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, time: new Date().toISOString() });
    }

    if (parts[0] === 'notebooks') {
      if (!requirePassphrase(req, res)) return;
      const data = readData();

      if (req.method === 'GET' && parts.length === 1) {
        return json(res, 200, data.notebooks);
      }

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
        return json(res, 201, notebook);
      }

      const notebookId = parts[1];
      const notebook = data.notebooks.find(n => n.id === notebookId);
      if (!notebook) {
        return json(res, 404, { error: 'Notebook not found' });
      }

      if (req.method === 'GET' && parts.length === 2) {
        return json(res, 200, notebook);
      }

      if (req.method === 'DELETE' && parts.length === 2) {
        data.notebooks = data.notebooks.filter(n => n.id !== notebookId);
        writeData(data);
        return json(res, 200, { ok: true });
      }

      if (parts[2] === 'pages') {
        if (req.method === 'GET' && parts.length === 3) {
          return json(res, 200, notebook.pages);
        }

        if (req.method === 'POST' && parts.length === 3) {
          const body = await parseBody(req);
          const now = new Date().toISOString();
          const page = {
            id: uid(),
            title: body.title || 'Untitled Page',
            blocks: Array.isArray(body.blocks) ? body.blocks : [],
            tags: Array.isArray(body.tags) ? body.tags : [],
            date: body.date || now,
            createdAt: now,
            updatedAt: now
          };
          notebook.pages.push(page);
          notebook.updatedAt = now;
          writeData(data);
          return json(res, 201, page);
        }

        const pageId = parts[3];
        const page = notebook.pages.find(p => p.id === pageId);
        if (!page) {
          return json(res, 404, { error: 'Page not found' });
        }

        if (req.method === 'GET' && parts.length === 4) {
          return json(res, 200, page);
        }

        if (req.method === 'PUT' && parts.length === 4) {
          const body = await parseBody(req);
          const now = new Date().toISOString();
          if (typeof body.title === 'string') page.title = body.title;
          if (Array.isArray(body.blocks)) page.blocks = body.blocks;
          if (Array.isArray(body.tags)) page.tags = body.tags;
          if (typeof body.date === 'string') page.date = body.date;
          page.updatedAt = now;
          notebook.updatedAt = now;
          writeData(data);
          return json(res, 200, page);
        }

        if (req.method === 'DELETE' && parts.length === 4) {
          notebook.pages = notebook.pages.filter(p => p.id !== pageId);
          notebook.updatedAt = new Date().toISOString();
          writeData(data);
          return json(res, 200, { ok: true });
        }
      }
    }

    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    return json(res, 400, { error: err.message || 'Bad request' });
  }
});

server.listen(PORT, () => {
  console.log(`Notebook backend running on http://localhost:${PORT}`);
});
