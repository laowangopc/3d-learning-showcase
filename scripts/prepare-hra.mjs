import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runtimePath, runtimeUrl, runtimeDependency } from './runtime-paths.mjs';

const { parse } = runtimeDependency('yaml');
const run = promisify(execFile);
const revision = '8cf7ee34c9c16f7fa5f129bc577e906270d50393';
const portalUrl = 'https://humanatlas.io/assets/content/3d-reference-library-page/data.yaml';
const release = '11th Release (v2.5)';
const maxBytes = 64 * 1024 * 1024;
const sha256 = b => createHash('sha256').update(b).digest('hex');
const gitBlob = b => createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
await mkdir(runtimeUrl('cache/hra/'), { recursive: true });
await mkdir(runtimeUrl('samples/'), { recursive: true });
await mkdir(runtimeUrl('output/'), { recursive: true });

const retrievals=new Map();
async function download(url, relative, max = maxBytes, fallback) {
  const file = runtimePath(relative);
  try { return await readFile(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const pending = file + '.download';
  let lastError;
  for(const source of [url,fallback].filter(Boolean)) {
    try {
      await run('curl.exe', ['--fail', '--silent', '--show-error', '--location',
    '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '3',
    '--retry', '1', '--connect-timeout', '10', '--max-time', '75', '--speed-time', '20', '--speed-limit', '1024', '--max-filesize', String(max),
    '--user-agent', 'LearningObservatory/0.2 educational asset import', '--output', pending, source],
    { windowsHide: true });
      retrievals.set(relative,source);lastError=null;break;
    }catch(e){lastError=e;console.error(`Download attempt failed: ${relative}; trying available official fallback`);}
  }
  if(lastError)throw lastError;
  const bytes = await readFile(pending);
  if (!bytes.length || bytes.length > max) throw new Error('File size outside import bounds');
  await rename(pending, file);
  return bytes;
}

const portalBytes = await download(portalUrl, 'cache/hra/portal-v2.5.yaml', 3 * 1024 * 1024);
const portal = parse(portalBytes.toString('utf8'));
function findViewer(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.component === 'DataViewer' && value.variant === '3d-organ') return value;
  for (const child of Object.values(value)) { const found = findViewer(child); if (found) return found; }
  return null;
}
const releases = findViewer(portal)?.releaseVersionData ?? [];
const catalog = releases.find(r => r.label === release);
if (!catalog) throw new Error('The reviewed HRA release is absent; do not silently use another release');
const treeFile = runtimePath(`cache/hra/tree-${revision}.json`);
let tree;
try { tree = JSON.parse(await readFile(treeFile, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  const { stdout } = await run('gh', ['api', `repos/hubmapconsortium/hra-kg/git/trees/${revision}?recursive=1`], { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  tree = JSON.parse(stdout);
  if (tree.truncated) throw new Error('GitHub source tree was truncated');
  await writeFile(treeFile, stdout, 'utf8');
}
if (tree.sha !== revision || tree.truncated) throw new Error('Unexpected source tree');
const files = new Map(tree.tree.map(f => [f.path, f]));
const labels = {
  'Blood Vasculature':'全身血管', 'Brain':'脑', 'Eye':'眼球', 'Fallopian Tube':'输卵管',
  'Heart':'心脏', 'Kidney':'肾脏', 'Knee':'膝关节', 'Large Intestine':'大肠',
  'Larynx':'喉', 'Liver':'肝脏', 'Lung':'肺', 'Lymph Node':'淋巴结',
  'Main Bronchus':'主支气管', 'Mammary Gland':'乳腺', 'Manubrium':'胸骨柄',
  'Mouth':'口腔', 'Ovary':'卵巢', 'Palatine Tonsil':'腭扁桃体', 'Pancreas':'胰腺',
  'Pelvis':'骨盆', 'Placenta':'胎盘', 'Placenta, Full Term':'足月胎盘',
  'Prostate':'前列腺', 'Skin':'皮肤', 'Small Intestine':'小肠', 'Spinal Cord':'脊髓',
  'Spleen':'脾脏', 'Sternum':'胸骨', 'Thymus':'胸腺', 'Trachea':'气管',
  'Ureter':'输尿管', 'Urinary Bladder':'膀胱', 'Uterus':'子宫', 'Adipose':'脂肪组织',
  'Adipose Tissue':'脂肪组织', 'Omentum':'网膜', 'Intervertebral Disk':'椎间盘',
  'Intervertebral Disc':'椎间盘', 'Renal Pelvis':'肾盂',
  'Epiploic Appendage of Transverse Colon':'横结肠肠脂垂',
  'epiploic appendage of transverse colon':'横结肠肠脂垂',
  'intervertebral discs':'椎间盘', 'omentum':'网膜', 'subcutaneous adipose tissue':'皮下脂肪组织',
};
const candidates = [];
for (const organ of catalog.organData) {
  if (organ.label === 'All Organs') continue; // Whole-body files exceed the per-resource limit.
  for (const card of organ.cards ?? []) {
    if (!card.fileUrl?.endsWith('.glb')) continue;
    const url = new URL(card.fileUrl);
    if (url.hostname !== 'cdn.humanatlas.io') throw new Error('Unreviewed asset host');
    const match = url.pathname.match(/^\/digital-objects\/ref-organ\/([a-z0-9-]+)\/(v[0-9.]+)\/assets\/([^/]+\.glb)$/);
    if (!match) throw new Error('Unexpected asset path');
    const [, id, version, filename] = match;
    candidates.push({ group: organ.label, label: card.label, id, version, filename, downloadUrl: url.href,
      rawPath: `digital-objects/ref-organ/${id}/${version}/raw/${filename}` });
  }
}
if (new Set(candidates.map(c => c.id)).size !== candidates.length) throw new Error('Duplicate release objects');
if (process.argv.includes('--plan')) {
  console.log(JSON.stringify({release, revision, candidateCount:candidates.length,
    groups:[...new Set(candidates.map(c => c.group))],
    unmapped:[...new Set(candidates.filter(c => !labels[c.group]).map(c => c.group))],
    absent:candidates.filter(c => !files.has(c.rawPath)),
    oversized:candidates.filter(c => (files.get(c.rawPath)?.size ?? 0) > maxBytes).map(c => c.id)}, null, 2));
  process.exit(0);
}
const observations = {
  Heart:'旋转观察心脏整体轮廓与相连血管，比较正面、背面和侧面的不同。内部结构是否可见取决于这份模型，不要把外表面当作切面。',
  Brain:'比较左右两侧的轮廓及表面起伏；这是一份三维参考模型，不代表所有个体的脑部形态。',
  Lung:'从前、后、侧面观察肺的轮廓和分叶；记录两侧形态有什么不同。',
  Kidney:'观察肾脏轮廓以及内侧凹陷，从不同角度记录它们的空间关系。',
  Eye:'观察眼球及模型中附带的结构，比较球体表面、前部与后部的不同。',
};
const disclaimer = '用于教学形态观察，不用于诊断、治疗或真实人体测量；模型只表示特定参考数据，并非所有人的标准形态。';
const results = [], failures = [];
async function prepareCandidate(c) {
  try {
    if(c.id==='mouth-male')throw new Error('Upstream citation says Female while object title/file say Male; hold until source clarification');
    if (!labels[c.group]) throw new Error('Missing reviewed Chinese title');
    const entry = files.get(c.rawPath);
    if (!entry) throw new Error('Official release file is absent from the pinned source tree');
    if (entry.size > maxBytes) throw new Error('File exceeds 64 MiB');
    const metaPath = c.rawPath.replace(/[^/]+$/, 'metadata.yaml');
    const metaEntry = files.get(metaPath);
    if (!metaEntry) throw new Error('Per-object license metadata missing');
    const metaUrl = `https://raw.githubusercontent.com/hubmapconsortium/hra-kg/${revision}/${metaPath}`;
    const metaBytes = await download(metaUrl, `cache/hra/${c.id}-${c.version}.yaml`, 256 * 1024);
    if (gitBlob(metaBytes) !== metaEntry.sha) throw new Error('Metadata does not match pinned Git object');
    const upstream = parse(metaBytes.toString('utf8'));
    if (!upstream.license?.includes('https://creativecommons.org/licenses/by/4.0/') ||
        !upstream.creators?.length || !upstream.datatable?.includes(c.filename) || !upstream.citation) {
      throw new Error('Per-object license, creators, file membership or citation not verified');
    }
    const filename = `hra-${c.id}-${c.version}.glb`;
    const rawUrl=`https://raw.githubusercontent.com/hubmapconsortium/hra-kg/${revision}/${c.rawPath}`;
    const bytes = await download(c.downloadUrl, `samples/${filename}`, maxBytes, rawUrl);
    // CDN payload must equal the binary stored with the same object's license at a fixed revision.
    if (bytes.length !== entry.size || gitBlob(bytes) !== entry.sha) throw new Error('CDN binary differs from licensed Git object');
    if (bytes.toString('ascii',0,4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB');
    const model = JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
    if ([...(model.buffers??[]),...(model.images??[])].some(x => x.uri != null)) throw new Error('External GLB dependencies');
    const creators = upstream.creators.map(p => p.fullName).join('、');
    const variant = [c.id.includes('-female')?'女性参考':'男性参考',c.id.endsWith('-left')?'左侧':c.id.endsWith('-right')?'右侧':''].filter(Boolean).join(' · ');
    const title = `${labels[c.group]} · ${variant}`;
    const sourceUrl = `https://github.com/hubmapconsortium/hra-kg/blob/${revision}/${c.rawPath}`;
    const evidenceUrl = `https://github.com/hubmapconsortium/hra-kg/blob/${revision}/${metaPath}`;
    const hash = sha256(bytes);
    const modifications = 'GLB 原文件未修改；补充中文名称、教学观察提示与来源记录。上游建模与修改信息见随包保留的原始说明。';
    const attribution = [upstream.citation, upstream.citationOverall, 'CC BY 4.0 · https://creativecommons.org/licenses/by/4.0/', sourceUrl, modifications, '按原样提供，不含质量或适用性保证；不表示原作者对本应用的认可。'].join('\n');
    if (attribution.length > 2000 || creators.length > 160) throw new Error('Attribution exceeds metadata limits');
    results.push({key:`hra-${c.id}`,file:filename,sha256:hash,byteSize:bytes.length,
      downloadUrl:c.downloadUrl,officialFallbackUrl:rawUrl,retrievedVia:retrievals.get(`samples/${filename}`)??'existing cache; pinned Git blob verified',
      gitBlobSha1:entry.sha,upstreamMetadataSha256:sha256(metaBytes),
      metadata:{title,kind:'model',category:'人体器官',description:`${observations[c.group]??`旋转、放大观察${labels[c.group]}的整体轮廓和局部结构，比较不同方向的形态与空间关系。`}\n${disclaimer}`,
        creator:creators,sourceName:'Human Reference Atlas / HuBMAP',sourceAssetId:`hra:${c.id}@${c.version}`,
        sourceUrl,license:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
        attribution,modifications,sourceSha256:hash,originalFileName:c.filename,rightsConfirmed:true},
      evidenceUrl,reviewNote:`按 HRA ${release} 条目核对独立 metadata.yaml 的 CC BY 4.0、作者、引用和 datatable 文件清单；实际文件 Git blob SHA-1 与固定提交 ${revision} 一致；未修改 GLB，完整保留引用与上游说明。`,
      sourceMetadata:upstream,
      notes:[{id:'shape-observation',title:'从不同方向观察',body:`先看整体，再放大一个局部，记录从前、后、侧面看到的差异。\n${disclaimer}`},
        {id:'upstream-context',title:'原始模型说明',body:upstream.description.slice(0,1950)}]});
    console.log(`Prepared ${results.length}/${candidates.length}: ${title} (${bytes.length} bytes)`);
  } catch (e) { failures.push({id:c.id,reason:e.message}); console.error(`Skipped ${c.id}: ${e.message}`); }
}
// Three workers bound source load; each file still has an independent size/hash gate.
let next=0;
await Promise.all(Array.from({length:3},async()=>{
  while(next<candidates.length)await prepareCandidate(candidates[next++]);
}));
results.sort((a,b)=>a.key.localeCompare(b.key));
const manifest = {schemaVersion:1,preparedAt:new Date().toISOString(),sourceRelease:release,sourceRevision:revision,
  catalogUrl:portalUrl,catalogSha256:sha256(portalBytes),sampleCount:results.length,samples:results,
  excluded:['united-female and united-male: whole-body files exceed the 64 MiB import limit'],failures};
await writeFile(runtimeUrl('samples/hra-manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
await writeFile(runtimeUrl('output/hra-preparation.json'),JSON.stringify({prepared:results.length,failures},null,2)+'\n','utf8');
console.log(JSON.stringify({prepared:results.length,failed:failures.length}));
if (failures.length) process.exitCode=1;
