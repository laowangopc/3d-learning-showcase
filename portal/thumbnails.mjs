// Covers are decorative; the adjacent title/type supplies the accessible name.
const modelIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.25l8 4.5"/></svg>';
const panoramaIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"><path d="M3 5c6 2 12 2 18 0v14c-6-2-12-2-18 0V5Z"/><path d="m3 16 5-5 4 4 3-3 6 5"/><circle cx="15.5" cy="9" r="1"/></svg>';
export function safeThumbnailUrl(resource) {
  const prefix=`/scenes/${encodeURIComponent(resource.scene)}/`;
  return typeof resource.thumbnailUrl==='string'&&resource.thumbnailUrl.startsWith(prefix)&&/^scene-image-thumb\.jpg(?:\?v=[1-9][0-9]?)?$/.test(resource.thumbnailUrl.slice(prefix.length))?resource.thumbnailUrl:null;
}
export function createThumbnail(resource) {
  const frame=document.createElement('span');frame.className='resource-thumbnail';frame.dataset.kind=resource.kind;frame.setAttribute('aria-hidden','true');
  const placeholder=document.createElement('span');placeholder.className='thumbnail-placeholder';placeholder.innerHTML=resource.kind==='model'?modelIcon:panoramaIcon;frame.append(placeholder);
  const src=safeThumbnailUrl(resource);
  if(src){
    const image=document.createElement('img');image.alt='';image.width=480;image.height=360;image.loading='lazy';image.decoding='async';
    image.onload=()=>{frame.dataset.loaded='true';};
    image.onerror=()=>{image.hidden=true;frame.dataset.loaded='false';frame.title='预览暂不可用';};
    image.src=src;frame.append(image);
  }
  const type=document.createElement('span');type.className='thumbnail-type';type.innerHTML=resource.kind==='model'?modelIcon:panoramaIcon;frame.append(type);
  return frame;
}
