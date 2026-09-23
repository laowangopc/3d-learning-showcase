import {Client,accounts} from './local-api.mjs';
import {readFile} from 'node:fs/promises';
import {runtimeUrl} from './runtime-paths.mjs';
const all=await accounts();const client=new Client();
try {await client.login(all.admin);}
catch {
  // The one-time setup route rejects an existing user database. Never reset credentials.
  const key=(await readFile(runtimeUrl('secrets/setup-key.txt'),'utf8')).trim();
  const r=await client.request('/learn/api/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Key':key},body:JSON.stringify(all.admin)});
  if(!r.ok)throw new Error(`Initial account setup returned ${r.status}; existing accounts were not changed.`);
  await client.login(all.admin);
}
const existing=await client.json('/users/?limit=100');
for(const [role,account] of Object.entries(all)){
  if(!existing.some(u=>u.username===account.username))await client.send('/users/',{...account,send_onboarding:false});
  console.log(`${role}: ${account.username} (password not printed)`);
}
console.log('Existing credentials preserved. Local accounts are ready.');
