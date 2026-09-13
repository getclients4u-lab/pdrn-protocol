// POST /api/download — authenticated PDF delivery
import { handleDownload } from './hub.js';
export const config = { api: { bodyParser: true } };
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  return handleDownload(req, res);
}
