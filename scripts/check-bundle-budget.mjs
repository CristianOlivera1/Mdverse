import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist/client';

const KB = 1024;

const BUDGETS = {
  scriptGzipBytes: 3000 * KB,
  scriptRawBytes: 8750 * KB,
  largestChunkGzipBytes: 640 * KB,
  styleGzipBytes: 32 * KB,
  scriptFileCount: 140,
};

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function measure() {
  const files = walk(DIST);
  const summary = {
    scriptRawBytes: 0,
    scriptGzipBytes: 0,
    scriptFileCount: 0,
    styleGzipBytes: 0,
    styleRawBytes: 0,
    largestChunk: { path: '', gzipBytes: 0 },
  };

  for (const path of files) {
    if (path.endsWith('.js')) {
      const buffer = readFileSync(path);
      const gzipBytes = gzipSync(buffer, { level: 9 }).length;
      summary.scriptRawBytes += buffer.length;
      summary.scriptGzipBytes += gzipBytes;
      summary.scriptFileCount += 1;
      if (gzipBytes > summary.largestChunk.gzipBytes) {
        summary.largestChunk = { path, gzipBytes };
      }
    } else if (path.endsWith('.css')) {
      const buffer = readFileSync(path);
      summary.styleRawBytes += buffer.length;
      summary.styleGzipBytes += gzipSync(buffer, { level: 9 }).length;
    }
  }

  return summary;
}

function main() {
  if (!statExists(DIST)) {
    console.error(`[budget] ${DIST} not found - run "pnpm build" first.`);
    process.exit(1);
  }

  const summary = measure();
  const checks = [
    ['javascript (gzip)', summary.scriptGzipBytes, BUDGETS.scriptGzipBytes],
    ['javascript (raw)', summary.scriptRawBytes, BUDGETS.scriptRawBytes],
    ['largest chunk (gzip)', summary.largestChunk.gzipBytes, BUDGETS.largestChunkGzipBytes],
    ['styles (gzip)', summary.styleGzipBytes, BUDGETS.styleGzipBytes],
    ['script file count', summary.scriptFileCount, BUDGETS.scriptFileCount],
  ];

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ summary, budgets: BUDGETS }, null, 2));
    return;
  }

  const kb = (bytes) => `${Math.round(bytes / KB)} KB`;
  let failed = 0;

  console.log('[budget] built client output');
  for (const [label, actual, limit] of checks) {
    const ok = actual <= limit;
    if (!ok) failed += 1;
    // File count is a count, not a size; print it without KB.
    const actualText = label.includes('count') ? String(actual) : kb(actual);
    const limitText = label.includes('count') ? String(limit) : kb(limit);
    const used = Math.round((actual / limit) * 100);
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(22)} ${actualText.padStart(9)} / ${limitText.padStart(9)}  (${used}% of budget)`,
    );
  }
  console.log(`  largest chunk: ${summary.largestChunk.path || '(none)'}`);

  if (failed > 0) {
    console.error(`[budget] ${failed} metric(s) over budget.`);
    process.exit(1);
  }
  console.log('[budget] every metric inside its budget.');
}

function statExists(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

main();
