import { Component, output, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-log-filter',
  standalone: true,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="filter-bar">
      <div class="filter-group">
        <mat-icon class="filter-icon">filter_list</mat-icon>
        
        <mat-form-field appearance="outline" class="filter-field" subscriptSizing="dynamic">
          <mat-label>Servicio</mat-label>
          <mat-select [(ngModel)]="selectedService" (selectionChange)="onChange()">
            <mat-option value="all">
              <mat-icon>dns</mat-icon> Todos los servicios
            </mat-option>
            <mat-option value="service-a">
              <span class="dot service-a"></span> Service A
            </mat-option>
            <mat-option value="service-b">
              <span class="dot service-b"></span> Service B
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="filter-field" subscriptSizing="dynamic">
          <mat-label>Nivel</mat-label>
          <mat-select [(ngModel)]="selectedLevel" (selectionChange)="onChange()">
            <mat-option value="all">
              <mat-icon>layers</mat-icon> Todos los niveles
            </mat-option>
            <mat-option value="30">
              <span class="level-badge info">INFO</span> Información
            </mat-option>
            <mat-option value="40">
              <span class="level-badge warn">WARN</span> Advertencia
            </mat-option>
            <mat-option value="50">
              <span class="level-badge error">ERROR</span> Error
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="search-field" subscriptSizing="dynamic">
          <mat-label>
            <mat-icon style="font-size: 16px; vertical-align: middle;">search</mat-icon>
            Buscar en logs...
          </mat-label>
          <input matInput [(ngModel)]="searchText" (keyup.enter)="onChange()" placeholder="mensaje, traceId, servicio..." />
          @if (searchText) {
            <button mat-icon-button matSuffix (click)="clearSearch()" aria-label="Clear">
              <mat-icon>close</mat-icon>
            </button>
          }
        </mat-form-field>
      </div>

      <div class="actions">
        <button mat-stroked-button (click)="clearFilters()" class="clear-btn">
          <mat-icon>clear_all</mat-icon>
          Limpiar
        </button>
        <button mat-raised-button color="primary" (click)="onRefresh.emit()" class="refresh-btn">
          <mat-icon>refresh</mat-icon>
          Refrescar
        </button>
      </div>
    </div>
  `,
  styles: [`
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .filter-group {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      flex: 1;
    }
    .filter-icon {
      color: #64748b;
      margin-right: 4px;
    }
    .filter-field {
      min-width: 180px;
      width: 200px;
    }
    .search-field {
      min-width: 240px;
      flex: 1;
      max-width: 400px;
    }
    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .clear-btn {
      color: #64748b;
    }
    .refresh-btn {
      background: #0f172a !important;
    }
    .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 8px;
    }
    .dot.service-a { background: #3b82f6; }
    .dot.service-b { background: #8b5cf6; }
    .level-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      margin-right: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .level-badge.info { background: #dbeafe; color: #1e40af; }
    .level-badge.warn { background: #fef3c7; color: #92400e; }
    .level-badge.error { background: #fee2e2; color: #991b1b; }
  `]
})
export class LogFilterComponent {
  selectedService = 'all';
  selectedLevel = 'all';
  searchText = '';

  filtersChange = output<{ service: string; level: string; search: string }>();
  onRefresh = output<void>();

  onChange(): void {
    this.filtersChange.emit({
      service: this.selectedService,
      level: this.selectedLevel,
      search: this.searchText,
    });
  }

  clearSearch(): void {
    this.searchText = '';
    this.onChange();
  }

  clearFilters(): void {
    this.selectedService = 'all';
    this.selectedLevel = 'all';
    this.searchText = '';
    this.onChange();
  }
}
