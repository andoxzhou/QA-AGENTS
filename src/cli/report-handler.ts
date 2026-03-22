// src/cli/report-handler.ts
// Aggregate test reports from shared/results/

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RESULTS_DIR = resolve(import.meta.dirname, '..', '..', 'shared', 'results');

interface ReportOutput {
  reports: Array<{ filename: string; content: string }>;
  latestSummary: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  } | null;
  timestamp: string;
}

export function queryReports(last?: number): ReportOutput {
  if (!existsSync(RESULTS_DIR)) {
    return { reports: [], latestSummary: null, timestamp: new Date().toISOString() };
  }

  // Markdown reports
  let mdFiles = readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.md') && !f.includes('snapshot'))
    .map(f => ({
      name: f,
      path: join(RESULTS_DIR, f),
      mtime: statSync(join(RESULTS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (last && last > 0) {
    mdFiles = mdFiles.slice(0, last);
  }

  const reports = mdFiles.map(f => ({
    filename: f.name,
    content: readFileSync(f.path, 'utf-8'),
  }));

  // Aggregate latest summary from JSON results
  const jsonFiles = readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => join(RESULTS_DIR, f));

  let passed = 0, failed = 0, skipped = 0;
  for (const f of jsonFiles) {
    try {
      const data = JSON.parse(readFileSync(f, 'utf-8'));
      // Support various result formats
      if (data.status === 'passed') passed++;
      else if (data.status === 'failed') failed++;
      else if (data.status === 'skipped') skipped++;
      // Or if it contains summary
      if (data.summary) {
        passed += data.summary.passed ?? 0;
        failed += data.summary.failed ?? 0;
        skipped += data.summary.skipped ?? 0;
      }
    } catch {}
  }

  const total = passed + failed + skipped;
  const latestSummary = total > 0 ? { passed, failed, skipped, total } : null;

  return {
    reports,
    latestSummary,
    timestamp: new Date().toISOString(),
  };
}
