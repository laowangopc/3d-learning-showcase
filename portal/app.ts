import {Viewer} from '@photo-sphere-viewer/core';
import {MarkersPlugin} from '@photo-sphere-viewer/markers-plugin';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import {ANATOMY_CATEGORY, ORIGINAL_ANATOMY_SOURCE, initialResource} from './catalog.mjs';
import {scrollBehavior, isSearchShortcut, requestError, licenseLabel} from './interaction.mjs';
import {createThumbnail} from './thumbnails.mjs';
import {setupWorkflow} from './workflow';

type Note = {id:string,title:string,body:string,position?:{yaw:number,pitch:number}};
type Resource = {scene:string,resourceId?:number,version?:number,kind:'model'|'panorama',title:string,description:string,category:string,creator:string,sourceName:string,sourceUrl:string,license:string,licenseUrl:string,attribution:string,modifications:string,published:boolean,archived?:boolean,canEdit:boolean,assetUrl:string,thumbnailUrl?:string,byteSize:number,sha256:string,rightsReview?:any,notes?:{entries:Note[],version:number,updatedAt:string}};
const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let session:any = {user:null,canUpload:false,canReview:false};
let resources:Resource[]=[];
let resourceTotal=0,libraryOffset=0,libraryNext:number|null=null,libraryRequest=0,anatomyCount=0;
let searchTimer:ReturnType<typeof setTimeout>|undefined;
let current:Resource|null=null;
let kind='all';
let source='';
let panorama:Viewer|null=null;
let markers:MarkersPlugin|null=null;
let selection=0;
let uploadAfterLogin=false;
const compactLibrary=matchMedia('(max-width: 680px)');
function revealSelectedResource() {
  const list=$('resource-list');const item=list.querySelector<HTMLElement>('[aria-current=true]');
  if(!item)return;
  const target=item.getBoundingClientRect();const viewport=list.getBoundingClientRect();
  if(compactLibrary.matches)list.scrollLeft+=target.left-viewport.left;
  else list.scrollTop+=target.top-viewport.top;
}
const syncLibraryFilters=()=>{$<HTMLDetailsElement>('library-filters').open=!compactLibrary.matches;revealSelectedResource();};
compactLibrary.addEventListener('change',syncLibraryFilters);syncLibraryFilters();
document.documentElement.dataset.input='keyboard';
document.addEventListener('pointerdown',()=>{document.documentElement.dataset.input='pointer';},{capture:true});
document.addEventListener('keydown',event=>{
  document.documentElement.dataset.input='keyboard';
  const target=event.target as HTMLElement;
  const editing=!!target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])');
  if(isSearchShortcut(event,editing,!!document.querySelector('dialog[open]'))) {
    event.preventDefault();$<HTMLDetailsElement>('library-filters').open=true;$<HTMLInputElement>('search').focus();
  }
},{capture:true});
const notesFor = () => current?.notes?.entries ?? [];
const isEditable = () => !!current?.canEdit;

function showStatus(message:string,error=false) { $('status').hidden=!message; $('status-message').textContent=message; $('status').classList.toggle('error',error); }
$('status-dismiss').onclick=()=>showStatus('');
async function api(path:string, options:RequestInit={}) {
  const response = await fetch(path,{...options, headers:{Accept:'application/json',...options.headers}}).catch(()=>{throw new Error('无法连接服务，请检查连接后重试。');});
  const body=await response.json().catch(()=>{throw new Error('服务暂时无法完成操作，请稍后重试。');});
  if (!response.ok) {
    if(response.status===401&&session.user&&path!=='/learn/api/session'){
      await refreshSession();
      if(!session.user){await loadResources();showStatus('登录已失效，请重新登录。',true);}
    }
    throw Object.assign(new Error(typeof body.userMessage==='string'?body.userMessage:requestError(response.status)),{status:response.status});
  }
  return body;
}
const sendJson = (path:string,value:any,method='POST') => api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const sceneApi = (suffix='') => `/learn/api/resources/${encodeURIComponent(current!.scene)}${suffix}`;
function button(text:string,fn:()=>any) { const b=document.createElement('button'); b.type='button'; b.textContent=text; b.onclick=()=>Promise.resolve(fn()).catch(e=>showStatus(e.message,true)); return b; }
function labelText(text:string,cls='') { const p=document.createElement('p'); p.textContent=text;p.className=cls;return p; }
function closeDialog(id:string) { ($(id) as HTMLDialogElement).close(); }
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog=>{
  dialog.setAttribute('aria-labelledby',`${dialog.id}-title`);
  dialog.querySelector('h2')!.id=`${dialog.id}-title`;
});
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.onclick=()=>closeDialog(b.dataset.close!));

async function refreshSession() {
  try{session=await api('/learn/api/session');}catch(error:any){
    // The auth middleware clears a revoked cookie on its first 401 response.
    if(error.status!==401)throw error;session=await api('/learn/api/session');
  }
  $('account-label').textContent=session.user ? `${session.user.username} · ${session.canReview?'管理员':session.canUpload?'教师':'学习者'}`:'访客浏览';
  $('login-open').hidden=!!session.user; $('logout').hidden=!session.user; $('upload-open').hidden=!!session.user&&!session.canUpload;
  $('mine').toggleAttribute('disabled',!session.user);
  $('mine-label').hidden=!session.user;
  workflow.sessionChanged();
}
async function loadResources(prefer?:string) {
  workflow.setBusy(true);
  try {
  await loadLibraryPage(0);
  if(!prefer&&kind==='all'&&!source&&!$<HTMLInputElement>('search').value&&!$<HTMLInputElement>('mine').checked&&!$<HTMLSelectElement>('category-filter').value&&!resources.some(r=>r.published&&r.category===ANATOMY_CATEGORY&&/^心脏/.test(r.title))){
    try{const featured=await api('/learn/api/resources?'+new URLSearchParams({offset:'0',limit:'1',kind:'model',category:ANATOMY_CATEGORY,search:'心脏'}));
      if(featured.resources?.[0]&&!resources.some(r=>r.scene===featured.resources[0].scene)){resources=[featured.resources[0],...resources];renderLibrary();}
    }catch{/* Featured model is optional; the catalog remains available. */}
  }
  if(prefer&&!resources.some(r=>r.scene===prefer)){
    try{const selected:Resource=await api(`/learn/api/resources/${encodeURIComponent(prefer)}`);resources=[selected,...resources];renderLibrary();}catch{/* Archived or no longer visible: select from the current page. */}
  }
  const selected=initialResource(resources,prefer);
  if(selected) {
    await selectResource(selected.scene);
    // Reveal within the library only; never scroll the page away from the viewer.
    revealSelectedResource();
  } else { current=null;selection++;panorama?.destroy();panorama=null;markers=null;$('viewer').replaceChildren(labelText('还没有可见资源。教师登录后可上传文件。','viewer-empty'));$('resource-title').textContent='从这里开始观察';$('resource-category').textContent='选择一件资源';$('resource-kind').hidden=true;$('resource-description').textContent='选择模型或全景，开始观察。';$<HTMLButtonElement>('reset-view').disabled=true;$('visibility').textContent='未选择';$('license-caution').textContent='标注来源不能替代授权。';renderDetails();renderNotes(); }
  } finally {workflow.setBusy(false);}
}
async function loadLibraryPage(offset:number){
  const request=++libraryRequest;
  const query=new URLSearchParams({offset:String(offset),limit:'60',kind,search:$<HTMLInputElement>('search').value.trim(),
    category:$<HTMLSelectElement>('category-filter').value,source,mine:String($<HTMLInputElement>('mine').checked)});
  $('resource-list').setAttribute('aria-busy','true');
  $<HTMLButtonElement>('library-prev').disabled=true;$<HTMLButtonElement>('library-next').disabled=true;
  try{
    const data=await api('/learn/api/resources?'+query);
    if(request!==libraryRequest)return;
    resources=data.resources;resourceTotal=data.total;libraryOffset=offset;libraryNext=data.nextOffset;
    if(Array.isArray(data.categories)){
      const categories=$<HTMLSelectElement>('category-filter'),previous=categories.value;
      categories.replaceChildren(new Option('全部主题',''),...data.categories.sort((a:string,b:string)=>a===ANATOMY_CATEGORY?-1:b===ANATOMY_CATEGORY?1:a.localeCompare(b,'zh-CN')).map((c:string)=>new Option(c,c)));
      categories.value=[...categories.options].some(o=>o.value===previous)?previous:'';
      anatomyCount=data.anatomyCount??0;
    }
    renderLibrary();
  }catch(e:any){if(request===libraryRequest)showStatus(`资源列表未更新：${e.message}`,true);throw e;}
  finally{if(request===libraryRequest){$('resource-list').setAttribute('aria-busy','false');renderLibraryNavigation();}}
}
function renderLibraryNavigation(){
  $<HTMLButtonElement>('library-prev').disabled=libraryOffset===0;
  $<HTMLButtonElement>('library-next').disabled=libraryNext===null;
  $('library-page').textContent=resourceTotal?`第 ${Math.floor(libraryOffset/60)+1} 页 · 共 ${resourceTotal} 件`:'';
}
function renderLibrary() {
  const term=$<HTMLInputElement>('search').value.trim().toLowerCase();
  const mine=$<HTMLInputElement>('mine').checked;
  const category=$<HTMLSelectElement>('category-filter').value;
  $('filter-summary').textContent=term||mine||category||source||kind!=='all'?`${resourceTotal} 件匹配`:'全部资源';
  $('anatomy-source-shortcut').hidden=!anatomyCount;
  $('anatomy-source-count').textContent=`${anatomyCount} 件 · 仅登录可见`;
  $('anatomy-source-shortcut').setAttribute('aria-pressed',String(source===ORIGINAL_ANATOMY_SOURCE));
  $('clear-filters').hidden=!(term||mine||category||source||kind!=='all');
  $('resource-count').textContent=String(resourceTotal);
  $('resource-list').replaceChildren();
  if (!resources.length) $('resource-list').append(labelText('没有匹配资源，试试其他关键词。','empty'));
  for(const r of resources) {
    const item=button('',()=>selectResource(r.scene)); item.className='resource-item'; item.dataset.scene=r.scene; item.title=r.title; item.setAttribute('aria-current',String(current?.scene===r.scene));
    item.append(createThumbnail(r));
    const text=document.createElement('span'); const title=document.createElement('strong');title.textContent=r.title;
    const detail=document.createElement('small');detail.textContent=`${r.kind==='model'?'三维模型':'720 全景'} · ${r.published?r.category:'未公开'}`;
    const source=document.createElement('small');source.textContent=r.sourceName;
    text.append(title,detail,source);item.append(text); $('resource-list').append(item);
  }
}
$('search').oninput=()=>{libraryRequest++;clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadLibraryPage(0).catch(()=>{}),250);};
$('mine').onchange=()=>void loadLibraryPage(0).catch(()=>{});
$('category-filter').onchange=()=>{if($<HTMLSelectElement>('category-filter').value===ANATOMY_CATEGORY&&kind==='panorama')setKind('all');void loadLibraryPage(0).catch(()=>{});};
function setKind(value:string) {kind=value;document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===kind)));}
function clearFilters() {$<HTMLInputElement>('search').value='';$<HTMLInputElement>('mine').checked=false;$<HTMLSelectElement>('category-filter').value='';source='';setKind('all');}
$('clear-filters').onclick=()=>{clearFilters();void loadLibraryPage(0).catch(()=>{});};
$('anatomy-source-shortcut').onclick=async()=>{
  clearFilters();setKind('model');source=ORIGINAL_ANATOMY_SOURCE;await loadLibraryPage(0);
  const first=resources.find(r=>r.sourceName===ORIGINAL_ANATOMY_SOURCE&&r.sourceAssetId==='anatomy-heart') ?? resources.find(r=>r.sourceName===ORIGINAL_ANATOMY_SOURCE);
  if(first)await selectResource(first.scene);
};
document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b=>b.onclick=()=>{setKind(b.dataset.kind!);if(kind==='panorama'&&$<HTMLSelectElement>('category-filter').value===ANATOMY_CATEGORY)$<HTMLSelectElement>('category-filter').value='';void loadLibraryPage(0).catch(()=>{});});
$('library-prev').onclick=()=>void loadLibraryPage(Math.max(0,libraryOffset-60)).catch(()=>{});
$('library-next').onclick=()=>{if(libraryNext!==null)void loadLibraryPage(libraryNext).catch(()=>{});};

async function selectResource(scene:string) {
  if(current?.scene!==scene && ($<HTMLInputElement>('note-title').value || $<HTMLTextAreaElement>('note-body').value) && !confirm('当前笔记还未保存。要放弃草稿并切换资源吗？'))return;
  const token=++selection;
  workflow.setBusy(true);
  const changing=!!current&&current.scene!==scene;
  $('workspace').setAttribute('aria-busy','true');$('selection-status').hidden=false;
  try {
    const resource:Resource=await api(`/learn/api/resources/${encodeURIComponent(scene)}`);
    if(token!==selection)return;
    current=resource;$<HTMLFormElement>('note-form').reset(); history.replaceState(null,'',`#${scene}`); showStatus('');
    // Preserve list DOM, scroll position and keyboard focus during selection.
    $('resource-list').querySelectorAll<HTMLElement>('[data-scene]').forEach(item=>item.setAttribute('aria-current',String(item.dataset.scene===scene)));
    $<HTMLDetailsElement>('credit-details').open=false;
    renderDetails();await renderViewer(token);
    if(resource.canEdit&&resource.kind==='model'&&!resource.thumbnailUrl)void ensureModelThumbnail(resource);
    if(changing&&compactLibrary.matches&&token===selection){$<HTMLDetailsElement>('library-filters').open=false;$('viewer-frame').scrollIntoView({behavior:'instant',block:'start'});}
  }catch(e:any){if(token===selection)showStatus(e.message,true);}
  finally{if(token===selection){workflow.setBusy(false);$('workspace').setAttribute('aria-busy','false');$('selection-status').hidden=true;}}
}
const thumbnailJobs=new Set<string>();
let thumbnailQueue=Promise.resolve();
function ensureModelThumbnail(resource:Resource) {
  if(thumbnailJobs.has(resource.scene))return;
  thumbnailJobs.add(resource.scene);
  thumbnailQueue=thumbnailQueue.then(async()=>{
    let renderer:any;
    try {
      // Separate lazy bundle: browsing existing thumbnails never downloads GLBs or creates WebGL contexts.
      const rendererPath='/learn/thumbnail-renderer.js';
      const {createThumbnailRenderer}=await import(rendererPath);
      renderer=createThumbnailRenderer();
      const image=await renderer.render(resource.assetUrl);
      const saved=await api(`/learn/api/resources/${encodeURIComponent(resource.scene)}/thumbnail`,{method:'PUT',headers:{'Content-Type':'image/jpeg','X-Asset-Sha256':resource.sha256,'X-Thumbnail-Renderer':'2'},body:image});
      const item=resources.find(r=>r.scene===resource.scene);if(item)item.thumbnailUrl=saved.thumbnailUrl;
      if(current?.scene===resource.scene){current.thumbnailUrl=saved.thumbnailUrl;if(current.version===saved.previousVersion)current.version=saved.version;}
      const row=$('resource-list').querySelector<HTMLElement>(`[data-scene="${resource.scene}"]`);
      row?.querySelector('.resource-thumbnail')?.replaceWith(createThumbnail({...resource,thumbnailUrl:saved.thumbnailUrl}));
    }catch{ /* Original resource remains saved and usable. A later selection retries. */ }
    finally{renderer?.dispose();thumbnailJobs.delete(resource.scene);}
  });
}
async function renderViewer(token=selection) {
  if(!current)return;
  panorama?.destroy();panorama=null;markers=null;
  const resource=current;
  const container=$('viewer');container.replaceChildren();
  $('resource-title').textContent=resource.title;$('resource-category').textContent=resource.category;
  $('resource-kind').hidden=false;$('resource-kind').textContent=resource.kind==='model'?'三维模型':'720 全景';
  $('resource-description').textContent=resource.description || '旋转、放大并观察细节，把发现记录在右侧。';
  $<HTMLButtonElement>('reset-view').disabled=false;
  if(resource.kind==='panorama') {
    $('interaction-hint').textContent='拖动环顾四周 · 滚轮缩放 · 全屏时可用方向键';
    panorama=new Viewer({container,panorama:resource.assetUrl,defaultYaw:0,defaultPitch:0,defaultZoomLvl:15,
      navbar:['zoom','move','fullscreen'],mousewheelCtrlKey:false,keyboard:'fullscreen',
      lang:{zoom:'缩放',zoomIn:'放大',zoomOut:'缩小',moveUp:'向上',moveDown:'向下',moveLeft:'向左',moveRight:'向右',fullscreen:'全屏',loading:'正在读取全景…',loadError:'全景无法加载，请刷新重试。'},
      plugins:[[MarkersPlugin,{markers:[]}]],});
    markers=panorama.getPlugin(MarkersPlugin);
    panorama.addEventListener('ready',()=>{if(token===selection)renderMarkers();},{once:true});
  } else {
    $('interaction-hint').textContent='拖动旋转 · 滚轮缩放 · 右键拖动平移；测量仅供教学观察';
    // A first-party renderer document isolates Voyager's bundled Three.js and teardown.
    // It loads the actual stored scene, never a third-party resource-site page.
    const frame=document.createElement('iframe');frame.src=`/learn/model.html?scene=${encodeURIComponent(resource.scene)}`;
    frame.title=`三维观察：${resource.title}`;frame.allowFullscreen=true;
    container.append(frame);
  }
}
$('reset-view').onclick=()=>{ if(panorama) {panorama.rotate({yaw:0,pitch:0});panorama.zoom(15);} else renderViewer().catch(e=>showStatus(e.message,true)); };
function renderMarkers() {
  if(!markers)return;
  markers.setMarkers(notesFor().filter(n=>n.position).map(n=>({id:n.id,position:n.position!,circle:10,svgStyle:{fill:'#176e63',stroke:'#ffffff',strokeWidth:'3px'},tooltip:escape(n.title),data:{noteId:n.id}})));
}
function addField(label:string,value:string,url?:string,target='provenance-fields') {
  const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');
  if(url) {const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=value;dd.append(a);}else dd.textContent=value;
  $(target).append(dt,dd);
}
function renderDetails() {
  const r=current;$('provenance-fields').replaceChildren();$('credit-fields').replaceChildren();$('credit-details').hidden=!r||!(r.attribution||r.modifications);
  $<HTMLButtonElement>('copy-credit').disabled=!r;$<HTMLButtonElement>('download').disabled=!r;
  $<HTMLButtonElement>('edit-open').hidden=!r||!r.canEdit;$<HTMLButtonElement>('archive-resource').hidden=!r||!r.canEdit;
  $('note-form').hidden=!isEditable();$('note-readonly').hidden=isEditable();$('admin-actions').hidden=!r||!session.canReview;$('history-list').hidden=true;
  if(!r)workflow.renderResource(null);
  if(!r) {addField('说明','选择资源后显示逐件记录。');return;}
  $('visibility').textContent=r.published?'公开浏览':'未公开';
  $('visibility').dataset.public=String(r.published);
  workflow.renderResource(r);
  addField('作者',r.creator);addField('来源',r.sourceName,r.sourceUrl);addField('许可',licenseLabel(r.license),r.licenseUrl);
  if(r.attribution)addField('署名',r.attribution,undefined,'credit-fields');
  addField('文件',`${r.kind==='model'?'GLB':'球形全景'} · ${(r.byteSize/1024/1024).toFixed(1)} MB`);
  if(r.modifications)addField('处理',r.modifications,undefined,'credit-fields');
  if(r.rightsReview)addField('核对','查看许可依据 ↗',r.rightsReview.evidenceUrl);
  $('license-caution').textContent=r.rightsReview?'保留来源与许可条款；再次使用时仍需遵守该文件的具体条件。':'许可来自上传者声明，尚未完成公开核对。标注来源不能代替授权。';
  $('publish-open').textContent=r.published?'取消公开':'核对并公开';
  $('advanced-editor').hidden=r.kind!=='model';$<HTMLAnchorElement>('advanced-editor').href=`/ui/scenes/${encodeURIComponent(r.scene)}/edit`;
  $('anchor-label').hidden=r.kind!=='panorama';renderNotes();
}
function renderNotes() {
  $('notes-list').replaceChildren();$('note-version').textContent=current?.notes ? `${notesFor().length} 条`:'';
  if(!notesFor().length)$('notes-list').append(labelText(isEditable()?'还没有笔记。先选一个细节，写下你的发现。':'这里还没有观察笔记。\n先从形态、纹理与空间关系开始观察。','empty'));
  for(const n of notesFor()) {
    const article=document.createElement('article');article.className='note';const title=document.createElement('h3');title.textContent=n.title;article.append(title,labelText(n.body));
    if(n.position)article.append(button('看这个位置',()=>{panorama?.rotate(n.position!);}));
    if(isEditable())article.append(button('移除',async()=>{if(confirm('移除这条笔记？仍可从历史版本恢复。'))await saveNotes(notesFor().filter(x=>x.id!==n.id));}));
    $('notes-list').append(article);
  }renderMarkers();
}
async function saveNotes(entries:Note[]) {
  if(!current?.notes)return;
  const scene=current.scene;
  const updated=await sendJson(sceneApi('/notes'),{expectedVersion:current.notes.version,entries},'PUT');
  if(current?.scene!==scene)return;
  current.notes=updated;renderNotes();showStatus('笔记已保存。');
}
$<HTMLFormElement>('note-form').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget as HTMLFormElement;const submit=form.querySelector<HTMLButtonElement>('[type=submit]')!;submit.disabled=true;
  try { const note:Note={id:crypto.randomUUID(),title:$<HTMLInputElement>('note-title').value,body:$<HTMLTextAreaElement>('note-body').value};
    if(panorama&&$<HTMLInputElement>('note-anchor').checked)note.position=panorama.getPosition();
    await saveNotes([...notesFor(),note]);form.reset();$<HTMLInputElement>('note-anchor').checked=true;
  }catch(e:any){showStatus(e.message,true);}finally{submit.disabled=false;}
};
$('history-open').onclick=async()=>{try{const entries=await api(sceneApi('/notes/history'));const list=$('history-list');list.replaceChildren();list.hidden=false;for(const entry of entries)list.append(button(`v${entry.version} · ${new Date(entry.date).toLocaleString('zh-CN')} · 恢复`,async()=>{if(!confirm(`恢复到 v${entry.version}？当前版本会保留在历史中。`))return;current!.notes=await sendJson(sceneApi('/notes/restore'),{version:entry.version,expectedVersion:current!.notes!.version});renderNotes();list.hidden=true;showStatus('已恢复笔记，原版本仍保留。');}));}catch(e:any){showStatus(e.message,true);}};

$('login-open').onclick=()=>{uploadAfterLogin=false;$('login-error').textContent='';$<HTMLDialogElement>('login-dialog').showModal();};
$<HTMLFormElement>('login-form').onsubmit=async e=>{e.preventDefault();const b=(e.currentTarget as HTMLFormElement).querySelector<HTMLButtonElement>('[type=submit]')!;b.disabled=true;try{await sendJson('/learn/api/login',{username:$<HTMLInputElement>('username').value,password:$<HTMLInputElement>('password').value});$<HTMLInputElement>('password').value='';closeDialog('login-dialog');await refreshSession();await loadResources(current?.scene);showStatus('已登录。');if(uploadAfterLogin&&session.canUpload){$('upload-error').textContent='';$<HTMLDialogElement>('upload-dialog').showModal();}uploadAfterLogin=false;}catch{$('login-error').textContent='登录未完成，请核对账号与密码；连续尝试过多时请稍后重试。';}finally{b.disabled=false;}};
$('logout').onclick=async()=>{try{await sendJson('/auth/logout',{});$<HTMLInputElement>('mine').checked=false;await refreshSession();await loadResources();showStatus('已退出登录。');}catch(e:any){showStatus(e.message,true);}};
$('upload-open').onclick=()=>{if(!session.user){uploadAfterLogin=true;$('login-error').textContent='';$<HTMLDialogElement>('login-dialog').showModal();return;}$('upload-error').textContent='';$<HTMLDialogElement>('upload-dialog').showModal();};
$('upload-file').onchange=()=>{const f=$<HTMLInputElement>('upload-file').files?.[0];if(f&&!$<HTMLInputElement>('upload-title').value)$<HTMLInputElement>('upload-title').value=f.name.replace(/\.[^.]+$/,'');};
$<HTMLFormElement>('upload-form').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget as HTMLFormElement;const submit=form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const file=$<HTMLInputElement>('upload-file').files?.[0];if(!file)return;
  if(file.size>64*1024*1024){$('upload-error').textContent='文件超过 64 MB，请简化或压缩后上传。';return;}
  const data=Object.fromEntries(new FormData(form));delete data.file;
  const metadata={...data,originalFileName:file.name,rightsConfirmed:$<HTMLInputElement>('rights-confirmed').checked,kind:file.name.toLowerCase().endsWith('.glb')?'model':'panorama'};
  const metadataBuffer=new TextEncoder().encode(JSON.stringify(metadata));
  submit.disabled=true;submit.textContent='正在保存文件…';$('upload-error').textContent='';
  try {const result=await api('/learn/api/resources',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Metadata-Bytes':String(metadataBuffer.byteLength)},body:new Blob([metadataBuffer,file])});closeDialog('upload-dialog');form.reset();clearFilters();await loadResources(result.scene);showStatus('资源已保存，当前仅自己与管理员可见。准备好后，可提交公开审核。');}
  catch(e:any){$('upload-error').textContent=e.message;}finally{submit.disabled=false;submit.textContent='上传并保存';}
};
$('edit-open').onclick=()=>{
  if(!current)return;const r=current;const set=(id:string,value:string)=>{($<HTMLInputElement|HTMLTextAreaElement>(id)).value=value||'';};
  set('edit-title',r.title);set('edit-category',r.category);set('edit-description',r.description);set('edit-creator',r.creator);set('edit-source',r.sourceName);set('edit-url',r.sourceUrl);set('edit-license-url',r.licenseUrl);set('edit-attribution',r.attribution);set('edit-modifications',r.modifications);
  $<HTMLSelectElement>('edit-license').value=r.license;$<HTMLInputElement>('edit-rights-confirmed').checked=false;$('edit-error').textContent='';$<HTMLDialogElement>('edit-dialog').showModal();
};
$<HTMLFormElement>('edit-form').onsubmit=async e=>{
  e.preventDefault();if(!current?.version)return;const form=e.currentTarget as HTMLFormElement;const submit=form.querySelector<HTMLButtonElement>('[type=submit]')!;submit.disabled=true;$('edit-error').textContent='';
  try {const data=Object.fromEntries(new FormData(form));await sendJson(sceneApi(),{...data,kind:current.kind,expectedVersion:current.version,rightsConfirmed:$<HTMLInputElement>('edit-rights-confirmed').checked},'PATCH');closeDialog('edit-dialog');const scene=current.scene;await loadResources(scene);showStatus('资源说明已保存。准备好后，请再次提交公开审核。');}catch(e:any){$('edit-error').textContent=e.message;}finally{submit.disabled=false;}
};
$('archive-resource').onclick=async()=>{if(!current||!confirm('移入回收站后，资源将停止公开并从资源库隐藏。确定继续吗？'))return;try{await sendJson(sceneApi('/archive'),{confirmed:true});await loadResources();showStatus('资源已移入回收站，可在资源工作台中恢复。');}catch(e:any){showStatus(e.message,true);}};
$('copy-credit').onclick=async()=>{if(!current)return;const r=current;const text=[r.title,r.creator,r.sourceName,r.sourceUrl,r.license,r.licenseUrl,r.attribution,r.modifications].filter(Boolean).join('\n');try{await navigator.clipboard.writeText(text);showStatus('署名与来源已复制。');}catch{showStatus('浏览器不允许复制，请从来源与许可区手动复制。',true);}};
$('download').onclick=async()=>{if(!current)return;const r=current;const b=$<HTMLButtonElement>('download');b.disabled=true;try{const response=await fetch(`/scenes/${encodeURIComponent(r.scene)}`,{headers:{Accept:'application/zip'}});if(!response.ok)throw new Error('下载未完成，请确认权限后重试。');const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${r.title.replace(/[\\/:*?"<>|]/g,'_')}.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);showStatus('资源包已下载，包含文件、来源、许可与当前笔记。');}catch(e:any){showStatus(e.message,true);}finally{b.disabled=false;}};
$<HTMLButtonElement>('jump-to-view').onclick=()=>{$('viewer-frame').scrollIntoView({behavior:scrollBehavior({keyboard:document.documentElement.dataset.input==='keyboard',reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}),block:'start'});$('viewer').focus({preventScroll:true});};
let publicationTarget:any=null;
$('publish-open').onclick=async()=>{if(!current)return;const r=current as any;publicationTarget={scene:r.scene,expectedVersion:r.version,expectedRevision:r.review?.revision??0};if(r.published){if(confirm('取消公开后，其他访问者将不能继续查看或下载。是否继续？')){try{await sendJson(sceneApi('/publication'),{...publicationTarget,published:false});await loadResources(r.scene);showStatus('已取消公开。');}catch(e:any){showStatus(e.message,true);}}return;}$<HTMLFormElement>('publish-form').reset();$<HTMLInputElement>('review-url').value=r.licenseUrl||r.sourceUrl;$('publish-error').textContent='';$<HTMLDialogElement>('publish-dialog').showModal();};
$<HTMLFormElement>('publish-form').onsubmit=async e=>{e.preventDefault();const b=(e.currentTarget as HTMLFormElement).querySelector<HTMLButtonElement>('[type=submit]')!;b.disabled=true;try{await sendJson(`/learn/api/resources/${encodeURIComponent(publicationTarget.scene)}/publication`,{...publicationTarget,published:true,evidenceUrl:$<HTMLInputElement>('review-url').value,note:$<HTMLTextAreaElement>('review-note').value,redistributionConfirmed:$<HTMLInputElement>('review-confirmed').checked});closeDialog('publish-dialog');await loadResources(publicationTarget.scene);showStatus('资源已公开，访问者可浏览和下载。');}catch(e:any){$('publish-error').textContent=e.message;}finally{b.disabled=false;}};

let viewerVisible=true;
const updateJumpToView=()=>{$<HTMLButtonElement>('jump-to-view').hidden=viewerVisible||window.innerWidth>=1191;};
if('IntersectionObserver' in window){new IntersectionObserver(entries=>{viewerVisible=entries[0]?.isIntersecting??true;updateJumpToView();},{threshold:0.2}).observe($('viewer-frame'));}
window.addEventListener('resize',updateJumpToView);
updateJumpToView();
const workflow=setupWorkflow({api,sendJson,session:()=>session,current:()=>current,select:selectResource,reload:loadResources,showStatus});
(async()=>{try{await refreshSession();await loadResources(location.hash.slice(1)||undefined);}catch(e:any){showStatus(`资源未读取完成：${e.message}`,true);$('resource-list').replaceChildren(labelText('服务暂不可用，请刷新重试。','empty'));}})();
