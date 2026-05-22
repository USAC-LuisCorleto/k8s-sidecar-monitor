import express from 'express';
import cors from 'cors';
import { readWazuhLogs } from './wazuh-reader';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get('/api/logs', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
  const service = req.query.service as string | undefined;
  const level = req.query.level as string | undefined;
  const search = req.query.search as string | undefined;

  try {
    const result = await readWazuhLogs(page, limit, service, level, search);
    res.json(result);
  } catch (err) {
    console.error('Error in /api/logs:', err);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Dashboard backend listening on port ${PORT}`);
});
