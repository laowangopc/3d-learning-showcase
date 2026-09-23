export const ANATOMY_CATEGORY = '人体器官';
export const ORIGINAL_ANATOMY_SOURCE = 'thebuggeddev/anatomy';

/** New uploads can shift offset pages during a read. Keep one entry per scene. */
export async function collectResourcePages(fetchPage) {
  const resources=new Map(),seen=new Set();let offset=0;
  while(offset!==null){
    if(!Number.isSafeInteger(offset)||offset<0||seen.has(offset)||seen.size>=1000)throw new Error('Resource pagination did not advance');
    seen.add(offset);
    const page=await fetchPage(offset);
    if(!Array.isArray(page.resources))throw new Error('Invalid resource catalog');
    for(const resource of page.resources){
      if(typeof resource.scene!=='string'||!resource.scene)throw new Error('Resource scene is missing');
      if(!resources.has(resource.scene))resources.set(resource.scene,resource);
    }
    offset=page.nextOffset;
  }
  return [...resources.values()];
}

export function filterResources(resources, {kind='all', category='', mine=false, source='', search=''}={}) {
  const term=search.trim().toLocaleLowerCase();
  return resources.filter(r =>
    (kind==='all'||r.kind===kind) && (!category||r.category===category) && (!source||r.sourceName===source) && (!mine||r.canEdit) &&
    [r.title,r.description,r.category,r.sourceName,r.creator].join(' ').toLocaleLowerCase().includes(term));
}

export function initialResource(resources, preferredScene) {
  return resources.find(r=>r.scene===preferredScene) ??
    resources.find(r=>r.published && r.category===ANATOMY_CATEGORY && /^心脏/.test(r.title)) ??
    resources.find(r=>r.published && r.category===ANATOMY_CATEGORY) ??
    resources.find(r=>r.kind==='model') ?? resources[0];
}
