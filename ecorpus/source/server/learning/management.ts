import express,{type Request,type Response} from 'express';
import { getLocals,getUserId,policy } from '../utils/locals.js';
import { withTransaction } from '../vfs/helpers/db.js';
import { LearningStore } from './store.js';
import { canAdmin,publicInfo,readJson,requireEdit } from './shared.js';
import { LearningError,parseMetadata } from './validation.js';

export const managementRouter=express.Router();
const route=(fn:(req:Request,res:Response)=>Promise<any>)=>(req:Request,res:Response,next:any)=>Promise.resolve(fn(req,res)).catch(next);
const body=express.json({limit:'32kb'});

managementRouter.get('/trash',policy({access:'read'}),route(async(req,res)=>{
  if(!canAdmin(req,res)&&!getUserId(req))throw new LearningError(401,'请先登录后查看回收站。');
  const offset=Number(req.query.offset??0);const limit=Math.min(Number(req.query.limit??100),100);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)throw new LearningError(400,'分页参数不正确。');
  const {vfs}=getLocals(req);const store=new LearningStore(vfs._db);
  await store.reconcile(scene=>readJson(vfs,scene,'resource.json'));
  const result=await store.page(getUserId(req),{offset,limit,search:String(req.query.search??''),kind:String(req.query.kind??'all'),mine:false,archived:true,category:String(req.query.category??'')});
  const resources=result.rows.map((row:any)=>publicInfo({name:row.name,id:row.id,author_id:row.author_id,archived:row.archived,public_access:row.public_access},row.metadata,req,res,row.generation));
  res.json({resources,total:result.total,nextOffset:result.nextOffset});
}));

managementRouter.patch('/resources/:scene',policy({access:'write'}),body,route(async(req,res)=>{
  const {vfs,userManager}=getLocals(req);await requireEdit(req,res,vfs);
  const store=new LearningStore(vfs._db);
  const result=await withTransaction({vfs,userManager,store},async({vfs,userManager,store})=>{
    await vfs.lockLearningScene(req.params.scene);
    const scene=await requireEdit(req,res,vfs);
    const wasPublished=scene.public_access==='read';
    const current=await readJson(vfs,scene.name,'resource.json');
    if(!Number.isSafeInteger(req.body.expectedVersion)||current.version!==req.body.expectedVersion)throw new LearningError(409,'资源说明已在另一处更新。请保留当前内容，刷新后再修改。');
    const editable=parseMetadata({...req.body,kind:current.value.kind,rightsConfirmed:req.body.rightsConfirmed});
    // The binary, hash, source download identifier and provenance of processing
    // never come from a metadata edit. All edits require a new publication review.
    const value={...current.value,...editable,sourceAssetId:current.value.sourceAssetId,sourceSha256:current.value.sourceSha256,
      rightsReview:null,updatedAt:new Date().toISOString()};
    await userManager.setPublicAccess(scene.name,'none');await userManager.setDefaultAccess(scene.name,'none');
    const written=await vfs.writeDoc(JSON.stringify(value),{scene:scene.name,user_id:getUserId(req)!,name:'resource.json',mime:'application/json'});
    if(value.kind==='model'){
      const model=await readJson(vfs,scene.name,'scene.svx.json');const doc=model.value;
      const index=doc.scenes?.[doc.scene??0]?.meta;
      if(doc.metas?.[index]?.collection?.titles)doc.metas[index].collection.titles.EN=value.title;
      doc.asset.copyright=value.attribution||`${value.creator} · ${value.license}`;
      await vfs.writeDoc(JSON.stringify(doc),{scene:scene.name,user_id:getUserId(req)!,name:'scene.svx.json',mime:'application/si-dpo-3d.document+json'});
    }
    await store.put(scene.id,value,written.generation);
    // Preserve the last actionable feedback until the author submits again.
    const review=await store.review(scene.id);
    await store.setReview(scene.id,review.state==='changes'?'changes':'draft',review.state==='changes'?review.message:'');
    await store.event(getUserId(req),scene.id,'resource.edit',{version:written.generation,publicationRevoked:wasPublished});
    return {scene:scene.name,version:written.generation,published:false};
  });res.json(result);
}));

managementRouter.post('/resources/:scene/archive',policy({access:'write'}),body,route(async(req,res)=>{
  if(req.body.confirmed!==true)throw new LearningError(400,'请先确认将资源移入回收站。');
  const {vfs,userManager}=getLocals(req);await requireEdit(req,res,vfs);const store=new LearningStore(vfs._db);
  const id=await withTransaction({vfs,userManager,store},async({vfs,userManager,store})=>{
    await vfs.lockLearningScene(req.params.scene);const scene=await requireEdit(req,res,vfs);
    await userManager.setPublicAccess(scene.name,'none');await userManager.setDefaultAccess(scene.name,'none');
    await store.setReview(scene.id,'draft');
    await vfs.archiveScene(scene.name);await store.event(getUserId(req),scene.id,'resource.archive');return scene.id;
  });res.json({archived:true,resourceId:id});
}));
managementRouter.post('/trash/:id/restore',policy({scope:'corpus:write'}),body,route(async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<2)throw new LearningError(400,'请选择有效的回收站资源。');
  const {vfs,userManager}=getLocals(req);const store=new LearningStore(vfs._db);
  const scene=await withTransaction({vfs,userManager,store},async({vfs,userManager,store})=>{
    const previous=await store.archivedScene(id,getUserId(req),canAdmin(req,res));
    const original=previous.name.replace(/#\d+$/,'');
    if(!/^lr-[a-f0-9-]{36}$/.test(original))throw new LearningError(409,'此资源需要管理员核对后恢复。');
    await vfs.unarchiveScene(id,original);await userManager.setPublicAccess(original,'none');await userManager.setDefaultAccess(original,'none');
    await store.event(getUserId(req),id,'resource.restore');return original;
  });res.json({scene,published:false});
}));
managementRouter.get('/resources/:scene/activity',policy({access:'write'}),route(async(req,res)=>{
  const {vfs}=getLocals(req);const scene=await requireEdit(req,res,vfs);
  const events=await new LearningStore(vfs._db).recentEvents(scene.id);
  res.json(events.map(e=>({...e,detail:canAdmin(req,res)?e.detail:{}})));
}));
