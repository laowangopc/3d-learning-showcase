import express,{type Request,type Response} from 'express';
import { getLocals,getUser,getUserId,policy } from '../utils/locals.js';
import { withTransaction } from '../vfs/helpers/db.js';
import { LearningStore } from './store.js';
import { canAdmin,publicInfo,readJson,requireEdit } from './shared.js';
import { LearningError,resourceQuota } from './validation.js';
import { reviewState,reviewTransition } from './review-state.js';

export const workflowRouter=express.Router();
const route=(fn:(req:Request,res:Response)=>Promise<any>)=>(req:Request,res:Response,next:any)=>Promise.resolve(fn(req,res)).catch(next);
workflowRouter.get('/workspace',policy({scope:'scenes:read'}),route(async(req,res)=>{
  if(!getUser(req)||getUser(req)!.level==='none')throw new LearningError(401,'请先登录后查看自己的资源。');
  const view=String(req.query.view??'mine');
  if(!['mine','review','trash'].includes(view))throw new LearningError(400,'请选择我的资源、待审核或回收站。');
  if(view==='review'&&!canAdmin(req,res))throw new LearningError(403,'只有管理员可以查看待审核资源。');
  const status=view==='review'?'pending':String(req.query.status??'');
  if(!['','draft','pending','changes','published'].includes(status))throw new LearningError(400,'请选择有效的资源状态。');
  const offset=Number(req.query.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0)throw new LearningError(400,'页码不正确，请刷新后重试。');
  const {vfs}=getLocals(req);const store=new LearningStore(vfs._db);
  await store.reconcile(scene=>readJson(vfs,scene,'resource.json'));
  const result=await store.page(getUserId(req),{offset,limit:30,search:String(req.query.search??'').slice(0,100),
    kind:'all',mine:view==='mine'||(view==='trash'&&!canAdmin(req,res)),archived:view==='trash',category:'',status:view==='trash'?'':status});
  const resources=result.rows.map((row:any)=>({...publicInfo({name:row.name,id:row.id,author_id:row.author_id,archived:row.archived,public_access:row.public_access},row.metadata,req,res,row.generation),
    review:{...row.review,state:reviewState(row.public_access==='read',row.review)}}));
  res.json({resources,total:result.total,nextOffset:result.nextOffset,
    usage:await store.usage(getUserId(req)!),quota:resourceQuota(canAdmin(req,res))});
}));
workflowRouter.post('/resources/:scene/review',policy({access:'write',scope:'scenes:write'}),express.json({limit:'8kb'}),route(async(req,res)=>{
  const {vfs}=getLocals(req);await requireEdit(req,res,vfs);const store=new LearningStore(vfs._db);
  const result=await withTransaction({vfs,store},async({vfs,store})=>{
    await vfs.lockLearningScene(req.params.scene);
    const scene=await requireEdit(req,res,vfs);
    const {value,version}=await readJson(vfs,scene.name,'resource.json');
    const previous=await store.review(scene.id);
    if(req.body.expectedVersion!==version||req.body.expectedRevision!==previous.revision)throw new LearningError(409,'资源已变化，请刷新后查看最新内容再操作。');
    const next=reviewTransition(reviewState(scene.public_access==='read',previous),req.body.action,{...req.body,license:value.license},canAdmin(req,res));
    const result=await store.setReview(scene.id,next.state,next.message);
    await store.event(getUserId(req),scene.id,'review.'+req.body.action,{message:next.message});
    return result;
  });res.json(result);
}));
