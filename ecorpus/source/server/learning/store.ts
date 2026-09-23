import { DbController } from '../vfs/helpers/db.js';
import { LearningError, resourceQuota } from './validation.js';

export type CatalogQuery = { offset:number; limit:number; search:string; kind:string; mine:boolean; archived:boolean; category:string; source?:string; status?:string };

/** Projection of the versioned resource.json, not a second resource store. */
export class LearningStore extends DbController {
  async review(sceneId:number) {
    return (await this.db.get('SELECT state, revision, message, updated_at AS "updatedAt" FROM learning_reviews WHERE scene_id=$1',[sceneId])) ?? {state:'draft',revision:0,message:'',updatedAt:null};
  }
  async setReview(sceneId:number,state:string,message='') {
    return this.db.get(`INSERT INTO learning_reviews(scene_id,state,message) VALUES ($1,$2,$3)
      ON CONFLICT(scene_id) DO UPDATE SET state=EXCLUDED.state,message=EXCLUDED.message,
      revision=learning_reviews.revision+1,updated_at=CURRENT_TIMESTAMP
      RETURNING state,revision,message,updated_at AS "updatedAt"`,[sceneId,state,message]);
  }
  async put(sceneId:number, metadata:any, generation:number) {
    await this.db.run(`INSERT INTO learning_catalog(scene_id, metadata, generation) VALUES ($1,$2,$3)
      ON CONFLICT(scene_id) DO UPDATE SET metadata=EXCLUDED.metadata, generation=EXCLUDED.generation`, [sceneId,JSON.stringify(metadata),generation]);
  }
  async event(actor:number|null, scene:number|null, action:string, detail:Record<string,unknown>={}) {
    await this.db.run(`INSERT INTO learning_events(actor_id,scene_id,action,detail) VALUES ($1,$2,$3,$4)`,[actor,scene,action,JSON.stringify(detail)]);
  }
  async accountLock() { await this.db.run(`SELECT pg_advisory_xact_lock(609007,1)`); }
  async uploadLock(userId:number) { await this.db.run(`SELECT pg_advisory_xact_lock(609008,$1::integer)`,[userId % 2147483647]); }
  async usage(userId:number) {
    return (await this.db.get(`SELECT COUNT(*)::integer AS resources, COALESCE(SUM((metadata->>'byteSize')::bigint),0)::bigint AS bytes
      FROM learning_catalog c JOIN scenes s ON s.scene_id=c.scene_id WHERE s.fk_author_id=$1`,[userId]))!;
  }
  async assertQuota(userId:number, incoming:number, curatedAdmin=false) {
    const {maxResources,maxBytes}=resourceQuota(curatedAdmin);
    const usage=await this.usage(userId);
    if(usage.resources>=maxResources || usage.bytes+incoming>maxBytes) throw new LearningError(413,'已达到个人资源存储额度，请联系管理员处理；回收站中的资源仍占用额度。');
  }
  async pendingCatalog() {
    return this.db.all(`SELECT s.scene_id AS id,s.scene_name AS name,f.generation FROM scenes s
      JOIN current_files f ON f.fk_scene_id=s.scene_id AND f.name='resource.json'
      LEFT JOIN learning_catalog c ON c.scene_id=s.scene_id
      WHERE s.scene_name LIKE 'lr-%' AND (c.scene_id IS NULL OR c.generation<>f.generation)`);
  }
  async reconcile(readResource:(scene:string)=>Promise<{value:any,version:number}>) {
    for (const row of await this.pendingCatalog()) {
      try {
        const resource=await readResource(row.name);
        await this.put(Number(row.id),resource.value,resource.version);
      } catch (error:any) {
        if (error?.code!==404) throw error;
      }
    }
  }
  async page(userId:number|null, q:CatalogQuery) {
    const args:any[]=[userId,q.archived];
    const filters=[`s.scene_name LIKE 'lr-%'`,`s.archived IS ${q.archived?'NOT ':''}NULL`,
      `(s.fk_author_id=$1 OR EXISTS(SELECT 1 FROM users u WHERE u.user_id=$1 AND u.level=4)${q.archived?'':' OR s.public_access>=1'})`];
    const add=(value:any)=>`$${args.push(value)}`;
    if(q.mine)filters.push(`s.fk_author_id=$1`);
    if(q.kind!=='all')filters.push(`c.metadata->>'kind'=${add(q.kind)}`);
    if(q.category)filters.push(`c.metadata->>'category'=${add(q.category)}`);
    if(q.source)filters.push(`c.metadata->>'sourceName'=${add(q.source)}`);
    if(q.search){
      const term=add('%'+q.search.replace(/[\\%_]/g,'\\$&')+'%');
      filters.push(`concat_ws(' ',c.metadata->>'title',c.metadata->>'description',c.metadata->>'category',c.metadata->>'creator',c.metadata->>'sourceName') ILIKE ${term} ESCAPE '\\'`);
    }
    // The second parameter is used explicitly so pg can infer its type.
    filters.push(`($2::boolean OR s.archived IS NULL)`);
    if(q.status)filters.push(`(CASE WHEN s.public_access>=1 THEN 'published' WHEN r.state IN ('pending','changes') THEN r.state ELSE 'draft' END)=${add(q.status)}`);
    const from=`FROM learning_catalog c JOIN scenes s ON s.scene_id=c.scene_id LEFT JOIN learning_reviews r ON r.scene_id=s.scene_id WHERE ${filters.join(' AND ')}`;
    const total=Number((await this.db.get(`SELECT COUNT(*)::integer AS count ${from}`,args))!.count);
    const rows=await this.db.all(`SELECT s.scene_id AS id,s.scene_name AS name,s.fk_author_id AS author_id,
      s.archived,c.metadata,c.generation,CASE WHEN s.public_access>=1 THEN 'read' ELSE 'none' END AS public_access,
      json_build_object('state',COALESCE(r.state,'draft'),'revision',COALESCE(r.revision,0),'message',COALESCE(r.message,''),'updatedAt',r.updated_at) AS review
      ${from} ORDER BY s.ctime DESC,s.scene_id DESC LIMIT ${add(q.limit)} OFFSET ${add(q.offset)}`,args);
    return {rows,total,nextOffset:q.offset+rows.length<total?q.offset+rows.length:null};
  }
  async facets(userId:number|null) {
    const rows=await this.db.all(`SELECT c.metadata->>'category' AS category,
      COUNT(*) FILTER (WHERE c.metadata->>'sourceName'='thebuggeddev/anatomy')::integer AS anatomy
      FROM learning_catalog c JOIN scenes s ON s.scene_id=c.scene_id
      WHERE s.scene_name LIKE 'lr-%' AND s.archived IS NULL AND
      (s.fk_author_id=$1 OR EXISTS(SELECT 1 FROM users u WHERE u.user_id=$1 AND u.level=4) OR s.public_access>=1)
      GROUP BY c.metadata->>'category'`,[userId]);
    return {categories:rows.map((r:any)=>r.category).filter(Boolean),anatomyCount:rows.reduce((n:number,r:any)=>n+Number(r.anatomy),0)};
  }
  async archivedScene(id:number, userId:number|null, admin:boolean) {
    const row=await this.db.get(`SELECT scene_id AS id,scene_name AS name,fk_author_id AS author_id FROM scenes
      WHERE scene_id=$1 AND archived IS NOT NULL AND (fk_author_id=$2 OR $3::boolean) FOR UPDATE`,[id,userId,admin]);
    if(!row)throw new LearningError(404,'回收站中未找到此资源，或当前账号无权恢复。');
    return row;
  }
  async recentEvents(sceneId:number) {
    return this.db.all(`SELECT e.event_id AS id,e.created_at AS date,e.action,e.detail,u.username AS actor
      FROM learning_events e LEFT JOIN users u ON u.user_id=e.actor_id WHERE e.scene_id=$1 ORDER BY event_id DESC LIMIT 100`,[sceneId]);
  }
}
