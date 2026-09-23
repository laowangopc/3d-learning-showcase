import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { getLocals, getUser, getUserId, hasScope, policy } from '../utils/locals.js';
import { withTransaction } from '../vfs/helpers/db.js';
import { io } from '../utils/gltf/io.js';
import { inspectDocument } from '../utils/gltf/inspect.js';
import { createDocumentFromFiles } from '../tasks/handlers/createDocumentFromFiles.js';
import { LearningError, MAX_BYTES, parseMetadata, sourceLink, textField, validateGlb, validateNotes } from './validation.js';
import { LearningStore } from './store.js';
import { accountsRouter } from './accounts.js';
import { managementRouter } from './management.js';
import { workflowRouter } from './workflow.js';
import { reviewState } from './review-state.js';
import { publicInfo, requireEdit as requireResourceEdit } from './shared.js';

export const learningRouter = express.Router();
const route = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const jsonBody = express.json({ limit: '180kb' });
const canAdmin = (req: Request, res: Response) => getUser(req)?.level === 'admin' && hasScope(res, 'instance:write');

/** This isolated instance reserves native mutation APIs for administrators.
 * Teachers use validated uploads/notes, not HTML, WebDAV, ZIP tasks or ACL writes.
 */
export function learningNativeGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS', 'PROPFIND'].includes(req.method) || canAdmin(req, res)) return next();
  let pathname: string;
  try { pathname = decodeURIComponent(req.path).toLowerCase(); } catch { return res.status(400).json({message:'请求地址不正确。'}); }
  if (process.env.LEARNING_DISABLE_NATIVE_BOOTSTRAP === 'true' && req.method === 'POST' && /^\/users\/?$/.test(pathname)) {
    return res.status(403).json({message:'生产环境已关闭原生首个账号接口，请使用观察台的初始化接口。'});
  }
  if (/^\/(scenes|history|tasks|tags)(\/|$)/.test(pathname) || /^\/auth\/access(\/|$)/.test(pathname)) {
    return res.status(403).json({message:'请在观察台上传资源或保存笔记；原始文件和公开设置由管理员维护。'});
  }
  next();
}

learningRouter.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.vary('Cookie'); res.vary('Authorization'); next(); });
learningRouter.get('/session', (req, res) => {
  const user = getUser(req);
  res.json({ user: user ? { username: user.username, uid: user.uid, level: user.level } : null,
    canUpload: !!user && hasScope(res, 'corpus:write') && ['create', 'manage', 'admin'].includes(user.level),
    canReview: canAdmin(req, res), limits: { maxBytes: MAX_BYTES, formats: ['GLB', 'JPG', 'PNG', 'WebP'] } });
});

async function readJson(vfs: any, scene: string, name: string) {
  const props = await vfs.getFileProps({scene, name}, true);
  if(props.size > 256 * 1024) throw new LearningError(422,'资源说明过大，请联系管理员。');
  let data=props.data;
  if(!data) {
    const file=await vfs.getFile({scene,name});const chunks=[];let size=0;
    if(!file.stream)throw new LearningError(422,'资源说明缺失，请联系管理员。');
    for await(const chunk of file.stream){size+=chunk.length;if(size>256*1024)throw new LearningError(422,'资源说明过大，请联系管理员。');chunks.push(Buffer.from(chunk));}
    data=Buffer.concat(chunks).toString('utf8');
  }
  return {value: JSON.parse(data), version: props.generation};
}
let catalogReady:Promise<void>|null=null;
async function ensureCatalog(vfs:any) {
  if(!catalogReady) {
    const store=new LearningStore(vfs._db);
    catalogReady=store.reconcile(scene=>readJson(vfs,scene,'resource.json')).catch(error=>{catalogReady=null;throw error;});
  }
  await catalogReady;
}
learningRouter.get('/resources', route(async (req, res) => {
  if(!hasScope(res,'scenes:read'))throw new LearningError(403,'当前凭据没有读取资源的权限。');
  const {vfs} = getLocals(req);
  await ensureCatalog(vfs);
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new LearningError(400, '页码不正确。');
  const limit=Number(req.query.limit??60);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new LearningError(400,'每页数量不正确。');
  const kind=String(req.query.kind??'all');if(!['all','model','panorama'].includes(kind))throw new LearningError(400,'资源类型不正确。');
  const mine=req.query.mine==='true';
  if(mine&&!getUserId(req))throw new LearningError(401,'请先登录后查看自己的资源。');
  const store=new LearningStore(vfs._db);
  const result=await store.page(getUserId(req),{offset,limit,kind,mine,archived:false,
    category:String(req.query.category??'').slice(0,100),source:String(req.query.source??'').slice(0,100),search:String(req.query.search??'').slice(0,100)});
  const resources=result.rows.map((row:any)=>publicInfo({name:row.name,id:row.id,author_id:row.author_id,archived:row.archived,public_access:row.public_access},row.metadata,req,res,row.generation));
  res.json({resources,total:result.total,nextOffset:result.nextOffset,...(offset===0?await store.facets(getUserId(req)):{})});
}));
learningRouter.get('/resources/:scene', policy({access:'read'}), route(async (req, res) => {
  const {vfs} = getLocals(req);
  const scene = await vfs.getScene(req.params.scene, getUserId(req));
  const resource = await readJson(vfs, scene.name, 'resource.json');
  const notes = await readJson(vfs, scene.name, 'notes.json');
  const info=publicInfo(scene,resource.value,req,res,resource.version);
  const review=info.canEdit?await new LearningStore(vfs._db).review(scene.id):undefined;
  res.json({...info,...(review?{review:{...review,state:reviewState(info.published,review)}}:{}), notes:{...notes.value, version:notes.version}});
}));

let activeUploads = 0;
learningRouter.post('/resources', policy({scope:'corpus:write'}), route(async (req, res) => {
  if (activeUploads >= 2) throw new LearningError(429, '当前有文件正在处理，请稍后重试。');
  const metadataBytes = Number(req.get('X-Metadata-Bytes'));
  if (!Number.isSafeInteger(metadataBytes) || metadataBytes < 2 || metadataBytes > 32768) throw new LearningError(400, '资源说明长度不正确。');
  const length = Number(req.get('Content-Length'));
  if (Number.isFinite(length) && length > MAX_BYTES + metadataBytes) throw new LearningError(413, '文件超过 64 MB，请简化或压缩后上传。');
  activeUploads++;
  try {
    req.setTimeout(120000);
    const parts: Buffer[] = [];
    let size = 0;
    for await (const part of req) {
      size += part.length;
      if (size > MAX_BYTES + metadataBytes) throw new LearningError(413, '文件超过 64 MB，请简化或压缩后上传。');
      parts.push(Buffer.from(part));
    }
    const payload = Buffer.concat(parts);
    let rawMetadata: any;
    let metadata: ReturnType<typeof parseMetadata>;
    try { rawMetadata = JSON.parse(payload.toString('utf8',0,metadataBytes)); metadata = parseMetadata(rawMetadata); }
    catch(e) { if(e instanceof LearningError)throw e; throw new LearningError(400,'资源说明无法读取，请重新填写。'); }
    const originalFileName = textField(rawMetadata.originalFileName,'文件名',200) || (metadata.kind === 'model' ? 'model.glb' : 'panorama.jpg');
    const buffer = payload.subarray(metadataBytes);
    if (!buffer.length) throw new LearningError(400, '文件为空，请重新选择。');
    let fileName = 'model.glb';
    let mime = 'model/gltf-binary';
    let thumbnail: Buffer | undefined;
    let properties: any;
    if (metadata.kind === 'model') {
      validateGlb(buffer);
      try {
        const document = await io.readBinary(new Uint8Array(buffer));
        const root = document.getRoot();
        if (!root.getDefaultScene()) root.setDefaultScene(root.listScenes()[0]);
        properties = inspectDocument(document);
        if (!properties.bounds || properties.numFaces < 1 || properties.numFaces > 2000000) throw new Error('geometry');
      } catch { throw new LearningError(400, '模型无法读取或超过 200 万面，请检查贴图、场景与模型复杂度。'); }
    } else {
      try {
        const image = sharp(buffer, {limitInputPixels: 8192 * 4096, failOn:'warning'});
        const meta = await image.metadata();
        if (!['jpeg','png','webp'].includes(meta.format ?? '') || !meta.width || !meta.height || meta.width !== meta.height * 2 || meta.width < 1024 || meta.width > 8192 || (meta.pages ?? 1) > 1 || (meta.orientation ?? 1) !== 1) throw new Error('format');
        // Fully decode, not merely trust an extension or file header.
        thumbnail = await image.resize({width:480, height:240}).jpeg({quality:80}).toBuffer();
        fileName = `panorama.${meta.format === 'jpeg' ? 'jpg' : meta.format}`;
        mime = `image/${meta.format}`;
        properties = {width:meta.width, height:meta.height, projection:'equirectangular'};
      } catch { throw new LearningError(400, '全景需为完整的 2:1 JPG、PNG 或 WebP，宽度 1024–8192 像素；请勿上传普通照片或动画。'); }
    }
    const {vfs, taskScheduler} = getLocals(req);
    const user_id = getUserId(req)!;
    const store = new LearningStore(vfs._db);
    await ensureCatalog(vfs);
    const scene = `lr-${randomUUID()}`;
    let document: any;
    if (metadata.kind === 'model') {
      document = await taskScheduler.run({immediate:true, handler:createDocumentFromFiles, data:{scene, language:'EN', models:[{uri:fileName, byteSize:buffer.length, quality:'High', usage:'Web3D', ...properties}]}});
      document.asset.copyright = metadata.attribution || `${metadata.creator} · ${metadata.license}`;
      document.asset.generator = 'eCorpus Learning Observatory';
      document.metas[document.scenes[document.scene].meta].collection.titles.EN = metadata.title;
      document.setups[0].interface.logo = false;
    }
    const resource = {...metadata, schemaVersion:1, fileName, byteSize:buffer.length, sha256:createHash('sha256').update(buffer).digest('hex'),
      properties, thumbnail:thumbnail ? 'scene-image-thumb.jpg':null, importedAt:new Date().toISOString(),
      rightsReview:null, storage:'local', originalFileName};
    // Database records become visible together. Content-addressed loose blobs may remain after a failed transaction.
    await withTransaction({vfs,store}, async ({vfs,store}) => {
      await store.uploadLock(user_id);
      await store.assertQuota(user_id, buffer.length, canAdmin(req,res));
      await vfs.createScene(scene, user_id);
      await vfs.writeFile(Readable.from([buffer]), {scene, user_id, name:fileName, mime});
      if (thumbnail) await vfs.writeFile(Readable.from([thumbnail]), {scene, user_id, name:'scene-image-thumb.jpg', mime:'image/jpeg'});
      const write = (name:string, data:any, mime='application/json') => vfs.writeDoc(JSON.stringify(data), {scene, user_id, name, mime});
      await write('resource.json', resource);
      const createdScene = await vfs.getScene(scene, user_id);
      const resourceGeneration = (await vfs.getFileProps({scene, name:'resource.json'}, true)).generation;
      await store.put(createdScene.id, resource, resourceGeneration);
      await store.event(user_id, createdScene.id, 'resource.create', {kind: metadata.kind, byteSize: buffer.length});
      await write('notes.json', {entries:[], updatedAt:new Date().toISOString(), updatedBy:getUser(req)!.username});
      if (document) await write('scene.svx.json', document, 'application/si-dpo-3d.document+json');
      else await write('panorama.json', {schemaVersion:1, projection:'equirectangular', image:fileName, initialView:{yaw:0,pitch:0}});
      await vfs.addTag(await vfs.getScene(scene, user_id).then(s=>s.id), metadata.category);
    });
    res.status(201).json({scene, resource:{...resource, scene, published:false}});
  } finally { activeUploads--; }
}));

async function requireEdit(req:Request, res:Response, vfs:any) {
  const scene = await vfs.getScene(req.params.scene, getUserId(req));
  if (scene.author_id !== getUserId(req) && !canAdmin(req,res)) throw new LearningError(403, '只有上传者和管理员可以修改观察笔记。');
  return scene;
}
// A derived cover is separate from the original binary, notes and publication review.
// One cover per supported renderer revision bounds history and makes parallel jobs idempotent.
learningRouter.put('/resources/:scene/thumbnail', policy({access:'write'}), express.raw({type:'image/jpeg',limit:'256kb'}), route(async(req,res)=>{
  const {vfs}=getLocals(req);
  await requireResourceEdit(req,res,vfs);
  if(!Buffer.isBuffer(req.body)||!req.body.length)throw new LearningError(400,'请提交有效的预览截图。');
  let thumbnail:Buffer;
  try {
    const image=sharp(req.body,{limitInputPixels:1600*1200,failOn:'warning'});
    const info=await image.metadata();
    if(info.format!=='jpeg'||!info.width||!info.height||info.width<120||info.height<90||(info.pages??1)!==1)throw new Error('image');
    thumbnail=await image.resize(480,360,{fit:'contain',background:'#edf1ee'}).jpeg({quality:84}).toBuffer();
  }catch{throw new LearningError(400,'截图无法读取，请重新生成预览。');}
  const store=new LearningStore(vfs._db);
  const result=await withTransaction({vfs,store},async({vfs,store})=>{
    await vfs.lockLearningScene(req.params.scene);
    const scene=await requireResourceEdit(req,res,vfs);
    const {value,version}=await readJson(vfs,scene.name,'resource.json');
    if(value.kind!=='model')throw new LearningError(400,'全景已有预览，无需添加模型截图。');
    if(req.get('X-Asset-Sha256')!==value.sha256)throw new LearningError(409,'模型已变化，请刷新后重新生成预览。');
    const upgrading=req.get('X-Thumbnail-Renderer')==='2'&&(value.thumbnailInfo?.rendererVersion??1)<2;
    if(value.thumbnail&&!upgrading)return {thumbnailUrl:publicInfo(scene,value,req,res).thumbnailUrl,created:false,version,previousVersion:version};
    const user_id=getUserId(req)!;
    await vfs.writeFile(Readable.from([thumbnail]),{scene:scene.name,user_id,name:'scene-image-thumb.jpg',mime:'image/jpeg'});
    const updated={...value,thumbnail:'scene-image-thumb.jpg',thumbnailInfo:{sourceSha256:value.sha256,method:'model-render',rendererVersion:req.get('X-Thumbnail-Renderer')==='2'?2:1,createdAt:new Date().toISOString()}};
    const written=await vfs.writeDoc(JSON.stringify(updated),{scene:scene.name,user_id,name:'resource.json',mime:'application/json'});
    await store.put(scene.id,updated,written.generation);
    await store.event(user_id,scene.id,'resource.thumbnail',{sourceSha256:value.sha256});
    return {thumbnailUrl:publicInfo(scene,updated,req,res).thumbnailUrl,created:true,version:written.generation,previousVersion:version};
  });
  res.json(result);
}));
learningRouter.put('/resources/:scene/notes', policy({access:'write'}), jsonBody, route(async (req,res) => {
  const {vfs} = getLocals(req);
  await requireEdit(req,res,vfs);
  const result = await withTransaction({vfs}, async ({vfs}) => {
    await vfs.lockLearningScene(req.params.scene);
    const {value:resource} = await readJson(vfs, req.params.scene, 'resource.json');
    const input = validateNotes(req.body, resource.kind);
    const current = await readJson(vfs, req.params.scene, 'notes.json');
    if (current.version !== input.expectedVersion) throw new LearningError(409, '笔记已在另一处更新。本次草稿未覆盖已有内容，请刷新后重新整理。');
    const value = {entries:input.entries, updatedAt:new Date().toISOString(), updatedBy:getUser(req)!.username};
    const written = await vfs.writeDoc(JSON.stringify(value), {scene:req.params.scene, user_id:getUserId(req)!, name:'notes.json', mime:'application/json'});
    return {...value, version:written.generation};
  });
  res.json(result);
}));
learningRouter.get('/resources/:scene/notes/history', policy({access:'write'}), route(async (req,res) => {
  const {vfs} = getLocals(req); await requireEdit(req,res,vfs);
  res.json(await vfs.getFileHistory({scene:req.params.scene, name:'notes.json'}).then(items=>items.slice(0,100).map(f=>({version:f.generation, date:f.ctime, author:f.author}))));
}));
learningRouter.post('/resources/:scene/notes/restore', policy({access:'write'}), jsonBody, route(async (req,res) => {
  const {vfs} = getLocals(req); await requireEdit(req,res,vfs);
  if (!Number.isSafeInteger(req.body.version) || req.body.version < 1 || !Number.isSafeInteger(req.body.expectedVersion)) throw new LearningError(400, '请选择有效的历史版本。');
  const restored = await withTransaction({vfs}, async ({vfs})=>{
    await vfs.lockLearningScene(req.params.scene);
    const current = await readJson(vfs, req.params.scene, 'notes.json');
    if (current.version !== req.body.expectedVersion) throw new LearningError(409, '笔记版本已变化，请刷新后再恢复。');
    const previous = await vfs.getFileProps({scene:req.params.scene, name:'notes.json', generation:req.body.version}, true);
    const value = {...JSON.parse(previous.data!), updatedAt:new Date().toISOString(), updatedBy:getUser(req)!.username, restoredFrom:req.body.version};
    const written = await vfs.writeDoc(JSON.stringify(value), {scene:req.params.scene,user_id:getUserId(req)!,name:'notes.json',mime:'application/json'});
    return {...value, version:written.generation};
  }); res.json(restored);
}));
learningRouter.post('/resources/:scene/publication', policy({scope:'instance:write', access:'admin'}), jsonBody, route(async (req,res)=>{
  if (!canAdmin(req,res)) throw new LearningError(403, '只有管理员可以调整公开状态。');
  if (typeof req.body.published !== 'boolean') throw new LearningError(400, '请选择公开或取消公开。');
  const {vfs,userManager} = getLocals(req);
  const store=new LearningStore(vfs._db);
  await withTransaction({vfs,userManager,store}, async ({vfs,userManager,store})=>{
    await vfs.lockLearningScene(req.params.scene);
    const scene=await vfs.getScene(req.params.scene,getUserId(req));
    const {value:resource,version} = await readJson(vfs,req.params.scene,'resource.json');
    const review=await store.review(scene.id);
    // Curated import scripts remain compatible; queued or interactive reviews
    // must bind both the viewed content and the review decision.
    if(review.state==='pending'||req.body.expectedVersion!==undefined||req.body.expectedRevision!==undefined){
      if(req.body.expectedVersion!==version||req.body.expectedRevision!==review.revision)throw new LearningError(409,'资源已变化，请刷新并重新核对后再操作。');
    }
    if (req.body.published) {
      if (resource.license === 'unknown' || req.body.redistributionConfirmed !== true) throw new LearningError(400, '先核对具体文件的许可与再分发权利，来源链接不能代替授权。');
      const evidenceUrl = sourceLink(req.body.evidenceUrl,true);
      const note = textField(req.body.note,'核对说明',1000,true);
      resource.rightsReview = {reviewedAt:new Date().toISOString(), evidenceUrl, redistributionConfirmed:true};
      await store.event(getUserId(req),scene.id,'review.evidence',{evidenceUrl,note});
      await userManager.setDefaultAccess(req.params.scene,'read');
      await userManager.setPublicAccess(req.params.scene,'read');
    } else {
      await userManager.setPublicAccess(req.params.scene,'none');
      await userManager.setDefaultAccess(req.params.scene,'none');
    }
    const written=await vfs.writeDoc(JSON.stringify(resource),{scene:req.params.scene,user_id:getUserId(req)!,name:'resource.json',mime:'application/json'});
    await store.put(scene.id,resource,written.generation);
    await store.setReview(scene.id,req.body.published?'published':'draft');
    await store.event(getUserId(req),scene.id,req.body.published?'review.publish':'review.unpublish');
  });
  res.json({published:req.body.published});
}));

// Release-management routes stay under the same authenticated learning API.
learningRouter.use(accountsRouter);
learningRouter.use(workflowRouter);
learningRouter.use(managementRouter);

learningRouter.use((error:any, req:Request, res:Response, next:NextFunction) => {
  if (res.headersSent) return next(error);
  const code = Number(error.code ?? error.status);
  const status = Number.isInteger(code) && code >= 400 && code < 500 ? code : 500;
  if (status === 500) console.error('Learning request failed', error);
  const message = error instanceof LearningError ? error.message : ({400:'请求内容不正确，请检查后重试。',401:'请使用有权限的账号登录。',403:'当前账号没有执行此操作的权限。',404:'资源不存在，或当前账号无权查看。',413:'文件或说明内容过大，请缩小后重试。'} as any)[status] ?? '保存未完成，请稍后重试；原有内容保持不变。';
  res.status(status).json({message,...(error instanceof LearningError?{userMessage:message}:{})});
});
