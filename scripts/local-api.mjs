import { runtimeUrl } from './runtime-paths.mjs';
import {readFile} from 'node:fs/promises';
import {collectResourcePages} from '../portal/catalog.mjs';
import {setTimeout as delay} from 'node:timers/promises';
export const base = process.env.ANATOMY_API_BASE || 'http://127.0.0.1:3080';
export async function accounts() {return JSON.parse(await readFile(runtimeUrl('secrets/accounts.json'),'utf8'));}
export class Client {
  cookies=new Map();
  async request(path,options={}) {
    const response=await fetch(`${base}${path}`,{...options,headers:{Accept:'application/json',Origin:base,Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; '),...options.headers},signal:AbortSignal.timeout(120000)});
    for(const cookie of response.headers.getSetCookie()){const part=cookie.split(';')[0];const i=part.indexOf('=');this.cookies.set(part.slice(0,i),part.slice(i+1));}
    return response;
  }
  async json(path,options={}) {const r=await this.request(path,options);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`${r.status}: ${data.message??'Request failed'}`);return data;}
  async send(path,body,method='POST') {return this.json(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
  async login(account){return this.send('/auth/login',{username:account.username,password:account.password});}
  async resources() {
    return collectResourcePages(offset=>this.json(`/learn/api/resources?offset=${offset}`));
  }
  async uploadResponse(bytes,metadata){const header=Buffer.from(JSON.stringify(metadata),'utf8');return this.request('/learn/api/resources',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Metadata-Bytes':String(header.length)},body:Buffer.concat([header,bytes])});}
  async upload(bytes,metadata){
    for(let attempt=0;attempt<4;attempt++){
      const r=await this.uploadResponse(bytes,metadata);const data=await r.json();
      // This route rejects 429 before accepting a file; retry only that safe busy response.
      // Never retry network failures automatically: the upload may already have committed.
      if(r.status===429&&attempt<3){await delay(500*(attempt+1));continue;}
      if(!r.ok)throw new Error(`${r.status}: ${data.message}`);return data;
    }
  }
}
