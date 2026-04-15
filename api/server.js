const http = require('http');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 5000;
const REQUIRED_PASSPHRASE = process.env.PASSPHRASE || 'Ozemoya';
const MONGO_URI = process.env.MONGO_URI;

// Global variables to cache the connection
let cachedDb = null;

async function getDatabase() {
  if (cachedDb) return cachedDb;
  
  if (!MONGO_URI) throw new Error('MONGO_URI is missing!');
  
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  cachedDb = client.db('folio');
  console.log('New MongoDB Connection Established');
  return cachedDb;
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

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } 
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    const db = await getDatabase();
    const notebooksCol = db.collection('notebooks');
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const parts = url.pathname.split('/').filter(Boolean);

    // Auth Check
    const pass = req.headers['x-passphrase'];
    if (pass !== REQUIRED_PASSPHRASE) return send(res, 401, { error: 'Unauthorized' });

    // API: GET /notebooks
    if (req.method === 'GET' && parts[0] === 'notebooks' && parts.length === 1) {
      const docs = await notebooksCol.find({}).toArray();
      return send(res, 200, docs);
    }

    // API: POST /notebooks/:id/pages
    if (req.method === 'POST' && parts[0] === 'notebooks' && parts[2] === 'pages') {
      const notebookId = parts[1];
      const body = await parseBody(req);
      const page = {
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
        ...body,
        createdAt: new Date().toISOString()
      };
      
      await notebooksCol.updateOne(
        { id: notebookId },
        { $push: { pages: page }, $set: { updatedAt: new Date().toISOString() } },
        { upsert: true } // Creates notebook if it doesn't exist
      );
      return send(res, 201, page);
    }

    // API: PUT /notebooks/:id/pages/:pageId
    if (req.method === 'PUT' && parts[2] === 'pages' && parts[3]) {
      const [_, notebookId, __, pageId] = parts;
      const body = await parseBody(req);
      
      await notebooksCol.updateOne(
        { id: notebookId, 'pages.id': pageId },
        { $set: { 
            'pages.$.title': body.title, 
            'pages.$.blocks': body.blocks, 
            'pages.$.tags': body.tags,
            'pages.$.updatedAt': new Date().toISOString() 
          } 
        }
      );
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'Route not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

// For Vercel, we export the server
module.exports = server;

// For local development
if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, () => console.log(`Dev server on ${PORT}`));
}
