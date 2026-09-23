import express,{type Request,type Response} from 'express';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import User from '../auth/User.js';
import UserManager from '../auth/UserManager.js';
import { getAuthMethod,getLocals,getUser,getUserId,policy } from '../utils/locals.js';
import { csrfProtectAnonymous } from '../utils/csrf.js';
import { withTransaction } from '../vfs/helpers/db.js';
import { LearningStore } from './store.js';
import { canAdmin } from './shared.js';
import { LearningError,textField } from './validation.js';

export const accountsRouter=express.Router();
const route=(fn:(req:Request,res:Response)=>Promise<any>)=>(req:Request,res:Response,next:any)=>Promise.resolve(fn(req,res)).catch(next);
const body=express.json({limit:'8kb'});
const limiter=(limit:number)=>rateLimit({windowMs:60_000,limit,standardHeaders:'draft-7',legacyHeaders:false,validate:{trustProxy:false},message:{message:'操作较频繁，请稍等一分钟后重试。'}});
function admin(req:Request,res:Response,next:any){if(!canAdmin(req,res)||getAuthMethod(res)!=='session')return next(new LearningError(403,'请使用管理员账号登录后操作。'));next();}
function password(value:unknown){
  if(typeof value!=='string'||value.length<12||value.length>128)throw new LearningError(400,'密码需要 12–128 个字符，建议使用较长且不重复的密码。');
  return value;
}
function account(value:any,setup=false){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new LearningError(400,'请填写账号信息。');
  const username=textField(value.username,'账号',40,true);
  if(!/^[a-zA-Z0-9_-]{3,40}$/.test(username)||!UserManager.isValidUserName(username))throw new LearningError(400,'账号需为 3–40 位字母、数字、短横线或下划线。');
  const email=textField(value.email,'邮箱',254);
  if(email&&!UserManager.isValid.email(email))throw new LearningError(400,'邮箱格式不正确，请检查后重试。');
  if(!setup&&!['use','create','admin'].includes(value.level))throw new LearningError(400,'请选择学习者、教师或管理员角色。');
  return {username,password:password(value.password),email:email||undefined,level:setup?'admin':value.level};
}
async function establishSession(req:Request,uid:number){
  const {userManager,sessionMaxAge}=getLocals(req);const expires=new Date(Date.now()+sessionMaxAge);
  const {sid}=await userManager.createSession(uid,{expires,userAgent:req.get('User-Agent')});
  req.session={sid,expires:expires.valueOf()};
}

accountsRouter.post('/setup',csrfProtectAnonymous,limiter(5),body,route(async(req,res)=>{
  // A file-mounted secret is mandatory. Never allow "first visitor becomes admin".
  const location=process.env.LEARNING_SETUP_KEY_FILE;
  if(!location)throw new LearningError(403,'初始化入口未开放，请联系部署管理员。');
  let secret:Buffer;try{secret=Buffer.from(readFileSync(location,'utf8').trim());}catch{throw new LearningError(503,'初始化配置尚未就绪，请联系部署管理员。');}
  const supplied=Buffer.from(req.get('X-Setup-Key')||'');
  if(secret.length<32||supplied.length!==secret.length||!timingSafeEqual(secret,supplied))throw new LearningError(403,'初始化凭据不正确，请核对本机私密配置。');
  const input=account(req.body,true);const {vfs,userManager}=getLocals(req);const store=new LearningStore(vfs._db);
  const user=await withTransaction({userManager,store},async({userManager,store})=>{
    await store.accountLock();if(await userManager.userCount())throw new LearningError(409,'管理员已经建立，不能重复初始化或覆盖现有账号。');
    const created=await userManager.addUser(input.username,input.password,'admin',input.email);
    await store.event(created.uid,null,'account.setup');return created;
  });res.status(201).json(User.safe(user));
}));
accountsRouter.post('/login',csrfProtectAnonymous,limiter(10),body,route(async(req,res)=>{
  const username=textField(req.body?.username,'账号',40,true);
  const supplied=req.body?.password;
  if(typeof supplied!=='string'||supplied.length>128)throw new LearningError(401,'账号或密码不正确，请检查后重试。');
  const {userManager}=getLocals(req);let user;
  try{user=await userManager.getUserByNamePassword(username,supplied);}catch{throw new LearningError(401,'账号或密码不正确，请检查后重试。');}
  if(user.level==='none')throw new LearningError(403,'此账号已停用，请联系管理员。');
  await establishSession(req,user.uid);res.json(User.safe(user));
}));
accountsRouter.get('/accounts',admin,route(async(req,res)=>{
  const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0)throw new LearningError(400,'页码不正确，请重新选择。');
  const state=String(req.query.state??'all');if(!['all','active','disabled'].includes(state))throw new LearningError(400,'请选择有效的账号状态。');
  const {userManager}=getLocals(req);const users=await userManager.getUsers(true,{offset,limit:50,state:state as 'all'|'active'|'disabled'});
  res.json({users:users.map(User.safe),nextOffset:users.length===50?offset+50:null});
}));
accountsRouter.post('/accounts',admin,body,route(async(req,res)=>{
  const input=account(req.body);const {vfs,userManager}=getLocals(req);const store=new LearningStore(vfs._db);
  const user=await withTransaction({userManager,store},async({userManager,store})=>{
    const created=await userManager.addUser(input.username,input.password,input.level,input.email);
    await store.event(getUserId(req),null,'account.create',{target:created.uid,role:created.level});return created;
  }).catch(error=>{if(error.code==='23505'||error.code===409)throw new LearningError(409,'账号或邮箱已被使用，请换一个再试。');throw error;});res.status(201).json(User.safe(user));
}));
accountsRouter.patch('/accounts/:id',admin,body,route(async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<2)throw new LearningError(400,'请选择有效账号。');
  if(id===getUserId(req))throw new LearningError(400,'不能在账号管理中更改自己的角色或密码。请使用“修改密码”。');
  const expectedLevel=req.body?.expectedLevel;
  if(!['none','use','create','manage','admin'].includes(expectedLevel))throw new LearningError(400,'请刷新账号列表后再操作。');
  const patch:any={};
  if(req.body.level!==undefined){if(!['none','use','create','manage','admin'].includes(req.body.level))throw new LearningError(400,'请选择有效角色。');patch.level=req.body.level;}
  if(req.body.password!==undefined)patch.password=password(req.body.password);
  if(!Object.keys(patch).length)throw new LearningError(400,'请选择角色或填写新密码。');
  const {vfs,userManager}=getLocals(req);const store=new LearningStore(vfs._db);
  const user=await withTransaction({userManager,store},async({userManager,store})=>{
    await store.accountLock();const previous=await userManager.getUserById(id);
    if(previous.level!==expectedLevel)throw new LearningError(409,'账号状态已在其他地方更改。请刷新列表后再操作。');
    if(previous.level==='admin'&&patch.level&&patch.level!=='admin'){
      const admins=await userManager.getUsers(true);if(admins.filter(u=>u.level==='admin').length<=1)throw new LearningError(409,'至少保留一个管理员账号。');
    }
    const changed=await userManager.patchUser(id,patch);await userManager.removeUserSessions(id);
    await store.event(getUserId(req),null,'account.update',{target:id,role:changed.level,passwordChanged:!!patch.password});return changed;
  });res.json(User.safe(user));
}));
accountsRouter.post('/account/password',policy({scope:'account:admin'}),limiter(5),body,route(async(req,res)=>{
  if(getAuthMethod(res)!=='session'||!getUser(req))throw new LearningError(403,'请登录后修改密码。');
  const next=password(req.body.password);const previous=req.body.currentPassword;
  if(typeof previous!=='string'||previous.length>128)throw new LearningError(400,'请填写当前密码。');
  const {vfs,userManager}=getLocals(req);try{await userManager.getUserByNamePassword(getUser(req)!.username,previous);}catch{throw new LearningError(403,'当前密码不正确，请重新填写。');}
  const store=new LearningStore(vfs._db);
  await withTransaction({userManager,store},async({userManager,store})=>{
    await userManager.patchUser(getUserId(req)!,{password:next});await store.event(getUserId(req),null,'account.password');
  });await establishSession(req,getUserId(req)!);res.json({changed:true});
}));
