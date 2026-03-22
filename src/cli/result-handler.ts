// src/cli/result-handler.ts
// Query test results from shared/results/*.json

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RESULTS_DIR = resolve(import.meta.dirname, '..', '..', 'shared', 'results');

interface ResultQuery {
  id?: string;
  last?: number;
}

interface ResultOutput {
  results: Array<{ file: string; data: unknown }>;
  count: number;
  timestamp: string;
}

export function queryResults(query: ResultQuery): ResultOutput {
  if (!existsSync(RESULTS_DIR)) {
    return { results: [], count: 0, timestamp: new Date().toISOString() };
  }

  let files = readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: join(RESULTS_DIR, f),
      mtime: statSync(join(RESULTS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime); // newest first

  // Filter by ID
  if (query.id) {
    const idLower = query.id.toLowerCase();
    files = files.filter(f => f.name.toLowerCase().includes(idLower));
  }

  // Limit
  if (query.last && query.last > 0) {
    files = files.slice(0, query.last);
  }

  const results = files.map(f => {
    try {
      const data = JSON.parse(readFileSync(f.path, 'utf-8'));
      return { file: f.name, data };
    } catch {
      return { file: f.name, data: null };
    }
  });

  return {
    results,
    count: results.length,
    timestamp: new Date().toISOString(),
  };
}
