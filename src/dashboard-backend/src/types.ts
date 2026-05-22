export interface WazuhLogEntry {
  timestamp: string;
  level: string;
  service: string;
  message: string;
  traceId: string;
  raw: string;
}

export interface PaginatedLogs {
  data: WazuhLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
