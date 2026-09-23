import {createThumbnail} from './thumbnails.mjs';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const value=(id:string)=>($<HTMLInputElement>(id).value);
const text=(tag:string,content:string,cls='')=>{const el=document.createElement(tag);el.textContent=content;el.className=cls;return el;};
const roleName=(role:string)=>({admin:'管理员',create:'教师',manage:'教师',use:'学习者',none:'已停用'}[role]||role);
const statusName=(state:string)=>({draft:'未提交',pending:'待审核',changes:'需修改',published:'已公开'}[state]||'未提交');
const bytes=(n:number)=>n>=1024**3?`${(n/1024**3).toFixed(1)} GB`:`${(n/1024**2).toFixed(1)} MB`;

type Context={api:(path:string,options?:RequestInit)=>Promise<any>;sendJson:(path:string,data:any,method?:string)=>Promise<any>;
  session:()=>any;current:()=>any;select:(scene:string)=>Promise<any>;reload:(scene?:string)=>Promise<any>;showStatus:(message:string,error?:boolean)=>void};
export function setupWorkflow(ctx:Context) {
  const {api,sendJson}=ctx;
  const open=(id:string)=>$<HTMLDialogElement>(id).showModal();
  const close=(id:string)=>$<HTMLDialogElement>(id).close();
  const result=(id:string,message:string,error=false)=>{$(id).textContent=message;$(id).classList.toggle('form-error',error);};
  const button=(label:string,action:()=>Promise<any>|void)=>{const b=document.createElement('button');b.type='button';b.className='quiet';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await action();}catch(e:any){ctx.showStatus(e.message,true);}finally{b.disabled=false;}};return b;};
  let view='mine',offset=0,nextOffset:number|null=null,workspaceRequest=0;
  let editing:any=null,users:any[]=[],accountOffset:number|null=0,rejectTarget:any=null,accountRequest=0,accountPending=false;
  let busy=false;
  const panel=document.createElement('section');panel.className='review-panel';panel.id='resource-review';panel.hidden=true;
  const feedback=text('p','','review-feedback');feedback.id='review-feedback';
  const controls=document.createElement('div');controls.className='manager-actions';panel.append(feedback,controls);
  $('admin-actions').before(panel);
  const endpoint=(r:any)=>`/learn/api/resources/${encodeURIComponent(r.scene)}`;
  async function decide(r:any,action:string,extra:any={}) {
    await sendJson(endpoint(r)+'/review',{action,expectedVersion:r.version,expectedRevision:r.review?.revision??0,...extra});
    await ctx.reload(r.scene);
  }
  function renderResource(r:any) {
    panel.hidden=!r?.canEdit;controls.replaceChildren();
    if(!r?.canEdit)return;
    const state=r.review?.state||(r.published?'published':'draft');
    $('visibility').textContent=statusName(state);
    feedback.textContent=state==='pending'?'已提交，等待管理员核对。需要修改说明时，可先撤回。':
      state==='changes'?`需修改：${r.review.message}`:
      state==='published'?'已公开，所有访问者均可浏览和下载。':'当前仅自己与管理员可见。准备好后，可提交公开审核。';
    if(state==='draft'||state==='changes')controls.append(button(state==='changes'?'再次提交审核':'提交公开审核',async()=>{
      if(!confirm('确认允许管理员核对后公开此资源？公开后，所有访问者均可浏览和下载。'))return;
      await decide(r,'submit',{confirmed:true});ctx.showStatus('已提交，请在“我的资源”查看审核结果。');
    }));
    if(state==='pending'){
      controls.append(button('撤回申请',async()=>{await decide(r,'withdraw');ctx.showStatus('已撤回，可以继续编辑资源说明。');}));
      if(ctx.session().canReview)controls.append(button('退回修改',()=>{
        rejectTarget=r;$<HTMLFormElement>('reject-form').reset();$('reject-title').textContent=r.title;$('reject-error').textContent='';open('reject-dialog');
      }));
    }
  }
  $<HTMLFormElement>('reject-form').onsubmit=async e=>{
    e.preventDefault();const b=$('reject-form').querySelector<HTMLButtonElement>('[type=submit]')!;b.disabled=true;
    try{await decide(rejectTarget,'reject',{message:value('reject-message')});close('reject-dialog');ctx.showStatus('修改意见已发送给上传者。');}
    catch(e:any){result('reject-error',e.message,true);}finally{b.disabled=false;}
  };
  async function loadWorkspace() {
    const request=++workspaceRequest;
    result('workspace-result','正在读取资源…');
    $('workspace-list').setAttribute('aria-busy','true');$('workspace-list').replaceChildren();
    $<HTMLButtonElement>('workspace-prev').disabled=true;$<HTMLButtonElement>('workspace-next').disabled=true;
    try{
      const data=await api('/learn/api/workspace?'+new URLSearchParams({view,offset:String(offset),search:value('workspace-search'),status:value('workspace-state')}));
      if(request!==workspaceRequest)return;
      nextOffset=data.nextOffset;
      $('storage-summary').textContent=`我的存储：${data.usage.resources} / ${data.quota.maxResources} 件 · ${bytes(Number(data.usage.bytes))} / ${bytes(data.quota.maxBytes)}。回收站仍占用额度。`;
      result('workspace-result',data.total?`共 ${data.total} 件`:view==='review'?'暂时没有等待审核的资源。':view==='trash'?'回收站是空的。':'还没有匹配的资源，可调整筛选或上传自己的文件。');
      for(const r of data.resources) {
        const row=document.createElement('article');row.className='manager-resource';row.dataset.scene=r.scene;
        row.append(createThumbnail(r));
        const content=document.createElement('div');content.className='manager-resource-content';
        content.append(text('h3',r.title));
        const state=r.review.state;
        content.append(text('p',`${view==='trash'?'已移入回收站':statusName(state)} · ${r.kind==='model'?'三维模型':'720 全景'} · ${bytes(r.byteSize)}`,'fineprint'));
        if(state==='changes'&&r.review.message)content.append(text('p',r.review.message,'review-feedback'));
        const actions=document.createElement('div');actions.className='manager-actions';
        if(view==='trash')actions.append(button('恢复资源',async()=>{
          await sendJson(`/learn/api/trash/${r.resourceId}/restore`,{});await ctx.reload();await loadWorkspace();result('workspace-result','已恢复，资源仍为未公开，可在“我的资源”中查看。');
        }));
        else actions.append(button(view==='review'?'查看并审核':'打开资源',async()=>{
          close('my-resources-dialog');await ctx.select(r.scene);$('resource-review').scrollIntoView({behavior:'instant',block:'nearest'});
          $('resource-review').querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
        }));
        content.append(actions);row.append(content);$('workspace-list').append(row);
      }
      $<HTMLButtonElement>('workspace-prev').disabled=offset===0;$<HTMLButtonElement>('workspace-next').disabled=nextOffset===null;
      $('workspace-page').textContent=`第 ${Math.floor(offset/30)+1} 页`;
    }catch(e:any){if(request===workspaceRequest)result('workspace-result',e.message,true);}
    finally{if(request===workspaceRequest)$('workspace-list').setAttribute('aria-busy','false');}
  }
  function setView(next:string) {
    view=next;offset=0;$<HTMLInputElement>('workspace-search').value='';$<HTMLSelectElement>('workspace-state').value='';
    for(const name of ['mine','review','trash'])$('workspace-'+name).setAttribute('aria-pressed',String(name===view));
    $('workspace-state-field').hidden=view!=='mine';void loadWorkspace();
  }
  $('my-resources-open').onclick=()=>{open('my-resources-dialog');setView('mine');};
  for(const name of ['mine','review','trash'])$('workspace-'+name).onclick=()=>setView(name);
  $('workspace-prev').onclick=()=>{offset=Math.max(0,offset-30);void loadWorkspace();};
  $('workspace-next').onclick=()=>{if(nextOffset!==null){offset=nextOffset;void loadWorkspace();}};
  $('workspace-refresh').onclick=()=>void loadWorkspace();
  $<HTMLFormElement>('workspace-search-form').onsubmit=e=>{e.preventDefault();offset=0;void loadWorkspace();};
  $('workspace-state').onchange=()=>{offset=0;void loadWorkspace();};
  $('account-open').onclick=()=>{$<HTMLFormElement>('password-form').reset();result('password-result','');open('account-dialog');};
  $<HTMLFormElement>('password-form').onsubmit=async e=>{
    e.preventDefault();const b=$('password-form').querySelector<HTMLButtonElement>('[type=submit]')!;
    if(value('new-password')!==value('confirm-password')){result('password-result','两次新密码不一致，请重新填写。',true);return;}
    b.disabled=true;
    try{
      await sendJson('/learn/api/account/password',{currentPassword:value('current-password'),password:value('new-password')});
      $<HTMLFormElement>('password-form').reset();result('password-result','密码已修改，其他设备需要重新登录。');
    }catch(e:any){result('password-result',e.message,true);}finally{b.disabled=false;}
  };
  function editAccount(user:any=null) {
    editing=user;$<HTMLFormElement>('account-manage-form').reset();result('account-edit-result','');
    $('accounts-directory').hidden=true;$('accounts-editor').hidden=false;
    $('account-danger').hidden=!user||user.level==='none';
    $('account-form-heading').textContent=user?`管理 ${user.username}`:'开通账号';
    $<HTMLInputElement>('managed-username').value=user?.username??'';$<HTMLInputElement>('managed-username').disabled=!!user;
    $<HTMLInputElement>('managed-email').value=user?.email??'';$<HTMLInputElement>('managed-email').disabled=!!user;
    $<HTMLSelectElement>('managed-role').value=user?.level??'create';
    $('managed-role').querySelector<HTMLOptionElement>('[value=manage]')!.hidden=user?.level!=='manage';
    $('managed-role').querySelector<HTMLOptionElement>('[value=none]')!.hidden=user?.level!=='none';
    $<HTMLInputElement>('managed-password').required=!user;
    $('managed-password-help').textContent=user?'至少 12 个字符；留空则保留原密码。保存后需重新登录。':'至少 12 个字符。创建后请私下交付初始密码，提醒使用者修改。';
    $('accounts-dialog').scrollTop=0;
    $(user?'managed-role':'managed-username').focus({preventScroll:true});
  }
  function accountDirectory(){
    editing=null;$<HTMLFormElement>('account-manage-form').reset();
    $('accounts-editor').hidden=true;$('accounts-directory').hidden=false;
    $('accounts-dialog').scrollTop=0;$('account-new').focus({preventScroll:true});
  }
  function renderAccounts(){
    $('accounts-list').replaceChildren();
    for(const u of users){
      const row=document.createElement('div');row.className='account-row';
      const identity=document.createElement('div');
      identity.append(text('strong',u.username),text('p',roleName(u.level)+(u.uid===ctx.session().user.uid?' · 当前账号':''),'fineprint'));
      row.append(identity);
      if(u.uid!==ctx.session().user.uid)row.append(button(u.level==='none'?'查看 / 启用':'编辑',()=>editAccount(u)));
      $('accounts-list').append(row);
    }
    if(!users.length)$('accounts-list').append(text('p','没有匹配的账号。','fineprint'));
  }
  async function loadAccounts(append=false) {
    const request=++accountRequest;result('accounts-result','正在读取账号…');
    $<HTMLButtonElement>('accounts-more').disabled=true;
    try{
      const query=new URLSearchParams({offset:String(append?accountOffset:0),state:value('accounts-filter')});
      const data=await api('/learn/api/accounts?'+query);
      if(request!==accountRequest)return false;
      users=append?[...users,...data.users]:data.users;accountOffset=data.nextOffset;
      renderAccounts();
      $('accounts-more').hidden=accountOffset===null;result('accounts-result','');return true;
    }catch(e:any){if(request===accountRequest)result('accounts-result',e.message,true);return false;}
    finally{if(request===accountRequest)$<HTMLButtonElement>('accounts-more').disabled=accountOffset===null;}
  }
  $('accounts-open').onclick=()=>{close('account-dialog');accountDirectory();open('accounts-dialog');void loadAccounts();};
  $('accounts-filter').onchange=()=>{users=[];accountOffset=0;renderAccounts();void loadAccounts();};
  $('account-back').onclick=()=>{if(!accountPending)accountDirectory();};
  function setAccountPending(pending:boolean){
    accountPending=pending;
    for(const id of ['account-disable','account-back','account-new'])$<HTMLButtonElement>(id).disabled=pending;
    $<HTMLFormElement>('account-manage-form').querySelector<HTMLButtonElement>('[type=submit]')!.disabled=pending;
  }
  $('account-disable').onclick=async()=>{
    if(accountPending||!editing||!confirm(`停用 ${editing.username}？该账号将无法登录，已上传资源会保留。`))return;
    setAccountPending(true);
    try{await sendJson('/learn/api/accounts/'+editing.uid,{level:'none',expectedLevel:editing.level},'PATCH');accountDirectory();
      const refreshed=await loadAccounts();result('accounts-result',refreshed?'账号已停用。':'账号已停用，但列表刷新失败。请重试读取。',!refreshed);
    }catch(e:any){result('account-edit-result',e.message,true);}finally{setAccountPending(false);}
  };
  $('accounts-more').onclick=()=>void loadAccounts(true);
  $('account-new').onclick=()=>editAccount();
  $<HTMLFormElement>('account-manage-form').onsubmit=async e=>{
    e.preventDefault();if(accountPending)return;
    const target=editing;
    try{
      const level=value('managed-role');
      if((level==='none'||level==='admin')&&(!target||target.level!==level)&&!confirm(level==='none'?'停用后，该账号将不能继续登录。是否继续？':'管理员可以管理账号及所有资源，确认授予此权限？'))return;
      if(target?.level==='none'&&level!=='none'&&!confirm('重新启用后，该账号可以再次登录。确定继续吗？'))return;
      setAccountPending(true);
      if(target)await sendJson('/learn/api/accounts/'+target.uid,{level,expectedLevel:target.level,...(value('managed-password')?{password:value('managed-password')}:{})},'PATCH');
      else await sendJson('/learn/api/accounts',{username:value('managed-username'),email:value('managed-email'),level,password:value('managed-password')});
      accountDirectory();const refreshed=await loadAccounts();
      result('accounts-result',refreshed?(target?'账号已更新，使用者需要重新登录。':'账号已开通，请通过私下渠道交付账号与初始密码。'):'操作已完成，但列表刷新失败。请重试读取。',!refreshed);
    }catch(e:any){result('account-edit-result',e.message,true);}finally{setAccountPending(false);}
  };
  // Clear secrets from the DOM when dismissed, including Escape.
  $('account-dialog').addEventListener('close',()=>{$<HTMLFormElement>('password-form').reset();});
  $('accounts-dialog').addEventListener('close',()=>{$<HTMLInputElement>('managed-password').value='';accountRequest++;});
  $('my-resources-dialog').addEventListener('close',()=>{workspaceRequest++;});
  return {
    renderResource,
    setBusy(value:boolean) {
      busy=value;controls.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=value);
      for(const id of ['edit-open','archive-resource','publish-open'])$<HTMLButtonElement>(id).disabled=value;
    },
    sessionChanged() {
      const session=ctx.session();const signed=!!session.user;
      $('my-resources-open').hidden=!signed;$('account-open').hidden=!signed;$('accounts-open').hidden=!session.canReview;$('workspace-review').hidden=!session.canReview;
      $('account-summary').textContent=signed?`${session.user.username} · ${roleName(session.user.level)}`:'';
      if(!signed){for(const id of ['account-dialog','accounts-dialog','my-resources-dialog','reject-dialog'])close(id);users=[];editing=null;}
    }
  };
}
