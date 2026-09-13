// POST /api/admin — add / revoke / list users + orders
import { handleAdmin } from './hub.js';
export const config = { api: { bodyParser: true } };
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  return handleAdmin(req, res);
}
