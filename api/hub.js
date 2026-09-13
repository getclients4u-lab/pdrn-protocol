// PDRN Protocol verify + admin + download in one module (Vercel serverless)
// Routes:
//   POST /api/verify    {email, code} → {ok, name} | 403
//   POST /api/admin     {password, action: add|revoke|list|orders, email?, name?}
//   POST /api/download  {email, code, file} → PDF binary | 403
import crypto from 'crypto';

export const config = { api: { bodyParser: true } };

const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_OWNER = process.env.GH_OWNER || 'getclients4u-lab';
const GH_REPO = process.env.GH_DATA_REPO || 'pdrn-protocol-data';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PEPPER = process.env.ACCESS_PEPPER || 'pdrn-protocol-pepper-9c4a7f2e';

const FILES = [
  '01-system-guide.pdf', '02-barrier-repair-playbook.pdf', '03-pdrn-cheatsheet.pdf', '04-sandwich-stack-planner.pdf',
  '05-product-tracker.pdf', '06-30-day-calendar.pdf', '07-treatment-stack-guide.pdf', '08-diet-lifestyle-guide.pdf',
];

async function ghGet(path) {
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`,
    { headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
  if (!res.ok) return null;
  return res.json();
}

async function ghPut(path, content, sha, message) {
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${GH_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha }),
  });
  return res.ok;
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[crypto.randomInt(chars.length)];
  return `PP-${s.slice(0, 5)}-${s.slice(5)}`;
}

function hashCode(code) {
  return crypto.createHash('sha256').update(`${code}::${PEPPER}`).digest('hex');
}

async function loadUsers() {
  const existing = await ghGet('users.json');
  if (!existing) return { users: [], sha: undefined };
  try {
    const users = JSON.parse(Buffer.from(existing.content, 'base64').toString('utf8'));
    return { users: Array.isArray(users) ? users : [], sha: existing.sha };
  } catch (e) { return { users: [], sha: existing.sha }; }
}

async function handleVerify(req, res) {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'email and code required' });
  const { users } = await loadUsers();
  const norm = String(email).trim().toLowerCase();
  const user = users.find(u => String(u.email || '').trim().toLowerCase() === norm);
  if (!user) return res.status(403).json({ ok: false, error: 'no account for this email' });
  if (user.status !== 'active') return res.status(403).json({ ok: false, error: 'account disabled' });
  if (user.codeHash !== hashCode(String(code).trim())) return res.status(403).json({ ok: false, error: 'invalid code' });
  return res.status(200).json({ ok: true, name: user.name || '', email: user.email, since: user.added });
}

async function handleAdmin(req, res) {
  const { password, action, email, name } = req.body || {};
  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });

  if (action === 'orders') {
    const existing = await ghGet('buyers.json');
    let buyers = [];
    if (existing) {
      try { buyers = JSON.parse(Buffer.from(existing.content, 'base64').toString('utf8')); } catch (e) {}
      if (!Array.isArray(buyers)) buyers = [];
    }
    const total = buyers.reduce((s, b) => s + Math.round((b.amount || 0) * 100), 0); // cents
    return res.status(200).json({ ok: true, count: buyers.length, totalCents: total, orders: buyers });
  }

  if (action === 'list') {
    const { users } = await loadUsers();
    const safe = users.map(u => ({ email: u.email, name: u.name, status: u.status, added: u.added, source: u.source }));
    return res.status(200).json({ ok: true, users: safe });
  }

  if (action === 'add') {
    if (!email) return res.status(400).json({ error: 'email required' });
    const { users, sha } = await loadUsers();
    const norm = String(email).trim().toLowerCase();
    const existingUser = users.find(u => String(u.email || '').trim().toLowerCase() === norm);
    if (existingUser && existingUser.status === 'active') {
      return res.status(200).json({ ok: true, already: true, email: existingUser.email, name: existingUser.name });
    }
    const code = genCode();
    const user = {
      email: norm,
      name: String(name || '').trim() || norm.split('@')[0],
      codeHash: hashCode(code),
      status: 'active',
      added: new Date().toISOString(),
      source: 'admin',
    };
    if (existingUser) {
      const i = users.findIndex(u => String(u.email || '').trim().toLowerCase() === norm);
      users[i] = user;
    } else {
      users.push(user);
    }
    const saved = await ghPut('users.json', JSON.stringify(users, null, 2), sha, `admin add: ${norm}`);
    return res.status(saved ? 200 : 500).json({ ok: saved, email: norm, code: saved ? code : null });
  }

  if (action === 'revoke') {
    if (!email) return res.status(400).json({ error: 'email required' });
    const { users, sha } = await loadUsers();
    const norm = String(email).trim().toLowerCase();
    const i = users.findIndex(u => String(u.email || '').trim().toLowerCase() === norm);
    if (i === -1) return res.status(404).json({ ok: false, error: 'user not found' });
    users[i].status = 'disabled';
    users[i].revoked = new Date().toISOString();
    const saved = await ghPut('users.json', JSON.stringify(users, null, 2), sha, `admin revoke: ${norm}`);
    return res.status(saved ? 200 : 500).json({ ok: saved, email: norm, status: 'disabled' });
  }

  return res.status(400).json({ error: 'unknown action' });
}

async function handleDownload(req, res) {
  const { email, code, file } = req.body || {};
  if (!email || !code || !file) return res.status(400).json({ error: 'email, code and file required' });
  if (!FILES.includes(file)) return res.status(400).json({ error: 'unknown file' });

  const { users } = await loadUsers();
  const norm = String(email).trim().toLowerCase();
  const user = users.find(u => String(u.email || '').trim().toLowerCase() === norm);
  if (!user) return res.status(403).json({ error: 'no account for this email' });
  if (user.status !== 'active') return res.status(403).json({ error: 'account disabled' });
  if (user.codeHash !== hashCode(String(code).trim())) return res.status(403).json({ error: 'invalid code' });

  try {
    const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/product/${file}`,
      { headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
    if (!r.ok) return res.status(404).json({ error: 'file not found' });
    const d = await r.json();
    const buf = Buffer.from(d.content, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: 'download failed' });
  }
}

export { handleVerify, handleAdmin, handleDownload };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const route = req.url.split('?')[0];
  if (route.endsWith('/verify')) return handleVerify(req, res);
  if (route.endsWith('/admin')) return handleAdmin(req, res);
  if (route.endsWith('/download')) return handleDownload(req, res);
  return res.status(404).json({ error: 'unknown route' });
}
