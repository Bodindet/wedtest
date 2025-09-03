const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const dataFile = path.join(__dirname, 'users.json');
const verifyFile = path.join(__dirname, 'email_verifications.json');
if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, '[]');
}
if (!fs.existsSync(verifyFile)) {
  fs.writeFileSync(verifyFile, '[]');
}

function readUsers() {
  return JSON.parse(fs.readFileSync(dataFile));
}

function writeUsers(users) {
  fs.writeFileSync(dataFile, JSON.stringify(users, null, 2));
}

function readVerifications() {
  return JSON.parse(fs.readFileSync(verifyFile));
}

function writeVerifications(list) {
  fs.writeFileSync(verifyFile, JSON.stringify(list, null, 2));
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

function generateTOTP(secret) {
  const step = 30;
  const counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'hex')).update(buf).digest();
  const offset = hmac[19] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, '0');
}

function getAuth(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !sessions[token]) return null;
  const username = sessions[token].username;
  const users = readUsers();
  const user = users.find(u => u.username === username);
  return { token, session: sessions[token], user, users };
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
  const staticFiles = ['/', '/home.html', '/about.html', '/analyzer.html', '/database.html', '/technology.html', '/script.js', '/style.css', '/login.html', '/register.html', '/dashboard.html', '/verify-success.html', '/verify-expired.html', '/profile.html'];
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
      users.push({ id, username, passwordHash, verified: false });
      writeUsers(users);
      const token = crypto.randomBytes(20).toString('hex');
      const expires = Date.now() + 30 * 60 * 1000;
      const verifs = readVerifications();
      verifs.push({ token, userId: id, expires });
      writeVerifications(verifs);
      console.log(`Verify email for ${username}: http://localhost:${PORT}/api/auth/verify-email?token=${token}`);
      return send(res, 201, { status: 'registered' });
    } catch (err) {
      return send(res, 500, { error: 'server error' });
    }
  }

  if (req.method === 'GET' && parsed.pathname === '/api/auth/verify-email') {
    const token = parsed.query.token;
    const verifs = readVerifications();
    const idx = verifs.findIndex(v => v.token === token);
    if (idx === -1 || verifs[idx].expires < Date.now()) {
      return serveFile(res, path.join(__dirname, 'verify-expired.html'));
    }
    const entry = verifs[idx];
    verifs.splice(idx, 1);
    writeVerifications(verifs);
    const users = readUsers();
    const user = users.find(u => u.id === entry.userId);
    if (user) {
      user.verified = true;
      writeUsers(users);
    }
    return serveFile(res, path.join(__dirname, 'verify-success.html'));
  }

  if (req.method === 'POST' && parsed.pathname === '/login') {
    try {
      const { username, password } = await parseBody(req);
      const users = readUsers();
      const user = users.find(u => u.username === username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return send(res, 401, { error: 'invalid credentials' });
      }
      if (!user.verified) {
        return send(res, 403, { error: 'email not verified' });
      }
      const token = crypto.randomBytes(16).toString('hex');
      const twofa = user.twoFA && user.twoFA.verified;
      sessions[token] = { username: user.username, twoFAVerified: !twofa };
      return send(res, 200, { token, twoFA: twofa });
    } catch (err) {
      return send(res, 500, { error: 'server error' });
    }
  }

  if (req.method === 'GET' && parsed.pathname === '/quote') {
    const authInfo = getAuth(req);
    if (!authInfo) return send(res, 401, { error: 'unauthorized' });
    if (authInfo.user.twoFA && authInfo.user.twoFA.verified && !authInfo.session.twoFAVerified) {
      return send(res, 401, { error: '2fa required' });
    }
    try {
      const response = await fetch('https://api.quotable.io/random');
      const data = await response.json();
      return send(res, 200, data);
    } catch (err) {
      return send(res, 500, { error: 'unable to fetch quote' });
    }
  }

  if (req.method === 'POST' && parsed.pathname === '/api/user/logout-all') {
    const authInfo = getAuth(req);
    if (!authInfo) return send(res, 401, { error: 'unauthorized' });
    for (const t of Object.keys(sessions)) {
      if (sessions[t].username === authInfo.user.username) delete sessions[t];
    }
    return send(res, 200, { status: 'logged out' });
  }

  if (req.method === 'GET' && parsed.pathname === '/api/user/2fa/status') {
    const authInfo = getAuth(req);
    if (!authInfo) return send(res, 401, { error: 'unauthorized' });
    const two = authInfo.user.twoFA || {};
    return send(res, 200, { enabled: !!two.verified, method: two.method || null });
  }

  if (req.method === 'POST' && parsed.pathname === '/api/user/2fa/setup') {
    const authInfo = getAuth(req);
    if (!authInfo) return send(res, 401, { error: 'unauthorized' });
    const { method } = await parseBody(req);
    if (!['totp', 'email'].includes(method)) return send(res, 400, { error: 'invalid method' });
    if (method === 'totp') {
      const secret = crypto.randomBytes(20).toString('hex');
      authInfo.user.twoFA = { method: 'totp', secret, verified: false };
      writeUsers(authInfo.users);
      return send(res, 200, { secret });
    } else {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      authInfo.user.twoFA = { method: 'email', code, expires: Date.now() + 5 * 60 * 1000, verified: false };
      writeUsers(authInfo.users);
      console.log(`Email OTP for ${authInfo.user.username}: ${code}`);
      return send(res, 200, { message: 'otp sent' });
    }
  }

  if (req.method === 'POST' && parsed.pathname === '/api/user/2fa/verify') {
    const authInfo = getAuth(req);
    if (!authInfo) return send(res, 401, { error: 'unauthorized' });
    const { code } = await parseBody(req);
    const two = authInfo.user.twoFA;
    if (!two) return send(res, 400, { error: 'not setup' });
    let ok = false;
    if (two.method === 'totp') {
      ok = generateTOTP(two.secret) === code;
    } else if (two.method === 'email') {
      ok = two.code === code && two.expires > Date.now();
    }
    if (!ok) return send(res, 400, { error: 'invalid code' });
    two.verified = true;
    delete two.code;
    delete two.expires;
    writeUsers(authInfo.users);
    authInfo.session.twoFAVerified = true;
    return send(res, 200, { status: 'verified' });
  }

  if (req.method === 'POST' && parsed.pathname === '/api/user/2fa/disable') {
    const authInfo = getAuth(req);
    if (!authInfo) return send(res, 401, { error: 'unauthorized' });
    authInfo.user.twoFA = null;
    writeUsers(authInfo.users);
    return send(res, 200, { status: 'disabled' });
  }

  send(res, 404, { error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

