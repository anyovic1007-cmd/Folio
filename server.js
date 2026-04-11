const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';
const REQUIRED_PASSPHRASE = process.env.PASSPHRASE || 'Ozemoya';

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'notebooks.json');

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

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Passphrase'
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unable to load file' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      ...(process.env.NODE_ENV !== 'production'
        ? {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0'
          }
        : {})
    });
    res.end(content);
  });
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(res, 204, {});
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return sendFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
    }

    if (parts[0] === 'notebooks') {
      if (!checkAuth(req, res)) return;

      const data = readData();

      if (req.method === 'GET' && parts.length === 1) {
        return send(res, 200, data.notebooks);
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

        return send(res, 201, notebook);
      }

      const notebookId = parts[1];
      const notebook = data.notebooks.find(n => n.id === notebookId);

      if (!notebook) {
        return send(res, 404, { error: 'Notebook not found' });
      }

      if (req.method === 'GET' && parts.length === 2) {
        return send(res, 200, notebook);
      }

      if (req.method === 'DELETE' && parts.length === 2) {
        data.notebooks = data.notebooks.filter(n => n.id !== notebookId);
        writeData(data);
        return send(res, 200, { ok: true });
      }

      if (parts[2] === 'pages') {
        if (req.method === 'GET' && parts.length === 3) {
          return send(res, 200, notebook.pages);
        }

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

        if (req.method === 'DELETE') {
          notebook.pages = notebook.pages.filter(p => p.id !== pageId);
          notebook.updatedAt = new Date().toISOString();

          writeData(data);
          return send(res, 200, { ok: true });
        }
      }
    }

    return send(res, 404, { error: 'Route not found' });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
