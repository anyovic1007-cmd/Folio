const http = require('http');
const { MongoClient, ObjectId } = require('mongodb');

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';
const REQUIRED_PASSPHRASE = process.env.PASSPHRASE || 'Ozemoya';
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI environment variable is not set.');
  process.exit(1);
}

let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('folio');
  console.log('Connected to MongoDB');
}

function notebooks() { return db.collection('notebooks'); }

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
  const fs = require('fs');
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unable to load file' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
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
      if (body.length > 1e6) { req.destroy(); reject(new Error('Too large')); }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Strip MongoDB _id before sending to client
function clean(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true });
    }

    // Serve frontend
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const path = require('path');
      return sendFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
    }

    // API routes
    if (parts[0] === 'notebooks') {
      if (!checkAuth(req, res)) return;

      // GET /notebooks
      if (req.method === 'GET' && parts.length === 1) {
        const docs = await notebooks().find({}).toArray();
        return send(res, 200, docs.map(clean));
      }

      // POST /notebooks
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
        await notebooks().insertOne(notebook);
        return send(res, 201, clean(notebook));
      }

      const notebookId = parts[1];
      const notebook = await notebooks().findOne({ id: notebookId });
      if (!notebook) return send(res, 404, { error: 'Notebook not found' });

      // GET /notebooks/:id
      if (req.method === 'GET' && parts.length === 2) {
        return send(res, 200, clean(notebook));
      }

      // DELETE /notebooks/:id
      if (req.method === 'DELETE' && parts.length === 2) {
        await notebooks().deleteOne({ id: notebookId });
        return send(res, 200, { ok: true });
      }

      // Pages routes
      if (parts[2] === 'pages') {

        // GET /notebooks/:id/pages
        if (req.method === 'GET' && parts.length === 3) {
          return send(res, 200, notebook.pages || []);
        }

        // POST /notebooks/:id/pages
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
          await notebooks().updateOne(
            { id: notebookId },
            { $push: { pages: page }, $set: { updatedAt: now } }
          );
          return send(res, 201, page);
        }

        const pageId = parts[3];

        // GET /notebooks/:id/pages/:pageId
        if (req.method === 'GET' && parts.length === 4) {
          const page = (notebook.pages || []).find(p => p.id === pageId);
          if (!page) return send(res, 404, { error: 'Page not found' });
          return send(res, 200, page);
        }

        // PUT /notebooks/:id/pages/:pageId
        if (req.method === 'PUT' && parts.length === 4) {
          const body = await parseBody(req);
          const now = new Date().toISOString();
          const updateFields = { 'pages.$.updatedAt': now, updatedAt: now };
          if (body.title !== undefined)  updateFields['pages.$.title']  = body.title;
          if (body.blocks !== undefined) updateFields['pages.$.blocks'] = body.blocks;
          if (body.tags !== undefined)   updateFields['pages.$.tags']   = body.tags;
          if (body.date !== undefined)   updateFields['pages.$.date']   = body.date;
          await notebooks().updateOne(
            { id: notebookId, 'pages.id': pageId },
            { $set: updateFields }
          );
          const updated = await notebooks().findOne({ id: notebookId });
          const page = (updated.pages || []).find(p => p.id === pageId);
          return send(res, 200, page);
        }

        // DELETE /notebooks/:id/pages/:pageId
        if (req.method === 'DELETE' && parts.length === 4) {
          const now = new Date().toISOString();
          await notebooks().updateOne(
            { id: notebookId },
            { $pull: { pages: { id: pageId } }, $set: { updatedAt: now } }
          );
          return send(res, 200, { ok: true });
        }
      }
    }

    return send(res, 404, { error: 'Route not found' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: err.message });
  }
});

// Connect to MongoDB then start server
connectDB().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});
