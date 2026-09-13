// GET/POST /api/verify — check access code (re-export from hub)
import { handleVerify } from './hub.js';
export const config = { api: { bodyParser: true } };
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  return handleVerify(req, res);
}
