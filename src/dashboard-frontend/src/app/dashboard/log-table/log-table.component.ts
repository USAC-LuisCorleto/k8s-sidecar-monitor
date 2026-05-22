import { Component, input, output } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import type { WazuhLogEntry } from '../../core/wazuh-log.service';

@Component({
  selector: 'app-log-table',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    MatTableModule,
    MatPaginatorModule,
    MatIconModule,
    MatButtonModule,
  ],
  template: `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">
          <mat-icon>receipt_long</mat-icon>
          <span>Registro de eventos</span>
        </div>
        <div class="table-meta">
          <span class="meta-item">
            <mat-icon>schedule</mat-icon>
            Actualizado {{ lastUpdated() | date:'HH:mm:ss' }}
          </span>
        </div>
      </div>

      <div class="table-container">
        <table mat-table [dataSource]="logs()" class="log-table">
          <ng-container matColumnDef="level">
            <th mat-header-cell *matHeaderCellDef class="col-level">Nivel</th>
            <td mat-cell *matCellDef="let log" class="col-level">
              <div class="level-indicator" [attr.data-level]="levelClass(log.level)">
                <mat-icon>{{ levelIcon(log.level) }}</mat-icon>
                <span class="level-text">{{ levelLabel(log.level) }}</span>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="timestamp">
            <th mat-header-cell *matHeaderCellDef class="col-time">Fecha y hora</th>
            <td mat-cell *matCellDef="let log" class="col-time">
              <div class="time-cell">
                <span class="time-primary">{{ log.timestamp | date:'HH:mm:ss.SSS' }}</span>
                <span class="time-secondary">{{ log.timestamp | date:'dd/MM/yyyy' }}</span>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="service">
            <th mat-header-cell *matHeaderCellDef class="col-service">Servicio</th>
            <td mat-cell *matCellDef="let log" class="col-service">
              <div class="service-badge" [attr.data-service]="log.service">
                <mat-icon>code</mat-icon>
                <span>{{ log.service || 'Sistema' }}</span>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="message">
            <th mat-header-cell *matHeaderCellDef class="col-message">Mensaje</th>
            <td mat-cell *matCellDef="let log" class="col-message">
              <div class="message-cell" [title]="log.message">
                {{ log.message }}
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="traceId">
            <th mat-header-cell *matHeaderCellDef class="col-trace">Trace</th>
            <td mat-cell *matCellDef="let log" class="col-trace">
              @if (log.traceId) {
                <code class="trace-code">{{ log.traceId | slice:0:12 }}...</code>
              } @else {
                <span class="trace-empty">—</span>
              }
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns; sticky: true"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;" class="log-row"></tr>
        </table>
      </div>

      @if (logs().length === 0) {
        <div class="empty-state">
          <mat-icon>search_off</mat-icon>
          <p>No se encontraron logs con los filtros aplicados</p>
          <button mat-button (click)="onClearFilters.emit()">Limpiar filtros</button>
        </div>
      }

      <mat-paginator
        [length]="total()"
        [pageSize]="limit()"
        [pageIndex]="pageIndex()"
        [pageSizeOptions]="[10, 25, 50, 100]"
        (page)="onPageChange.emit($event)"
        showFirstLastButtons
        aria-label="Paginación de logs"
      ></mat-paginator>
    </div>
  `,
  styles: [`
    .table-card {
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      overflow: hidden;
    }
    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #f1f5f9;
      background: #fafbfc;
    }
    .table-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      font-size: 16px;
      color: #0f172a;
    }
    .table-title mat-icon {
      color: #3b82f6;
    }
    .table-meta {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #64748b;
    }
    .meta-item mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .table-container {
      overflow-x: auto;
      max-height: 600px;
      overflow-y: auto;
    }
    .log-table {
      width: 100%;
      border-collapse: collapse;
    }
    .log-table th {
      background: #f8fafc;
      color: #475569;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 12px 16px;
      border-bottom: 1px solid #e2e8f0;
      white-space: nowrap;
    }
    .log-table td {
      padding: 12px 16px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
    }
    .log-row {
      transition: background 150ms ease;
    }
    .log-row:hover {
      background: #f8fafc;
    }
    .col-level { width: 120px; }
    .col-time { width: 160px; }
    .col-service { width: 140px; }
    .col-trace { width: 120px; }
    .level-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.5px;
      width: fit-content;
    }
    .level-indicator[data-level="info"] {
      background: #dbeafe;
      color: #1e40af;
    }
    .level-indicator[data-level="warn"] {
      background: #fef3c7;
      color: #92400e;
    }
    .level-indicator[data-level="error"] {
      background: #fee2e2;
      color: #991b1b;
    }
    .level-indicator mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .time-cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .time-primary {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
    }
    .time-secondary {
      font-size: 12px;
      color: #94a3b8;
    }
    .service-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      background: #f1f5f9;
      color: #475569;
      width: fit-content;
    }
    .service-badge mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .message-cell {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      color: #334155;
      max-width: 500px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .trace-code {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 11px;
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
      color: #64748b;
    }
    .trace-empty {
      color: #cbd5e1;
      font-size: 13px;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px 24px;
      color: #94a3b8;
      gap: 12px;
    }
    .empty-state mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #cbd5e1;
    }
    .empty-state p {
      margin: 0;
      font-size: 14px;
    }
  `]
})
export class LogTableComponent {
  logs = input<WazuhLogEntry[]>([]);
  total = input<number>(0);
  limit = input<number>(50);
  pageIndex = input<number>(0);
  lastUpdated = input<Date>(new Date());

  displayedColumns = ['level', 'timestamp', 'service', 'message', 'traceId'];

  onPageChange = output<PageEvent>();
  onClearFilters = output<void>();

  levelLabel(level: string | number): string {
    const map: Record<string, string> = {
      '30': 'INFO',
      '40': 'WARN',
      '50': 'ERROR',
    };
    return map[String(level)] ?? String(level).toUpperCase();
  }

  levelClass(level: string | number): string {
    const map: Record<string, string> = {
      '30': 'info',
      '40': 'warn',
      '50': 'error',
    };
    return map[String(level)] ?? 'info';
  }

  levelIcon(level: string | number): string {
    const map: Record<string, string> = {
      '30': 'info',
      '40': 'warning',
      '50': 'error',
    };
    return map[String(level)] ?? 'info';
  }
}
