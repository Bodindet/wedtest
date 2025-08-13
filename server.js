const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const dataFile = path.join(__dirname, 'users.json');
if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, '[]');
}

function readUsers() {
  return JSON.parse(fs.readFileSync(dataFile));
}

function writeUsers(users) {
  fs.writeFileSync(dataFile, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verify;
}

const sessions = {};

function send(res, status, data, contentType = 'application/json') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(contentType === 'application/json' ? JSON.stringify(data) : data);
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, 'Not found', 'text/plain');
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript'
    };
    send(res, 200, data, types[ext] || 'text/plain');
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const staticFiles = ['/', '/home.html', '/about.html', '/analyzer.html', '/database.html', '/technology.html', '/script.js', '/style.css', '/login.html', '/register.html', '/dashboard.html'];
  if (req.method === 'GET' && staticFiles.includes(parsed.pathname)) {
    const file = parsed.pathname === '/' ? '/home.html' : parsed.pathname;
    return serveFile(res, path.join(__dirname, file));
  }

  if (req.method === 'POST' && parsed.pathname === '/register') {
    try {
      const { username, password } = await parseBody(req);
      if (!username || !password) return send(res, 400, { error: 'username and password required' });
      const users = readUsers();
      if (users.find(u => u.username === username)) return send(res, 400, { error: 'user exists' });
      const passwordHash = hashPassword(password);
      const id = users.length ? users[users.length - 1].id + 1 : 1;
      users.push({ id, username, passwordHash });
      writeUsers(users);
      return send(res, 201, { status: 'registered' });
    } catch (err) {
      return send(res, 500, { error: 'server error' });
    }
  }

  if (req.method === 'POST' && parsed.pathname === '/login') {
    try {
      const { username, password } = await parseBody(req);
      const users = readUsers();
      const user = users.find(u => u.username === username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return send(res, 401, { error: 'invalid credentials' });
      }
      const token = crypto.randomBytes(16).toString('hex');
      sessions[token] = user.username;
      return send(res, 200, { token });
    } catch (err) {
      return send(res, 500, { error: 'server error' });
    }
  }

  if (req.method === 'GET' && parsed.pathname === '/quote') {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || !sessions[token]) return send(res, 401, { error: 'unauthorized' });
    try {
      const response = await fetch('https://api.quotable.io/random');
      const data = await response.json();
      return send(res, 200, data);
    } catch (err) {
      return send(res, 500, { error: 'unable to fetch quote' });
    }
  }

  send(res, 404, { error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

