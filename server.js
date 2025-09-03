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
const csrfTokens = new Set();
const rateLimits = {};
const failedLogins = {};
const captchaChallenges = {};

function parseCookies(req){
  const list={};
  const cookie=req.headers.cookie;
  if(!cookie) return list;
  cookie.split(';').forEach(c=>{
    const parts=c.split('=');
    list[parts.shift().trim()]=decodeURIComponent(parts.join('='));
  });
  return list;
}

function generateCsrfToken(){
  const token=crypto.randomBytes(24).toString('hex');
  csrfTokens.add(token);
  return token;
}

function validateCsrf(req,token){
  const cookies=parseCookies(req);
  if(token && cookies.csrfToken===token && csrfTokens.has(token)){
    csrfTokens.delete(token);
    return true;
  }
  return false;
}

function checkRateLimit(ip,path,limit=5,windowMs=60000){
  const key=`${path}:${ip}`;
  const now=Date.now();
  if(!rateLimits[key]||now-rateLimits[key].time>windowMs){
    rateLimits[key]={count:1,time:now};
    return false;
  }
  rateLimits[key].count++;
  return rateLimits[key].count>limit;
}

function createCaptcha(ip){
  const a=Math.floor(Math.random()*10);
  const b=Math.floor(Math.random()*10);
  captchaChallenges[ip]={a,b};
  return {question:`What is ${a} + ${b}?`};
}

function verifyCaptcha(ip,answer){
  const ch=captchaChallenges[ip];
  if(!ch) return true;
  if(parseInt(answer,10)===ch.a+ch.b){
    delete captchaChallenges[ip];
    return true;
  }
  return false;
}

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

  if (req.method === 'GET' && parsed.pathname === '/csrf-token') {
    const token = generateCsrfToken();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `csrfToken=${token}; HttpOnly`
    });
    return res.end(JSON.stringify({ csrfToken: token }));
  }

  if (req.method === 'POST' && parsed.pathname === '/register') {
    try {
      const ip = req.socket.remoteAddress;
      if (checkRateLimit(ip, '/register')) {
        const captcha = createCaptcha(ip);
        return send(res, 429, { error: 'Too many requests', captcha });
      }
      const { username, password, csrfToken, captchaAnswer } = await parseBody(req);
      if (!validateCsrf(req, csrfToken)) return send(res, 403, { error: 'invalid csrf token' });
      if (!verifyCaptcha(ip, captchaAnswer)) {
        const captcha = createCaptcha(ip);
        return send(res, 403, { error: 'captcha required', captcha });
      }
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
      const ip = req.socket.remoteAddress;
      if (checkRateLimit(ip, '/login')) {
        const captcha = createCaptcha(ip);
        return send(res, 429, { error: 'Too many requests', captcha });
      }
      const { username, password, csrfToken, captchaAnswer } = await parseBody(req);
      if (!validateCsrf(req, csrfToken)) return send(res, 403, { error: 'invalid csrf token' });
      if (!verifyCaptcha(ip, captchaAnswer)) {
        const captcha = createCaptcha(ip);
        return send(res, 403, { error: 'captcha required', captcha });
      }
      const users = readUsers();
      const user = users.find(u => u.username === username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        failedLogins[ip] = (failedLogins[ip] || 0) + 1;
        if (failedLogins[ip] >= 3) {
          const captcha = createCaptcha(ip);
          return send(res, 401, { error: 'invalid credentials', captcha });
        }
        return send(res, 401, { error: 'invalid credentials' });
      }
      failedLogins[ip] = 0;
      const token = crypto.randomBytes(16).toString('hex');
      sessions[token] = user.username;
      return send(res, 200, { token });
    } catch (err) {
      return send(res, 500, { error: 'server error' });
    }
  }

  if (req.method === 'POST' && parsed.pathname === '/forgot-password') {
    try {
      const ip = req.socket.remoteAddress;
      if (checkRateLimit(ip, '/forgot-password')) {
        const captcha = createCaptcha(ip);
        return send(res, 429, { error: 'Too many requests', captcha });
      }
      const { csrfToken, captchaAnswer } = await parseBody(req);
      if (!validateCsrf(req, csrfToken)) return send(res, 403, { error: 'invalid csrf token' });
      if (!verifyCaptcha(ip, captchaAnswer)) {
        const captcha = createCaptcha(ip);
        return send(res, 403, { error: 'captcha required', captcha });
      }
      return send(res, 200, { status: 'reset link sent' });
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

