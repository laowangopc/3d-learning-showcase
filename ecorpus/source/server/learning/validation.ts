export class LearningError extends Error {
  constructor(public code: number, message: string) { super(message); }
}

export const MAX_BYTES = 64 * 1024 * 1024;
/** Elevated capacity is selected by authenticated server policy, never upload metadata. */
export function resourceQuota(curatedAdmin=false, env:NodeJS.ProcessEnv=process.env) {
  const prefix=curatedAdmin ? 'LEARNING_CURATED' : 'LEARNING_USER';
  const positive=(value:string|undefined, fallback:number) => {
    const parsed=Number(value);
    return Number.isSafeInteger(parsed) && parsed>0 ? parsed : fallback;
  };
  return {
    maxResources:positive(env[prefix+'_RESOURCE_LIMIT'],200),
    maxBytes:positive(env[prefix+'_STORAGE_BYTES'],2147483648),
  };
}
export const LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'permission', 'unknown'] as const;

export function textField(value: unknown, label: string, max: number, required = false): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new LearningError(400, `${label}格式不正确。`);
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) {
    throw new LearningError(400, `${label}不能为空或超过 ${max} 字。`);
  }
  return text;
}

export function sourceLink(value: unknown, required = false): string {
  const text = textField(value, '来源链接', 1500, required);
  if (!text) return '';
  let url: URL;
  try { url = new URL(text); } catch { throw new LearningError(400, '请填写完整的 http 或 https 来源链接。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new LearningError(400, '来源链接不能含账号密码，也不能使用脚本协议。');
  }
  return url.href;
}

export function parseMetadata(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LearningError(400, '请填写资源说明。');
  if (!['model', 'panorama'].includes(value.kind)) throw new LearningError(400, '请选择三维模型或完整球形全景。');
  if (value.rightsConfirmed !== true) throw new LearningError(400, '请先确认拥有上传和使用此文件的权利。');
  if (!LICENSES.includes(value.license)) throw new LearningError(400, '请选择许可说明。');
  return {
    kind: value.kind as 'model' | 'panorama',
    title: textField(value.title, '资源名称', 100, true),
    description: textField(value.description, '观察提示', 2000),
    category: textField(value.category, '主题', 50) || '未分类',
    creator: textField(value.creator, '作者', 160, true),
    sourceName: textField(value.sourceName, '来源名称', 100, true),
    sourceUrl: sourceLink(value.sourceUrl),
    license: value.license as typeof LICENSES[number],
    licenseUrl: sourceLink(value.licenseUrl),
    attribution: textField(value.attribution, '署名说明', 2000),
    modifications: textField(value.modifications, '文件处理说明', 1000),
    sourceAssetId: textField(value.sourceAssetId, '来源资源编号', 160),
    sourceSha256: typeof value.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sourceSha256) ? value.sourceSha256 : '',
    // This is the uploader's declaration, never a review result.
    rightsDeclaration: { confirmed: true, statement: '上传者声明拥有上传和使用此文件的权利' },
  };
}

/** Only self-contained glTF 2 binary files. Nothing from an uploaded URI is fetched. */
export function validateGlb(buffer: Buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) {
    throw new LearningError(400, '这不是完整的 GLB 2.0 文件，请重新导出后上传。');
  }
  let offset = 12;
  let json: any;
  let chunks = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new LearningError(400, 'GLB 文件已截断。');
    const size = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    if (size % 4 !== 0 || offset + 8 + size > buffer.length || size === 0) throw new LearningError(400, 'GLB 数据块不完整。');
    if (chunks === 0) {
      if (type !== 0x4e4f534a || size > 8 * 1024 * 1024) throw new LearningError(400, 'GLB 描述数据不正确或过大。');
      try { json = JSON.parse(buffer.toString('utf8', offset + 8, offset + 8 + size)); }
      catch { throw new LearningError(400, 'GLB 描述数据无法解析。'); }
    } else if (type !== 0x004e4942 || chunks > 1) {
      throw new LearningError(400, '目前仅接收标准 JSON 与 BIN 数据块的 GLB。');
    }
    chunks++;
    offset += size + 8;
  }
  if (json?.asset?.version !== '2.0' || !Array.isArray(json.meshes) || !json.meshes.length) throw new LearningError(400, '文件中没有可观察的三维网格。');
  if (!Array.isArray(json.scenes) || !json.scenes.length) throw new LearningError(400, '模型缺少场景，请重新导出 GLB。');
  // Reject data URIs too: textures and buffers must be embedded in the BIN chunk.
  for (const entry of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (entry?.uri != null) throw new LearningError(400, '模型引用了其他文件；请将贴图和几何数据一并打包为 GLB。');
  }
  if ((json.nodes?.length ?? 0) > 10000 || (json.meshes?.length ?? 0) > 10000) throw new LearningError(400, '模型节点过多，请简化后上传。');
  return json;
}

export function validateNotes(value: any, kind: string) {
  if (!Number.isSafeInteger(value?.expectedVersion) || value.expectedVersion < 1) throw new LearningError(400, '缺少笔记版本，请刷新后重试。');
  if (!Array.isArray(value.entries) || value.entries.length > 50) throw new LearningError(400, '每个资源最多保存 50 条观察笔记。');
  const ids = new Set();
  const entries = value.entries.map((n: any) => {
    const id = textField(n?.id, '笔记编号', 80, true);
    if (!/^[a-zA-Z0-9-]+$/.test(id) || ids.has(id)) throw new LearningError(400, '笔记编号不正确或重复。');
    ids.add(id);
    const entry: any = { id, title: textField(n.title, '笔记标题', 100, true), body: textField(n.body, '笔记内容', 2000, true) };
    if (n.position != null) {
      if (kind !== 'panorama' || !Number.isFinite(n.position.yaw) || !Number.isFinite(n.position.pitch) || n.position.yaw < 0 || n.position.yaw > 2 * Math.PI || Math.abs(n.position.pitch) > Math.PI / 2) {
        throw new LearningError(400, '全景观察点坐标不正确。');
      }
      entry.position = { yaw: n.position.yaw, pitch: n.position.pitch };
    }
    return entry;
  });
  return { expectedVersion: value.expectedVersion, entries };
}
