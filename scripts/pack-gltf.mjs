/** Lossless packaging only: preserve geometry/materials; resolve only verified manifest bytes. */
export function packGltf(input,resources){
  const doc=structuredClone(input),parts=[],bases=[];let length=0;
  const append=bytes=>{
    const offset=length;parts.push(bytes);length+=bytes.length;
    const padding=(4-length%4)%4;if(padding){parts.push(Buffer.alloc(padding));length+=padding;}
    return offset;
  };
  const resource=uri=>{
    if(typeof uri!=='string'||!Object.hasOwn(resources,uri))throw new Error('Unverified external glTF resource');
    return resources[uri];
  };
  if(doc.asset?.version!=='2.0'||!doc.meshes?.length||!doc.scenes?.length)throw new Error('Missing glTF geometry');
  for(const buffer of doc.buffers??[]){
    const bytes=resource(buffer.uri);
    if(bytes.length!==buffer.byteLength)throw new Error('glTF buffer length mismatch');
    bases.push(append(bytes));
  }
  doc.bufferViews??=[];
  for(const view of doc.bufferViews){
    const base=bases[view.buffer];
    if(base===undefined||!Number.isSafeInteger(view.byteLength)||view.byteLength<0||
      (view.byteOffset??0)<0||(view.byteOffset??0)+view.byteLength>input.buffers[view.buffer].byteLength)throw new Error('Invalid buffer view');
    view.byteOffset=base+(view.byteOffset??0);view.buffer=0;
  }
  for(const image of doc.images??[]){
    if(image.uri===undefined)continue;
    const bytes=resource(image.uri);
    const mime=/\.png$/i.test(image.uri)?'image/png':/\.jpe?g$/i.test(image.uri)?'image/jpeg':null;
    if(!mime)throw new Error('Unsupported texture format');
    image.bufferView=doc.bufferViews.length;image.mimeType=mime;delete image.uri;
    doc.bufferViews.push({buffer:0,byteOffset:append(bytes),byteLength:bytes.length});
  }
  doc.buffers=[{byteLength:length}];
  let json=Buffer.from(JSON.stringify(doc),'utf8');
  json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);
  header.writeUInt32LE(28+json.length+length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(length,0);binHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,json,binHeader,...parts]);
}
