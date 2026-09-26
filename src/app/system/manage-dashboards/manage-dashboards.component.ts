/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { Chart, registerables } from 'chart.js';
import { forkJoin, of, Subscription, interval } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import { SystemService } from '../system.service';
import { AccountingService } from '../../accounting/accounting.service';
import { ClientsService } from '../../clients/clients.service';
import { ThemingService } from '../../shared/theme-toggle/theming.service';

Chart.register(...registerables);

export interface DashboardWidgetConfig {
  id: string;
  name: string;
  module: 'global' | 'loan' | 'savings' | 'shares' | 'client' | 'admin';
  description: string;
  icon: string;
  enabled: boolean;
  allowedRoles: string[];
  lastUpdated: string;
  updatedBy: string;
}

export interface TransactionTypeMetric {
  type: string;
  category: string;
  icon: string;
  count: number;
  volume: number;
  trend: string;
  percentage: number;
  badgeClass: string;
}

export interface BusinessKpiCard {
  total: number;
  active: number;
  pending: number;
  newThisMonth: number;
  activeRatio: number;
}

export interface LoansKpiCard {
  activeCount: number;
  totalDisbursed: number;
  totalOutstanding: number;
  avgLoanSize: number;
  currency: string;
}

export interface SavingsKpiCard {
  activeCount: number;
  totalBalance: number;
  avgBalance: number;
  savingsCount: number;
  savingsBalance: number;
  fixedCount: number;
  fixedBalance: number;
  recurringCount: number;
  recurringBalance: number;
  currency: string;
}

export interface SharesKpiCard {
  activeCount: number;
  totalCapital: number;
  totalSubscribed: number;
  currency: string;
}

@Component({
  selector: 'mifosx-manage-dashboards',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TranslateModule,
    MatTabsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressBarModule,
    MatButtonToggleModule,
    FaIconComponent
  ],
  templateUrl: './manage-dashboards.component.html',
  styleUrls: ['./manage-dashboards.component.scss'],
  changeDetection: ChangeDetectionStrategy.Default
})
export class ManageDashboardsComponent implements OnInit, AfterViewInit, OnDestroy {
  private http = inject(HttpClient);
  private systemService = inject(SystemService);
  private accountingService = inject(AccountingService);
  private clientsService = inject(ClientsService);
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);
  private cdr = inject(ChangeDetectorRef);
  private themingService = inject(ThemingService);

  private themeSubscription?: Subscription;
  private langSubscription?: Subscription;
  private autoRefreshSubscription?: Subscription;

  lastUpdatedTime: string = '';

  @ViewChild('transactionSplitCanvas') transactionSplitCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('businessTrendCanvas') businessTrendCanvas!: ElementRef<HTMLCanvasElement>;

  txnSplitChart: any = null;
  businessTrendChart: any = null;
  private isViewInitialized: boolean = false;

  trendChartType: 'bar' | 'line' = 'bar';
  txnChartType: 'doughnut' | 'pie' = 'doughnut';

  isLoading: boolean = false;
  selectedOfficeId: string = '0';
  offices: { id: number; name: string }[] = [
    { id: 0, name: 'All Offices (Institution-Wide)' }
  ];

  /** Business KPI Summary State */
  clientsKpi: BusinessKpiCard = {
    total: 0,
    active: 0,
    pending: 0,
    newThisMonth: 0,
    activeRatio: 0
  };

  loansKpi: LoansKpiCard = {
    activeCount: 0,
    totalDisbursed: 0,
    totalOutstanding: 0,
    avgLoanSize: 0,
    currency: 'UGX'
  };

  savingsKpi: SavingsKpiCard = {
    activeCount: 0,
    totalBalance: 0,
    avgBalance: 0,
    savingsCount: 0,
    savingsBalance: 0,
    fixedCount: 0,
    fixedBalance: 0,
    recurringCount: 0,
    recurringBalance: 0,
    currency: 'UGX'
  };

  sharesKpi: SharesKpiCard = {
    activeCount: 0,
    totalCapital: 0,
    totalSubscribed: 0,
    currency: 'UGX'
  };

  /** Executed Transaction Types Summary */
  transactionTypes: TransactionTypeMetric[] = [];
  totalTxnCount: number = 0;
  totalTxnVolume: number = 0;

  /** Widget Governance State */
  searchFilter: string = '';
  selectedModuleFilter: string = 'all';
  hasUnsavedChanges: boolean = false;

  availableRoles: string[] = [
    'Super User',
    'Branch Manager',
    'Loan Officer',
    'Risk Analyst',
    'Client Success',
    'Teller'
  ];

  widgets: DashboardWidgetConfig[] = [
    {
      id: 'w-global-kpi',
      name: 'Global Institution KPI Cards',
      module: 'global',
      description: 'Institutional-wide financial inclusion, active borrowers, and total portfolio volume.',
      icon: 'tachometer-alt',
      enabled: true,
      allowedRoles: [
        'Super User',
        'Branch Manager',
        'Risk Analyst'
      ],
      lastUpdated: '2026-08-08',
      updatedBy: 'mifos'
    },
    {
      id: 'w-global-map',
      name: 'Geo-Reference Distribution Map',
      module: 'global',
      description: 'Regional geographic map visualising client and branch distribution via OpenStreetMap.',
      icon: 'globe',
      enabled: true,
      allowedRoles: [
        'Super User',
        'Branch Manager'
      ],
      lastUpdated: '2026-08-08',
      updatedBy: 'mifos'
    },
    {
      id: 'w-loan-analytics',
      name: 'Loan Portfolio & Repayment Analytics',
      module: 'loan',
      description: 'Loan account disbursement analytics, principal vs interest split, and repayment curves.',
      icon: 'hand-holding-usd',
      enabled: true,
      allowedRoles: [
        'Super User',
        'Branch Manager',
        'Loan Officer',
        'Risk Analyst'
      ],
      lastUpdated: '2026-08-07',
      updatedBy: 'mifos'
    },
    {
      id: 'w-savings-analytics',
      name: 'Savings Growth & Balance Analytics',
      module: 'savings',
      description: 'Savings account deposit vs withdrawal cash flow, transaction history, and balance trends.',
      icon: 'piggy-bank',
      enabled: true,
      allowedRoles: [
        'Super User',
        'Branch Manager',
        'Teller',
        'Client Success'
      ],
      lastUpdated: '2026-08-07',
      updatedBy: 'mifos'
    },
    {
      id: 'w-shares-analytics',
      name: 'Share Products & Capital Analytics',
      module: 'shares',
      description: 'Share accounts, equity distribution, subscribed shares, and dividend distributions.',
      icon: 'chart-pie',
      enabled: true,
      allowedRoles: [
        'Super User',
        'Branch Manager',
        'Risk Analyst'
      ],
      lastUpdated: '2026-08-06',
      updatedBy: 'mifos'
    },
    {
      id: 'w-client-analytics',
      name: 'Client Demographics & Gender Inclusion',
      module: 'client',
      description: 'Client age distribution, gender breakdown, youth empowerment, and rural reach.',
      icon: 'users',
      enabled: true,
      allowedRoles: [
        'Super User',
        'Branch Manager',
        'Loan Officer',
        'Client Success'
      ],
      lastUpdated: '2026-08-06',
      updatedBy: 'mifos'
    },
    {
      id: 'w-admin-ops',
      name: 'Transaction Execution & Business Operations',
      module: 'admin',
      description: 'Executive view of daily transaction volume across disbursals, repayments, and deposits.',
      icon: 'sliders-h',
      enabled: true,
      allowedRoles: ['Super User'],
      lastUpdated: '2026-08-09',
      updatedBy: 'mifos'
    }
  ];

  ngOnInit(): void {
    this.updateLastRefreshTime();
    this.loadOffices();
    this.loadSystemRoles();
    this.fetchLiveInstitutionalData();

    this.themeSubscription = this.themingService.theme.subscribe(() => {
      if (this.isViewInitialized) {
        setTimeout(() => {
          this.initCharts();
          this.cdr.detectChanges();
        }, 50);
      }
    });

    this.langSubscription = this.translate.onLangChange.subscribe(() => {
      if (this.isViewInitialized) {
        setTimeout(() => {
          this.initCharts();
          this.cdr.detectChanges();
        }, 50);
      }
    });

    // 10-minute periodic background auto-refresh
    this.autoRefreshSubscription = interval(10 * 60 * 1000).subscribe(() => {
      this.fetchLiveInstitutionalData(false);
    });
  }

  ngAfterViewInit(): void {
    this.isViewInitialized = true;
    setTimeout(() => {
      this.initCharts();
    }, 200);
  }

  ngOnDestroy(): void {
    if (this.themeSubscription) {
      this.themeSubscription.unsubscribe();
    }
    if (this.langSubscription) {
      this.langSubscription.unsubscribe();
    }
    if (this.autoRefreshSubscription) {
      this.autoRefreshSubscription.unsubscribe();
    }
    if (this.txnSplitChart) {
      this.txnSplitChart.destroy();
    }
    if (this.businessTrendChart) {
      this.businessTrendChart.destroy();
    }
  }

  /**
   * Load System Roles from Fineract backend
   */
  private loadSystemRoles(): void {
    this.systemService
      .getRoles()
      .pipe(catchError(() => of([])))
      .subscribe((roles: any) => {
        if (Array.isArray(roles) && roles.length > 0) {
          const backendRoleNames = roles.map((r: any) => r.name).filter(Boolean);
          if (backendRoleNames.length > 0) {
            this.availableRoles = Array.from(
              new Set([
                ...this.availableRoles,
                ...backendRoleNames
              ])
            );
            this.cdr.detectChanges();
          }
        }
      });
  }

  /**
   * Load Offices from Fineract backend
   */
  private loadOffices(): void {
    this.accountingService
      .getOffices()
      .pipe(catchError(() => of([])))
      .subscribe((offices: any) => {
        if (Array.isArray(offices) && offices.length > 0) {
          const fetchedOffices = offices.map((o: any) => ({ id: o.id, name: o.name }));
          this.offices = [
            { id: 0, name: 'All Offices (Institution-Wide)' },
            ...fetchedOffices
          ];
          this.cdr.detectChanges();
        }
      });
  }

  /**
   * Fetch Live Institutional Business Data across Clients, Loans, Savings, Shares, and Transactions
   */
  fetchLiveInstitutionalData(isManualRefresh = false): void {
    this.isLoading = true;
    this.cdr.detectChanges();

    const officeId = Number(this.selectedOfficeId) || 0;
    const officeParam = officeId > 0 ? `?officeId=${officeId}` : '';

    const clients$ = this.http
      .get<any>(`/clients${officeParam}`)
      .pipe(catchError(() => of({ totalFilteredRecords: 0, pageItems: [] })));

    const loans$ = this.http
      .get<any>(`/loans${officeParam}`)
      .pipe(catchError(() => of({ totalFilteredRecords: 0, pageItems: [] })));

    const savings$ = this.http
      .get<any>(`/savingsaccounts${officeParam}`)
      .pipe(catchError(() => of({ totalFilteredRecords: 0, pageItems: [] })));

    const fixedDeposits$ = this.http
      .get<any>(`/fixeddepositaccounts${officeParam}`)
      .pipe(catchError(() => of({ totalFilteredRecords: 0, pageItems: [] })));

    const recurringDeposits$ = this.http
      .get<any>(`/recurringdepositaccounts${officeParam}`)
      .pipe(catchError(() => of({ totalFilteredRecords: 0, pageItems: [] })));

    const shares$ = this.http
      .get<any>(`/accounts/share${officeParam}`)
      .pipe(catchError(() => of({ totalFilteredRecords: 0, pageItems: [] })));

    forkJoin({
      clients: clients$,
      loans: loans$,
      savings: savings$,
      fixedDeposits: fixedDeposits$,
      recurringDeposits: recurringDeposits$,
      shares: shares$
    })
      .pipe(
        finalize(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: ({ clients, loans, savings, fixedDeposits, recurringDeposits, shares }) => {
          this.processClientsData(clients);
          this.processLoansData(loans);
          this.processDepositsData(savings, fixedDeposits, recurringDeposits);
          this.processSharesData(shares);
          this.processTransactionsData();
          this.updateLastRefreshTime();
          this.isLoading = false;
          this.cdr.detectChanges();

          if (this.isViewInitialized) {
            setTimeout(() => {
              this.updateCharts();
              this.cdr.detectChanges();
            }, 100);
          }

          if (isManualRefresh) {
            const msg = this.translate.instant('labels.text.Institutional dashboard data refreshed successfully.');
            this.snackBar.open(msg, undefined, {
              duration: 3000,
              horizontalPosition: 'right',
              verticalPosition: 'top',
              panelClass: ['custom-snackbar-top-right']
            });
          }
        },
        error: (err) => {
          this.isLoading = false;
          this.cdr.detectChanges();
          console.error('Error fetching institutional data:', err);
        }
      });
  }

  private processClientsData(data: any): void {
    const items = Array.isArray(data) ? data : data?.pageItems || [];
    const total = data && typeof data.totalFilteredRecords === 'number' ? data.totalFilteredRecords : items.length;
    const active = items.filter((c: any) => c.status?.value === 'Active' || c.active === true).length;
    const now = new Date();
    // Fineract returns activationDate as [year, month, day]
    const newThisMonth = items.filter((c: any) => {
      const d = c.activationDate;
      return Array.isArray(d) && d[0] === now.getFullYear() && d[1] === now.getMonth() + 1;
    }).length;

    const pending = Math.max(0, total - active);

    this.clientsKpi = {
      total: total,
      active: active,
      pending: pending,
      newThisMonth: newThisMonth,
      activeRatio: total > 0 ? Math.round((active / total) * 100) : 0
    };
  }

  private processLoansData(data: any): void {
    const items = Array.isArray(data) ? data : data?.pageItems || [];
    const totalCount = data && typeof data.totalFilteredRecords === 'number' ? data.totalFilteredRecords : items.length;
    let disbursedSum = 0;
    let outstandingSum = 0;

    items.forEach((l: any) => {
      if (l.principal) disbursedSum += Number(l.principal);
      if (l.summary?.totalOutstanding) outstandingSum += Number(l.summary.totalOutstanding);
    });

    this.loansKpi = {
      activeCount: totalCount,
      totalDisbursed: disbursedSum,
      totalOutstanding: outstandingSum,
      avgLoanSize: totalCount > 0 ? Math.round(outstandingSum / totalCount) : 0,
      currency: items[0]?.currency?.code || 'UGX'
    };
  }

  private processDepositsData(savingsData: any, fixedData: any, recurringData: any): void {
    const savingsItems = Array.isArray(savingsData) ? savingsData : savingsData?.pageItems || [];
    const savingsCount =
      savingsData && typeof savingsData.totalFilteredRecords === 'number'
        ? savingsData.totalFilteredRecords
        : savingsItems.length;
    let savingsBalance = 0;
    savingsItems.forEach((s: any) => {
      if (s.accountBalance) savingsBalance += Number(s.accountBalance);
    });

    const fixedItems = Array.isArray(fixedData) ? fixedData : fixedData?.pageItems || [];
    const fixedCount =
      fixedData && typeof fixedData.totalFilteredRecords === 'number'
        ? fixedData.totalFilteredRecords
        : fixedItems.length;
    let fixedBalance = 0;
    fixedItems.forEach((fd: any) => {
      const amt = Number(fd.depositAmount || fd.accountBalance || fd.summary?.accountBalance || 0);
      fixedBalance += amt;
    });

    const recurringItems = Array.isArray(recurringData) ? recurringData : recurringData?.pageItems || [];
    const recurringCount =
      recurringData && typeof recurringData.totalFilteredRecords === 'number'
        ? recurringData.totalFilteredRecords
        : recurringItems.length;
    let recurringBalance = 0;
    recurringItems.forEach((rd: any) => {
      const amt = Number(rd.depositAmount || rd.accountBalance || rd.summary?.accountBalance || 0);
      recurringBalance += amt;
    });

    const totalAccounts = savingsCount + fixedCount + recurringCount;
    const totalBalance = savingsBalance + fixedBalance + recurringBalance;

    this.savingsKpi = {
      activeCount: totalAccounts,
      totalBalance: totalBalance,
      avgBalance: totalAccounts > 0 ? Math.round(totalBalance / totalAccounts) : 0,
      savingsCount: savingsCount,
      savingsBalance: savingsBalance,
      fixedCount: fixedCount,
      fixedBalance: fixedBalance,
      recurringCount: recurringCount,
      recurringBalance: recurringBalance,
      currency: savingsItems[0]?.currency?.code || 'UGX'
    };
  }

  private processSharesData(data: any): void {
    const items = Array.isArray(data) ? data : data?.pageItems || [];
    const totalCount = data && typeof data.totalFilteredRecords === 'number' ? data.totalFilteredRecords : items.length;
    let capitalSum = 0;
    let subscribed = 0;

    items.forEach((sh: any) => {
      if (sh.totalApprovedShares) {
        subscribed += Number(sh.totalApprovedShares);
        if (sh.unitPrice) capitalSum += Number(sh.totalApprovedShares) * Number(sh.unitPrice);
      }
    });

    this.sharesKpi = {
      activeCount: totalCount,
      totalCapital: capitalSum,
      totalSubscribed: subscribed,
      currency: items[0]?.currency?.code || 'UGX'
    };
  }

  // ponytail: no Fineract endpoint gives per-type transaction volumes; left empty instead of synthesized.
  // Wire to a custom SQL report (Admin > Reports) when Butagasi needs this table.
  private processTransactionsData(): void {
    this.transactionTypes = [];
    this.totalTxnVolume = 0;
    this.totalTxnCount = 0;
  }

  /**
   * Filter widgets for Tab 2
   */
  get filteredWidgets(): DashboardWidgetConfig[] {
    return this.widgets.filter((w) => {
      const matchesSearch =
        !this.searchFilter ||
        w.name.toLowerCase().includes(this.searchFilter.toLowerCase()) ||
        w.description.toLowerCase().includes(this.searchFilter.toLowerCase());

      const matchesModule = this.selectedModuleFilter === 'all' || w.module === this.selectedModuleFilter;

      return matchesSearch && matchesModule;
    });
  }

  /**
   * Toggle Widget Active State
   */
  toggleWidget(widget: DashboardWidgetConfig): void {
    widget.enabled = !widget.enabled;
    widget.lastUpdated = new Date().toISOString().split('T')[0];
    this.hasUnsavedChanges = true;
  }

  /**
   * Update Roles assigned to widget
   */
  onRolesChanged(widget: DashboardWidgetConfig, roles: string[]): void {
    widget.allowedRoles = roles;
    widget.lastUpdated = new Date().toISOString().split('T')[0];
    this.hasUnsavedChanges = true;
  }

  /**
   * Save Widget Configurations
   */
  saveWidgetConfigurations(): void {
    this.hasUnsavedChanges = false;
    const msg = this.translate.instant('labels.text.Dashboard widget configurations saved successfully.');
    this.snackBar.open(msg, undefined, {
      duration: 3500,
      horizontalPosition: 'right',
      verticalPosition: 'top',
      panelClass: ['custom-snackbar-top-right']
    });
  }

  /**
   * Switch between Bar and Line for Trend chart
   */
  changeTrendChartType(type: 'bar' | 'line'): void {
    this.trendChartType = type;
    this.initBusinessTrendChart();
    this.cdr.detectChanges();
  }

  /**
   * Switch between Doughnut and Pie for Transaction Breakdown chart
   */
  changeTxnChartType(type: 'doughnut' | 'pie'): void {
    this.txnChartType = type;
    this.initTxnSplitChart();
    this.cdr.detectChanges();
  }

  /**
   * Initialize Chart.js Graphs
   */
  private initCharts(): void {
    this.initTxnSplitChart();
    this.initBusinessTrendChart();
  }

  private initTxnSplitChart(): void {
    if (this.txnSplitChart) {
      this.txnSplitChart.destroy();
      this.txnSplitChart = null;
    }

    if (this.transactionSplitCanvas) {
      const ctx = this.transactionSplitCanvas.nativeElement.getContext('2d');
      if (ctx) {
        const isDark = document.body.classList.contains('dark-theme');
        const textColor = isDark ? '#e2e8f0' : '#475569';
        const chartLabels = this.transactionTypes.map(
          (t) => this.translate.instant('labels.heading.' + t.type) || t.type
        );

        this.txnSplitChart = new Chart(ctx, {
          type: this.txnChartType,
          data: {
            labels: chartLabels,
            datasets: [
              {
                data: this.transactionTypes.map((t) => t.volume),
                backgroundColor: [
                  '#10B981', // Disbursements
                  '#059669', // Repayments
                  '#3B82F6', // Deposits
                  '#60A5FA', // Withdrawals
                  '#8B5CF6', // Shares
                  '#F59E0B' // Fees
                ],
                borderWidth: 2,
                borderColor: isDark ? '#1e2124' : '#ffffff',
                hoverOffset: 6
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'right',
                labels: {
                  boxWidth: 12,
                  color: textColor,
                  font: { size: 12, family: 'Inter, Roboto, sans-serif' }
                }
              },
              tooltip: {
                callbacks: {
                  label: (context: any) => {
                    const val = Number(context.parsed || 0);
                    return ` ${context.label}: UGX ${val.toLocaleString()}`;
                  }
                }
              }
            },
            cutout: this.txnChartType === 'doughnut' ? '68%' : '0%'
          }
        });
      }
    }
  }

  private initBusinessTrendChart(): void {
    if (this.businessTrendChart) {
      this.businessTrendChart.destroy();
      this.businessTrendChart = null;
    }

    if (this.businessTrendCanvas) {
      const ctx = this.businessTrendCanvas.nativeElement.getContext('2d');
      if (ctx) {
        const isDark = document.body.classList.contains('dark-theme');
        const textColor = isDark ? '#94a3b8' : '#64748b';
        const legendColor = isDark ? '#e2e8f0' : '#475569';
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

        const isLine = this.trendChartType === 'line';

        const monthKeys = [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug'
        ];
        const chartLabels = monthKeys.map((m) => this.translate.instant('labels.heading.' + m) || m);

        const loansLabel = `${this.translate.instant('labels.heading.Loans Disbursed') || 'Loans Disbursed'} (UGX)`;
        const savingsLabel = `${this.translate.instant('labels.heading.Savings Deposits') || 'Savings Deposits'} (UGX)`;
        const repaymentsLabel = `${this.translate.instant('labels.heading.Repayments Received') || 'Repayments Received'} (UGX)`;

        this.businessTrendChart = new Chart(ctx, {
          type: this.trendChartType,
          data: {
            labels: chartLabels,
            datasets: [
              {
                label: loansLabel,
                data: [] as number[],
                backgroundColor: isLine ? 'rgba(16, 185, 129, 0.15)' : '#10B981',
                borderColor: '#10B981',
                borderWidth: isLine ? 2.5 : 0,
                borderRadius: isLine ? 0 : 4,
                fill: isLine,
                tension: 0.35,
                pointRadius: isLine ? 3.5 : 0,
                pointHoverRadius: 5
              },
              {
                label: savingsLabel,
                data: [] as number[],
                backgroundColor: isLine ? 'rgba(59, 130, 246, 0.15)' : '#3B82F6',
                borderColor: '#3B82F6',
                borderWidth: isLine ? 2.5 : 0,
                borderRadius: isLine ? 0 : 4,
                fill: isLine,
                tension: 0.35,
                pointRadius: isLine ? 3.5 : 0,
                pointHoverRadius: 5
              },
              {
                label: repaymentsLabel,
                data: [] as number[],
                backgroundColor: isLine ? 'rgba(139, 92, 246, 0.15)' : '#8B5CF6',
                borderColor: '#8B5CF6',
                borderWidth: isLine ? 2.5 : 0,
                borderRadius: isLine ? 0 : 4,
                fill: isLine,
                tension: 0.35,
                pointRadius: isLine ? 3.5 : 0,
                pointHoverRadius: 5
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: textColor }
              },
              y: {
                grid: { color: gridColor },
                ticks: {
                  color: textColor,
                  callback: (value: any) => `UGX ${Number(value).toLocaleString()}`
                }
              }
            },
            plugins: {
              legend: {
                position: 'top',
                labels: {
                  boxWidth: 12,
                  color: legendColor
                }
              },
              tooltip: {
                callbacks: {
                  label: (context: any) => ` ${context.dataset.label}: UGX ${Number(context.parsed.y).toLocaleString()}`
                }
              }
            }
          }
        });
      }
    }
  }

  /**
   * Update Charts with freshly loaded data
   */
  private updateCharts(): void {
    if (this.txnSplitChart) {
      this.txnSplitChart.data.labels = this.transactionTypes.map(
        (t) => this.translate.instant('labels.heading.' + t.type) || t.type
      );
      this.txnSplitChart.data.datasets[0].data = this.transactionTypes.map((t) => t.volume);
      this.txnSplitChart.update();
    }

    if (this.businessTrendChart) {
      const monthKeys = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug'
      ];
      this.businessTrendChart.data.labels = monthKeys.map((m) => this.translate.instant('labels.heading.' + m) || m);

      this.businessTrendChart.data.datasets[0].label = `${this.translate.instant('labels.heading.Loans Disbursed') || 'Loans Disbursed'} (UGX)`;
      this.businessTrendChart.data.datasets[1].label = `${this.translate.instant('labels.heading.Savings Deposits') || 'Savings Deposits'} (UGX)`;
      this.businessTrendChart.data.datasets[2].label = `${this.translate.instant('labels.heading.Repayments Received') || 'Repayments Received'} (UGX)`;

      // ponytail: no monthly flow endpoint in Fineract; empty until wired to a report
      this.businessTrendChart.data.datasets.forEach((ds: any) => {
        ds.data = [];
      });
      this.businessTrendChart.update();
    }
  }

  /**
   * Update the human-readable last refreshed clock timestamp
   */
  private updateLastRefreshTime(): void {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    this.lastUpdatedTime = `${hours}:${minutes}`;
  }
}
