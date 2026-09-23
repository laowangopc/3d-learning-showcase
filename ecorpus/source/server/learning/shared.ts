import { type Request, type Response } from 'express';
import { getUser, getUserId, hasScope } from '../utils/locals.js';
import { LearningError } from './validation.js';

export const canAdmin=(req:Request,res:Response)=>getUser(req)?.level==='admin'&&hasScope(res,'instance:write');

export async function readJson(vfs:any,scene:string,name:string) {
  const props=await vfs.getFileProps({scene,name},true);
  if(props.size>256*1024)throw new LearningError(422,'资源说明过大，请联系管理员。');
  let data=props.data;
  if(!data){
    const file=await vfs.getFile({scene,name});const chunks=[];let size=0;
    if(!file.stream)throw new LearningError(422,'资源说明缺失，请联系管理员。');
    for await(const chunk of file.stream){size+=chunk.length;if(size>256*1024)throw new LearningError(422,'资源说明过大，请联系管理员。');chunks.push(Buffer.from(chunk));}
    data=Buffer.concat(chunks).toString('utf8');
  }
  return {value:JSON.parse(data),version:props.generation};
}
export function publicInfo(scene:any,value:any,req:Request,res:Response,version?:number) {
  const result={...value,scene:scene.name,resourceId:scene.id,version,published:scene.public_access==='read',archived:!!scene.archived,
    owned:!!getUser(req)&&scene.author_id===getUserId(req),
    canEdit:!!getUser(req)&&(scene.author_id===getUserId(req)||canAdmin(req,res))&&hasScope(res,'scenes:write'),
    assetUrl:`/scenes/${encodeURIComponent(scene.name)}/${encodeURIComponent(value.fileName)}`,
    thumbnailUrl:value.thumbnail?`/scenes/${encodeURIComponent(scene.name)}/${encodeURIComponent(value.thumbnail)}${value.thumbnailInfo?.rendererVersion?`?v=${Number(value.thumbnailInfo.rendererVersion)}`:''}`:null};
  // Review notes can refer to private correspondence. Only a public evidence URL
  // and review date are shared; the full record remains available to reviewers.
  if(result.rightsReview&&!canAdmin(req,res))result.rightsReview={reviewedAt:result.rightsReview.reviewedAt,evidenceUrl:result.rightsReview.evidenceUrl};
  return result;
}
export async function requireEdit(req:Request,res:Response,vfs:any) {
  const scene=await vfs.getScene(req.params.scene,getUserId(req));
  if(!getUser(req)||(scene.author_id!==getUserId(req)&&!canAdmin(req,res)))throw new LearningError(403,'只有上传者和管理员可以修改此资源。');
  return scene;
}
