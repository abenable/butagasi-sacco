/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';

import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import {
  AnalyticsDetailItem,
  AnalyticsFilters,
  AnalyticsTimescale,
  AnalyticsWidgetDefinition,
  AnalyticsWidgetState
} from '../models/analytics-dashboard.model';

@Injectable({
  providedIn: 'root'
})
export class AnalyticsDataSourceService {
  private getMetricTrend(
    widgetId: string,
    actualPercent?: number,
    actualPositive?: boolean
  ): { trendPercent?: number; trendPositive?: boolean } {
    if (actualPercent !== undefined && !Number.isNaN(actualPercent)) {
      return { trendPercent: actualPercent, trendPositive: actualPositive };
    }
    return {};
  }
  private http = inject(HttpClient);
  private translateService = inject(TranslateService);

  private reportCache = new Map<string, Observable<any>>();
  /** Potentially better formatting? */
  loadWidget(widget: AnalyticsWidgetDefinition, filters: AnalyticsFilters): Observable<AnalyticsWidgetState> {
    switch (widget.adapter) {
      case 'client-total':
        return this.loadTrendMetric(filters, 'client');
      case 'loan-total':
        return this.loadTrendMetric(filters, 'loan');
      case 'collection-total':
        return this.loadAmountMetric(filters, 'Demand Vs Collection');
      case 'disbursement-total':
        return this.loadAmountMetric(filters, 'Disbursal Vs Awaitingdisbursal');
      case 'savings-total':
        return this.loadSavingsMetric(filters);
      case 'women-borrowers-total':
        return this.loadInclusionMetric(filters, 'Women Borrowers Report');
      case 'rural-clients-total':
        return this.loadInclusionMetric(filters, 'Rural Clients Report');
      case 'youth-clients-total':
        return this.loadInclusionMetric(filters, 'Youth Clients Report');
      case 'average-loan-size-total':
        return this.loadAverageLoanSize(filters);
      case 'client-loan-trends':
        return this.loadTrendChart(filters);
      case 'collection-breakdown':
        return this.loadAmountChart(filters, 'Demand Vs Collection', 'labels.inputs.Amount Collected');
      case 'disbursement-breakdown':
        return this.loadAmountChart(filters, 'Disbursal Vs Awaitingdisbursal', 'labels.catalogs.Disbursement');
      case 'savings-growth-trends':
        return this.loadSavingsGrowthChart(filters);
      case 'portfolio-growth-by-group':
        return this.loadPortfolioGrowthByGroup(filters);
      case 'new-client-onboarding-trends':
        return this.loadNewClientOnboardingTrends(filters);
      default:
        return of({
          loading: false,
          empty: true
        });
    }
  }

  clearCache(): void {
    this.reportCache.clear();
  }

  private loadTrendMetric(filters: AnalyticsFilters, type: 'client' | 'loan'): Observable<AnalyticsWidgetState> {
    return this.loadTrendSeries(filters, type).pipe(
      map((series) => {
        let actualPercent: number | undefined;
        let actualPositive = true;
        if (series && series.length >= 2) {
          const current = series[series.length - 1];
          const previous = series[series.length - 2];
          if (previous > 0) {
            const pct = ((current - previous) / previous) * 100;
            actualPercent = Math.abs(pct);
            actualPositive = pct >= 0;
          }
        }
        const total = series.reduce((sum, value) => sum + value, 0);
        const trend = this.getMetricTrend(
          type === 'client' ? 'clients-total' : 'loans-total',
          actualPercent,
          actualPositive
        );
        return {
          loading: false,
          empty: false,
          metricValue: total,
          trendPercent: trend.trendPercent,
          trendPositive: trend.trendPositive,
          contextKey: this.getTimescaleKey(filters.timescale)
        };
      }),
      catchError(() => of({ loading: false, empty: true }))
    );
  }

  private loadAmountMetric(filters: AnalyticsFilters, reportName: string): Observable<AnalyticsWidgetState> {
    const widgetId = reportName === 'Demand Vs Collection' ? 'collection-total' : 'disbursement-total';
    return this.runReport(reportName, this.buildReportParams(filters)).pipe(
      map((response) => {
        const [
          pending,
          complete
        ] = this.extractAmountPair(response, reportName);
        const net = complete - pending;
        const pctDiff = pending > 0 ? ((complete - pending) / pending) * 100 : undefined;
        const trend = this.getMetricTrend(widgetId, pctDiff !== undefined ? Math.abs(pctDiff) : undefined, net >= 0);
        return {
          loading: false,
          empty: false,
          metricValue: net,
          trendPercent: trend.trendPercent,
          trendPositive: trend.trendPositive
        };
      }),
      catchError(() => of({ loading: false, empty: true }))
    );
  }

  private loadSavingsMetric(filters: AnalyticsFilters): Observable<AnalyticsWidgetState> {
    return this.runReport('Savings Summary', this.buildReportParams(filters)).pipe(
      map((response: any[]) => {
        const firstRow = response?.[0] || {};
        const keys = [
          'savings',
          'total',
          'amount',
          'balance'
        ];
        const value = this.findValueByKeywords(firstRow, keys);
        const trend = this.getMetricTrend('savings-total');
        return {
          loading: false,
          empty: value === 0,
          metricValue: value,
          trendPercent: trend.trendPercent,
          trendPositive: trend.trendPositive
        };
      }),
      catchError(() => of({ loading: false, empty: true }))
    );
  }

  private loadInclusionMetric(filters: AnalyticsFilters, reportName: string): Observable<AnalyticsWidgetState> {
    return this.runReport(reportName, this.buildReportParams(filters)).pipe(
      map((response: any[]) => {
        const firstRow = response?.[0] || {};
        const keys = [
          'count',
          'name',
          'category'
        ];
        const value = this.findValueByKeywords(firstRow, keys);
        let widgetId = 'women-borrowers-total';
        if (reportName.includes('Rural')) {
          widgetId = 'rural-clients-total';
        } else if (reportName.includes('Youth')) {
          widgetId = 'youth-clients-total';
        }
        const trend = this.getMetricTrend(widgetId);
        return {
          loading: false,
          empty: value === 0,
          metricValue: value,
          trendPercent: trend.trendPercent,
          trendPositive: trend.trendPositive
        };
      }),
      catchError(() => of({ loading: false, empty: true }))
    );
  }

  private loadAverageLoanSize(filters: AnalyticsFilters): Observable<AnalyticsWidgetState> {
    return this.runReport('Loan Portfolio Report', this.buildReportParams(filters)).pipe(
      map((response: any[]) => {
        const firstRow = response?.[0] || {};
        const keys = [
          'average',
          'avg',
          'mean',
          'size'
        ];
        const value = this.findValueByKeywords(firstRow, keys);
        const trend = this.getMetricTrend('average-loan-size-total');
        return {
          loading: false,
          empty: value === 0,
          metricValue: value,
          trendPercent: trend.trendPercent,
          trendPositive: trend.trendPositive
        };
      }),
      catchError(() => of({ loading: false, empty: true }))
    );
  }

  private loadTrendChart(filters: AnalyticsFilters): Observable<AnalyticsWidgetState> {
    return forkJoin([
      this.loadTrendSeries(filters, 'client'),
      this.loadTrendSeries(filters, 'loan')
    ]).pipe(
      map(
        ([
          clients,
          loans
        ]) => {
          return {
            loading: false,
            empty: false,
            labels: this.getTimescaleLabels(filters.timescale),
            translateLabels: false,
            datasets: [
              {
                labelKey: 'labels.inputs.Clients',
                data: clients,
                backgroundColor: '#1565c0',
                borderColor: '#1565c0',
                borderWidth: 1
              },
              {
                labelKey: 'labels.menus.Loans',
                data: loans,
                backgroundColor: '#2e7d32',
                borderColor: '#2e7d32',
                borderWidth: 1
              }
            ],
            details: [
              {
                labelKey: 'labels.inputs.Clients',
                value: clients.reduce((sum, value) => sum + value, 0)
              },
              {
                labelKey: 'labels.menus.Loans',
                value: loans.reduce((sum, value) => sum + value, 0)
              }
            ]
          };
        }
      ),
      catchError(() => of({ loading: false, empty: true }))
    );
  }

  private loadAmountChart(
    filters: AnalyticsFilters,
    reportName: string,
    completeLabelKey: string
  ): Observable<AnalyticsWidgetState> {
    return this.runReport(reportName, this.buildReportParams(filters)).pipe(
      map((response) => {
        const [
          pending,
          complete
        ] = this.extractAmountPair(response, reportName);
        const pendingAmount = Math.max(0, pending);
        const completeAmount = Math.max(0, complete);
        return {
          loading: false,
          empty: pendingAmount === 0 && completeAmount === 0,
          labels: [
            'labels.status.Pending',
            completeLabelKey
          ],
          translateLabels: true,
          datasets: [
            {
              labelKey: completeLabelKey,
              data: [
                pendingAmount,
                completeAmount
              ],
              backgroundColor: [
                '#29b6f6',
                '#ef5350'
              ],
              borderWidth: 1,
              borderColor: '#ffffff'
            }
          ],
          details: [
            {
              labelKey: 'labels.status.Pending',
              value: pendingAmount
            },
            {
              labelKey: completeLabelKey,
              value: completeAmount
            }
          ]
        };
      }),
      catchError(() => of({ loading: false, empty: true }))
    );
  }

  private loadSavingsGrowthChart(filters: AnalyticsFilters): Observable<AnalyticsWidgetState> {
    const reportName = `Savings Growth Report`;
    return this.runReport(reportName, this.buildReportParams(filters)).pipe(
      map((response: any[]) => {
        const labels = this.getTimescaleLabels(filters.timescale);
        const data = labels.map((label) => {
          const entry = response.find((item) => this.resolveTrendLabel(item, filters.timescale) === label);
          const keys = [
            'amount',
            'balance',
            'savings'
          ];
          return entry ? this.findValueByKeywords(entry, keys) || 0 : 0;
        });
        return {
          loading: false,
          empty: data.every((v) => v === 0),
          labels,
          translateLabels: false,
          datasets: [
            {
              labelKey: 'labels.menus.Savings',
              data,
              backgroundColor: 'rgba(56, 142, 60, 0.15)',
              borderColor: '#388e3c',
              borderWidth: 2
            }
          ],
          details: [
            {
              labelKey: 'labels.menus.Savings',
              value: data.reduce((sum, v) => sum + v, 0)
            }
          ]
        };
      }),
      catchError(() => of({ loading: false, empty: true }))
    );
  }

  private loadPortfolioGrowthByGroup(filters: AnalyticsFilters): Observable<AnalyticsWidgetState> {
    return this.runReport('Portfolio Growth By Group', this.buildReportParams(filters)).pipe(
      map((response: any[]) => {
        const labels = this.getTimescaleLabels(filters.timescale);
        const activeBorrowers = labels.map((label) => {
          const entry = response.find(
            (item) =>
              this.resolveTrendLabel(item, filters.timescale) === label &&
              (item.group || '').toLowerCase().includes('borrow')
          );
          return Number(entry?.portfolio || entry?.amount || 0);
        });
        const activeSavers = labels.map((label) => {
          const entry = response.find(
            (item) =>
              this.resolveTrendLabel(item, filters.timescale) === label &&
              (item.group || '').toLowerCase().includes('sav')
          );
          return Number(entry?.portfolio || entry?.amount || 0);
        });
        const portfolioSnapshot = labels.map((label) => {
          const entry = response.find((item) => this.resolveTrendLabel(item, filters.timescale) === label);
          return Number(entry?.portfolio || entry?.amount || 0);
        });
        return {
          loading: false,
          empty: portfolioSnapshot.every((v) => v === 0),
          labels,
          translateLabels: false,
          datasets: [
            {
              labelKey: 'labels.text.Active Borrowers',
              data: activeBorrowers,
              backgroundColor: '#1565c0',
              borderColor: '#1565c0',
              borderWidth: 1
            },
            {
              labelKey: 'labels.text.Active Savers',
              data: activeSavers,
              backgroundColor: '#388e3c',
              borderColor: '#388e3c',
              borderWidth: 1
            },
            {
              labelKey: 'labels.text.Portfolio Snapshot',
              data: portfolioSnapshot,
              backgroundColor: '#f57c00',
              borderColor: '#f57c00',
              borderWidth: 1
            }
          ],
          details: [] as AnalyticsDetailItem[]
        };
      }),
      catchError(() => of({ loading: false, empty: true }))
    );
  }


  private loadNewClientOnboardingTrends(filters: AnalyticsFilters): Observable<AnalyticsWidgetState> {
    return this.runReport('New Client Onboarding Report', this.buildReportParams(filters)).pipe(
      map((response: any[]) => {
        const labels = this.getTimescaleLabels(filters.timescale);
        const data = labels.map((label) => {
          const entry = response.find((item) => this.resolveTrendLabel(item, filters.timescale) === label);
          const keys = [
            'newclients',
            'count'
          ];
          return entry ? this.findValueByKeywords(entry, keys) || 0 : 0;
        });
        return {
          loading: false,
          empty: data.every((v) => v === 0),
          labels,
          translateLabels: false,
          datasets: [
            {
              labelKey: 'labels.text.New Clients',
              data,
              backgroundColor: 'rgba(21, 101, 192, 0.15)',
              borderColor: '#1565c0',
              borderWidth: 2
            }
          ],
          details: [
            {
              labelKey: 'labels.text.New Clients',
              value: data.reduce((sum, v) => sum + v, 0)
            }
          ]
        };
      }),
      catchError(() => of({ loading: false, empty: true }))
    );
  }

  private loadTrendSeries(filters: AnalyticsFilters, type: 'client' | 'loan'): Observable<number[]> {
    const reportName = this.getTrendReportName(filters.timescale, type);
    const labels = this.getTimescaleLabels(filters.timescale);
    const valueField = type === 'client' ? 'count' : 'lcount';

    return this.runReport(reportName, this.buildReportParams(filters)).pipe(
      map((response: any[]) =>
        labels.map((label) => {
          const entry = response.find((item) => this.resolveTrendLabel(item, filters.timescale) === label);
          return Number(entry?.[valueField] || 0);
        })
      )
    );
  }

  private buildReportParams(filters: AnalyticsFilters): Record<string, string | number> {
    const params: Record<string, string | number> = {
      genericResultSet: 'false'
    };

    // Just avoid forcing an invalid id
    if (filters.officeId !== null && filters.officeId !== undefined) {
      params['R_officeId'] = filters.officeId;
    }

    // Note: productId is NOT sent to backend reports — most reports do not register this parameter
    // and sending it causes an "Input validation error: unknown report parameter" from the API.

    // Note: clientGroupId is NOT sent — most reports do not register this parameter
    // and sending it causes an "Input validation error: unknown report parameter" from the API.

    return params;
  }

  private runReport(reportName: string, params: Record<string, string | number>): Observable<any> {
    let httpParams = new HttpParams();
    const sortedParams = Object.keys(params).sort();

    sortedParams.forEach((key) => {
      httpParams = httpParams.set(key, `${params[key]}`);
    });

    const cacheKey = `${reportName}:${httpParams.toString()}`;
    const cached = this.reportCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const request$ = this.http.get(`/runreports/${reportName}`, { params: httpParams }).pipe(shareReplay(1));
    this.reportCache.set(cacheKey, request$);
    return request$;
  }

  private extractAmountPair(response: any[], reportName: string): [
    number,
    number
  ] {
    const firstRow = response?.[0] || {};
    const numericEntries = Object.entries(firstRow)
      .map(
        ([
          key,
          value
        ]) => ({
          key: key.toLowerCase(),
          value: Number(value)
        })
      )
      .filter((entry) => !Number.isNaN(entry.value));

    // Match by report field names first so we do not depend on raw object value ordering
    const pendingValue = this.findValueByKeys(numericEntries, [
      'pending',
      'awaiting',
      'demand'
    ]);
    const completeValue = this.findValueByKeys(
      numericEntries,
      reportName === 'Demand Vs Collection' ? [
            'collection',
            'collected'
          ] : [
            'disburs',
            'disbursement',
            'disbursal'
          ]
    );

    if (pendingValue !== undefined && completeValue !== undefined) {
      return [
        pendingValue,
        completeValue
      ];
    }

    // Keep a small numeric fallback for unexpected report shapes.
    const values = numericEntries.map((entry) => entry.value).slice(0, 2);

    return [
      values[0] || 0,
      values[1] || 0
    ];
  }

  private findValueByKeys(entries: { key: string; value: number }[], keys: string[]): number | undefined {
    return entries.find((entry) => keys.some((key) => entry.key.includes(key)))?.value;
  }

  private findValueByKeywords(row: Record<string, any>, keywords: string[]): number {
    const entries = Object.entries(row);
    for (const kw of keywords) {
      const found = entries.find(([k]) => k.toLowerCase().includes(kw));
      if (found !== undefined) {
        const num = Number(found[1]);
        if (!Number.isNaN(num)) {
          return num;
        }
      }
    }
    return 0;
  }

  private getTrendReportName(timescale: AnalyticsTimescale, type: 'client' | 'loan'): string {
    const base = type === 'client' ? 'ClientTrendsBy' : 'LoanTrendsBy';
    // Year uses Month reports as fallback (12 months = 1 year)
    const period = timescale === 'Year' ? 'Month' : timescale;
    return `${base}${period}`;
  }

  private resolveTrendLabel(entry: any, timescale: AnalyticsTimescale): string {
    switch (timescale) {
      case 'Day':
        return this.formatDayLabel(entry?.days);
      case 'Week':
        return `${entry?.Weeks ?? ''}`;
      case 'Month':
      case 'Year':
        return `${entry?.Months ?? ''}`;
      default:
        return '';
    }
  }

  private getTimescaleLabels(timescale: AnalyticsTimescale): string[] {
    const labels: string[] = [];
    const cursor = new Date();

    switch (timescale) {
      case 'Day':
        while (labels.length < 12) {
          cursor.setDate(cursor.getDate() - 1);
          labels.push(this.formatDayLabel(cursor));
        }
        break;
      case 'Week':
        while (labels.length < 12) {
          cursor.setDate(cursor.getDate() - 7);
          labels.push(`${this.getWeekNumber(cursor)}`);
        }
        break;
      case 'Year':
        // Show last 5 years
        while (labels.length < 5) {
          labels.push(`${cursor.getFullYear()}`);
          cursor.setFullYear(cursor.getFullYear() - 1);
        }
        break;
      case 'Month':
      default:
        while (labels.length < 12) {
          labels.push(cursor.toLocaleString(this.getActiveLocale(), { month: 'long' }));
          cursor.setMonth(cursor.getMonth() - 1);
        }
        break;
    }

    return labels.reverse();
  }

  private formatDayLabel(value: any): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return `${date.getDate()}/${date.getMonth() + 1}`;
  }

  private getWeekNumber(date: Date): number {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    return Math.ceil(((date.getTime() - firstDay.getTime()) / 86400000 + firstDay.getDay() + 1) / 7);
  }

  private getActiveLocale(): string {
    // Reuse the active month labels to follow the selected translation locale
    return this.translateService.currentLang || this.translateService.defaultLang || 'en-US';
  }

  private getTimescaleKey(timescale: AnalyticsTimescale): string {
    switch (timescale) {
      case 'Day':
        return 'labels.buttons.Day';
      case 'Week':
        return 'labels.buttons.Week';
      case 'Year':
        return 'labels.buttons.Year';
      case 'Month':
      default:
        return 'labels.buttons.Month';
    }
  }
}
