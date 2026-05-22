import { exec } from 'child_process';
import { promisify } from 'util';
import type { WazuhLogEntry, PaginatedLogs } from './types';

const execAsync = promisify(exec);

const WAZUH_CONTAINER = process.env.WAZUH_CONTAINER ?? 'wazuh-manager';
const ARCHIVES_PATH = process.env.WAZUH_ARCHIVES_PATH ?? '/var/ossec/logs/archives/archives.log';
const MAX_LINES = parseInt(process.env.MAX_LINES ?? '5000', 10);

function parsePinoJson(line: string): WazuhLogEntry | null {
  const jsonStart = line.indexOf('{');
  const jsonEnd = line.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return null;
  }
  const jsonPayload = line.slice(jsonStart, jsonEnd + 1);
  try {
    const parsed = JSON.parse(jsonPayload);
    const hostname = parsed.hostname ?? '';
    const serviceName = parsed.service ?? (hostname.includes('service-a') ? 'service-a' : hostname.includes('service-b') ? 'service-b' : hostname);
    return {
      timestamp: parsed.timestamp ?? new Date().toISOString(),
      level: parsed.level?.toString() ?? 'INFO',
      service: serviceName,
      message: parsed.msg ?? parsed.message ?? line,
      traceId: parsed.traceId ?? '',
      raw: line,
    };
  } catch {
    return null;
  }
}

export async function readWazuhLogs(
  page: number,
  limit: number,
  serviceFilter?: string,
  levelFilter?: string,
  searchQuery?: string
): Promise<PaginatedLogs> {
  const offset = (page - 1) * limit;

  const cmd = `docker exec ${WAZUH_CONTAINER} tail -n ${MAX_LINES} ${ARCHIVES_PATH}`;

  try {
    const { stdout } = await execAsync(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout.trim().split('\n').filter(Boolean);

    const entries: WazuhLogEntry[] = [];
    for (const line of lines) {
      const parsed = parsePinoJson(line);
      if (parsed) {
        entries.push(parsed);
      }
    }

    // Reverse so newest logs appear first
    const sorted = entries.slice().reverse();

    let filtered = sorted;

    if (serviceFilter && serviceFilter !== 'all') {
      filtered = filtered.filter((e) => e.service === serviceFilter);
    }

    if (levelFilter && levelFilter !== 'all') {
      filtered = filtered.filter((e) => e.level === levelFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.service.toLowerCase().includes(q) ||
          e.traceId.toLowerCase().includes(q)
      );
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const paginated = filtered.slice(offset, offset + limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages,
    };
  } catch (err) {
    console.error('Error reading Wazuh archives:', err);
    return {
      data: [],
      total: 0,
      page,
      limit,
      totalPages: 0,
    };
  }
}
