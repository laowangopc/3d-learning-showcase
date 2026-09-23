import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Export public catalogue metadata only. No file URLs, accounts or review notes.
const endpoint = new URL(process.argv[2] || '');
if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/learn/api/resources') {
  throw new Error('Pass the HTTPS /learn/api/resources endpoint');
}
const allowedHosts = new Set(['polyhaven.com', 'commons.wikimedia.org', 'github.com']);
const allowedLicenses = new Set(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'permission']);
const fields = ['kind', 'title', 'category', 'creator', 'sourceName', 'sourceAssetId',
  'sourceUrl', 'license', 'licenseUrl', 'attribution', 'modifications',
  'sourceSha256', 'sha256'];
const resources = [];
const seen = new Set();
let offset = 0;
let expectedTotal = null;
for (let page = 0; page < 50; page++) {
  const url = new URL(endpoint);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', '100');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Catalogue request failed: HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.resources) || !Number.isSafeInteger(data.total)) throw new Error('Invalid catalogue response');
  if (expectedTotal === null) expectedTotal = data.total;
  if (data.total !== expectedTotal) throw new Error('Catalogue changed during export; retry when stable');
  for (const item of data.resources) {
    if (!item.published || item.archived) throw new Error('Non-public resource appeared in anonymous catalogue');
    if (!allowedLicenses.has(item.license)) throw new Error('Unexpected resource licence');
    const source = new URL(item.sourceUrl);
    if (source.protocol !== 'https:' || !allowedHosts.has(source.hostname) || source.search) {
      throw new Error('Unexpected resource source URL');
    }
    const key = `${item.sourceName}:${item.sourceAssetId}:${item.sha256}`;
    if (seen.has(key)) throw new Error('Duplicate catalogue item');
    seen.add(key);
    const safe = Object.fromEntries(fields.filter(field => item[field] !== undefined && item[field] !== null)
      .map(field => [field, item[field]]));
    safe.referenceOnly = item.license === 'permission';
    resources.push(safe);
  }
  if (data.nextOffset === null) break;
  if (!Number.isSafeInteger(data.nextOffset) || data.nextOffset <= offset) throw new Error('Invalid catalogue cursor');
  offset = data.nextOffset;
}
if (resources.length !== expectedTotal) throw new Error(`Incomplete catalogue: ${resources.length}/${expectedTotal}`);
const counts = Object.fromEntries([...new Set(resources.map(item => item.sourceName))].sort()
  .map(source => [source, resources.filter(item => item.sourceName === source).length]));
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'catalog', 'public-catalog.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ schemaVersion: 1, count: resources.length,
  referenceOnlyCount: resources.filter(item => item.referenceOnly).length,
  bySource: counts, resources }, null, 2) + '\n', 'utf8');
console.log(`Exported ${resources.length} public metadata records (${resources.filter(item => item.referenceOnly).length} reference-only).`);
