const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, 'users.json');
const TOKENS_FILE = path.join(__dirname, 'tokens.json');

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(TOKENS_FILE)) fs.writeFileSync(TOKENS_FILE, '[]');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'access_secret';
const SALT_ROUNDS = 12;

function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    ACCESS_TOKEN_SECRET,
    { expiresIn: '15m' }
  );
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

const revokedTokens = new Set();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'home.html'));
});

function saveRefreshToken(userId, token, user_agent) {
  const tokens = readJson(TOKENS_FILE);
  tokens.push({ userId, token, user_agent, createdAt: Date.now() });
  writeJson(TOKENS_FILE, tokens);
}

function rotateRefreshToken(oldToken, userId, user_agent) {
  const tokens = readJson(TOKENS_FILE);
  const idx = tokens.findIndex(t => t.token === oldToken);
  if (idx === -1) return null;
  const newToken = generateRefreshToken();
  tokens[idx] = { userId, token: newToken, user_agent, createdAt: Date.now() };
  writeJson(TOKENS_FILE, tokens);
  return newToken;
}

function removeRefreshToken(token) {
  const tokens = readJson(TOKENS_FILE).filter(t => t.token !== token);
  writeJson(TOKENS_FILE, tokens);
}

function removeAllUserTokens(userId) {
  const tokens = readJson(TOKENS_FILE).filter(t => t.userId !== userId);
  writeJson(TOKENS_FILE, tokens);
}

function findToken(token) {
  const tokens = readJson(TOKENS_FILE);
  return tokens.find(t => t.token === token);
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  if (revokedTokens.has(token)) return res.status(401).json({ error: 'token revoked' });
  jwt.verify(token, ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'invalid token' });
    req.user = user;
    next();
  });
}

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  const users = readJson(USERS_FILE);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'user exists' });
  }
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const id = users.length ? users[users.length - 1].id + 1 : 1;
  users.push({ id, username, passwordHash });
  writeJson(USERS_FILE, users);
  res.status(201).json({ status: 'registered' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const users = readJson(USERS_FILE);
  const user = users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  saveRefreshToken(user.id, refreshToken, req.headers['user-agent']);
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict'
  });
  res.json({ accessToken });
});

app.post('/refresh', (req, res) => {
  const { refreshToken } = req.cookies;
  if (!refreshToken) return res.status(401).json({ error: 'missing token' });
  const stored = findToken(refreshToken);
  if (!stored) return res.status(403).json({ error: 'invalid token' });
  const users = readJson(USERS_FILE);
  const user = users.find(u => u.id === stored.userId);
  if (!user) return res.status(403).json({ error: 'invalid user' });
  const newRefreshToken = rotateRefreshToken(refreshToken, user.id, req.headers['user-agent']);
  const accessToken = generateAccessToken(user);
  res.cookie('refreshToken', newRefreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict'
  });
  res.json({ accessToken });
});

app.post('/logout', authenticateToken, (req, res) => {
  const { refreshToken } = req.cookies;
  if (refreshToken) removeRefreshToken(refreshToken);
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) revokedTokens.add(token);
  res.clearCookie('refreshToken');
  res.json({ status: 'logged out' });
});

app.post('/logoutAll', (req, res) => {
  const { refreshToken } = req.cookies;
  if (!refreshToken) return res.status(401).json({ error: 'missing token' });
  const stored = findToken(refreshToken);
  if (!stored) return res.status(403).json({ error: 'invalid token' });
  removeAllUserTokens(stored.userId);
  res.clearCookie('refreshToken');
  res.json({ status: 'logged out from all devices' });
});

app.get('/quote', authenticateToken, async (req, res) => {
  try {
    const response = await fetch('https://api.quotable.io/random');
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'unable to fetch quote' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

