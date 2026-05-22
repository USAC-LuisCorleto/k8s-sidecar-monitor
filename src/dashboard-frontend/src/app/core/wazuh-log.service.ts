import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

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

@Injectable({ providedIn: 'root' })
export class WazuhLogService {
  private readonly apiUrl = signal<string>(
    typeof window !== 'undefined' && (window as unknown as { ENV_API_URL?: string }).ENV_API_URL
      ? (window as unknown as { ENV_API_URL: string }).ENV_API_URL
      : 'http://localhost:3000/api'
  );

  constructor(private readonly http: HttpClient) {}

  getLogs(
    page: number,
    limit: number,
    service?: string,
    level?: string,
    search?: string
  ): Observable<PaginatedLogs> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    if (service && service !== 'all') {
      params = params.set('service', service);
    }
    if (level && level !== 'all') {
      params = params.set('level', level);
    }
    if (search) {
      params = params.set('search', search);
    }

    return this.http.get<PaginatedLogs>(`${this.apiUrl()}/logs`, { params });
  }
}
