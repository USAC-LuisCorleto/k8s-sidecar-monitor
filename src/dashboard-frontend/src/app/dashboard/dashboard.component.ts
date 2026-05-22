import { Component, signal, effect, inject, OnInit, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { PageEvent } from '@angular/material/paginator';
import { Subscription, interval } from 'rxjs';
import { switchMap, catchError, of } from 'rxjs';

import { WazuhLogService, type PaginatedLogs } from '../core/wazuh-log.service';
import { LogFilterComponent } from './log-filter/log-filter.component';
import { LogTableComponent } from './log-table/log-table.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatToolbarModule,
    MatProgressBarModule,
    MatCardModule,
    MatIconModule,
    LogFilterComponent,
    LogTableComponent,
  ],
  template: `
    <div class="dashboard">
      <!-- Header -->
      <header class="app-header">
        <div class="header-brand">
          <div class="logo">
            <mat-icon>shield</mat-icon>
          </div>
          <div class="brand-text">
            <h1>Wazuh Security Dashboard</h1>
            <p>Monitor de logs centralizado — Patrón Sidecar</p>
          </div>
        </div>
        <div class="header-status">
          <div class="status-badge" [class.online]="!loading()">
            <span class="status-dot"></span>
            {{ loading() ? 'Sincronizando...' : 'En vivo' }}
          </div>
          <div class="time-badge">
            <mat-icon>schedule</mat-icon>
            {{ lastUpdated() | date:'HH:mm:ss' }}
          </div>
        </div>
      </header>

      <!-- Stats Cards -->
      <div class="stats-grid">
        <div class="stat-card primary">
          <div class="stat-icon">
            <mat-icon>receipt_long</mat-icon>
          </div>
          <div class="stat-body">
            <span class="stat-value">{{ total() | number }}</span>
            <span class="stat-label">Total de logs</span>
          </div>
        </div>
        <div class="stat-card info">
          <div class="stat-icon">
            <mat-icon>dns</mat-icon>
          </div>
          <div class="stat-body">
            <span class="stat-value">{{ serviceACount() | number }}</span>
            <span class="stat-label">Service A</span>
          </div>
        </div>
        <div class="stat-card accent">
          <div class="stat-icon">
            <mat-icon>cloud</mat-icon>
          </div>
          <div class="stat-body">
            <span class="stat-value">{{ serviceBCount() | number }}</span>
            <span class="stat-label">Service B</span>
          </div>
        </div>
        <div class="stat-card success">
          <div class="stat-icon">
            <mat-icon>info</mat-icon>
          </div>
          <div class="stat-body">
            <span class="stat-value">{{ infoCount() | number }}</span>
            <span class="stat-label">Info</span>
          </div>
        </div>
      </div>

      <!-- Progress bar -->
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" class="loading-bar"></mat-progress-bar>
      }

      <!-- Filters -->
      <app-log-filter
        (filtersChange)="updateFilters($event)"
        (onRefresh)="refresh()"
      ></app-log-filter>

      <!-- Table -->
      <app-log-table
        [logs]="logs()"
        [total]="total()"
        [limit]="limit()"
        [pageIndex]="pageIndex()"
        [lastUpdated]="lastUpdated()"
        (onPageChange)="handlePage($event)"
        (onClearFilters)="clearFilters()"
      ></app-log-table>

      <!-- Footer -->
      <footer class="app-footer">
        <p>
          <mat-icon>security</mat-icon>
          Wazuh Manager v4.9.0 &middot; Fluent Bit v3.1 &middot; Istio v1.23.3
        </p>
      </footer>
    </div>
  `,
  styles: [`
    .dashboard {
      min-height: 100vh;
      background: #f8fafc;
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 0 0 24px;
    }
    /* Header */
    .app-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 32px;
      background: #0f172a;
      color: #ffffff;
      gap: 20px;
      flex-wrap: wrap;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .logo {
      width: 44px;
      height: 44px;
      background: #3b82f6;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }
    .brand-text h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.5px;
    }
    .brand-text p {
      margin: 2px 0 0;
      font-size: 13px;
      color: #94a3b8;
      font-weight: 400;
    }
    .header-status {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      background: #334155;
      color: #94a3b8;
    }
    .status-badge.online {
      background: #064e3b;
      color: #6ee7b7;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .time-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      color: #cbd5e1;
    }
    .time-badge mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      padding: 0 32px;
    }
    .stat-card {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 20px 24px;
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      transition: transform 150ms ease, box-shadow 150ms ease;
    }
    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    .stat-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f1f5f9;
      color: #64748b;
    }
    .stat-card.primary .stat-icon { background: #dbeafe; color: #2563eb; }
    .stat-card.info .stat-icon { background: #ede9fe; color: #7c3aed; }
    .stat-card.accent .stat-icon { background: #ccfbf1; color: #0d9488; }
    .stat-card.success .stat-icon { background: #dcfce7; color: #16a34a; }
    .stat-icon mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }
    .stat-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1;
    }
    .stat-label {
      font-size: 13px;
      color: #64748b;
      font-weight: 500;
    }
    /* Loading bar */
    .loading-bar {
      margin: -10px 32px 0;
      border-radius: 2px;
    }
    /* Footer */
    .app-footer {
      margin-top: auto;
      padding: 20px 32px;
      text-align: center;
    }
    .app-footer p {
      margin: 0;
      font-size: 12px;
      color: #94a3b8;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .app-footer mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly logService = inject(WazuhLogService);

  readonly logs = signal<PaginatedLogs['data']>([]);
  readonly total = signal<number>(0);
  readonly page = signal<number>(1);
  readonly pageIndex = signal<number>(0);
  readonly limit = signal<number>(50);
  readonly loading = signal<boolean>(false);
  readonly lastUpdated = signal<Date>(new Date());
  readonly allLogs = signal<PaginatedLogs['data']>([]);

  // Computed stats
  readonly serviceACount = computed(() => this.allLogs().filter(l => l.service === 'service-a').length);
  readonly serviceBCount = computed(() => this.allLogs().filter(l => l.service === 'service-b').length);
  readonly infoCount = computed(() => this.allLogs().filter(l => l.level === '30' || l.level === 'INFO' || l.level === 'info').length);

  private filters = signal<{ service: string; level: string; search: string }>({
    service: 'all',
    level: 'all',
    search: '',
  });

  private autoRefreshSub: Subscription | null = null;

  constructor() {
    effect(() => {
      this.loadLogs();
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
  }

  private loadLogs(): void {
    this.loading.set(true);
    const f = this.filters();

    this.logService
      .getLogs(this.page(), this.limit(), f.service, f.level, f.search)
      .subscribe({
        next: (result) => {
          this.logs.set(result.data);
          this.total.set(result.total);
          this.lastUpdated.set(new Date());
          this.loading.set(false);
          // Also fetch all (unfiltered) for stats
          this.loadStats();
        },
        error: (err) => {
          console.error('Error loading logs:', err);
          this.loading.set(false);
        },
      });
  }

  private loadStats(): void {
    this.logService.getLogs(1, 5000, undefined, undefined, undefined).subscribe({
      next: (result) => this.allLogs.set(result.data),
      error: () => {},
    });
  }

  updateFilters(filters: { service: string; level: string; search: string }): void {
    this.page.set(1);
    this.pageIndex.set(0);
    this.filters.set(filters);
  }

  handlePage(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    this.pageIndex.set(event.pageIndex);
    this.limit.set(event.pageSize);
  }

  refresh(): void {
    this.loadLogs();
  }

  clearFilters(): void {
    this.updateFilters({ service: 'all', level: 'all', search: '' });
  }

  private startAutoRefresh(): void {
    this.autoRefreshSub = interval(10000)
      .pipe(
        switchMap(() => {
          this.loading.set(true);
          const f = this.filters();
          return this.logService
            .getLogs(this.page(), this.limit(), f.service, f.level, f.search)
            .pipe(catchError(() => of(null)));
        })
      )
      .subscribe((result) => {
        if (result) {
          this.logs.set(result.data);
          this.total.set(result.total);
          this.lastUpdated.set(new Date());
        }
        this.loading.set(false);
      });
  }

  private stopAutoRefresh(): void {
    if (this.autoRefreshSub) {
      this.autoRefreshSub.unsubscribe();
      this.autoRefreshSub = null;
    }
  }
}
