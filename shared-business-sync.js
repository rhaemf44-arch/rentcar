/* Shared Firestore catalogs. Local storage is a durable cache and write journal. */
(function(root){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const validId=id=>typeof id==='string'&&id.length>0&&id.length<=200&&!id.includes('/');
  class SharedCatalogSync{
    constructor(options){
      this.options=options;this.db=options.db;this.storage=options.storage;
      this.remote=new Map();this.pending=Object.create(null);this.legacy=[];this.migrated=false;
      this.ready=false;this.user=null;this.unsubscribe=null;this.flushing=null;
      this.durable=true;this.status='connecting';this.error='';this.retryTimer=null;
      const seed=this.cleanRows(options.seedRows||[]);
      let cache=null;try{cache=JSON.parse(this.storage.getItem(options.storageKey)||'null')}catch{}
      if(cache?.version===1){
        this.remote=new Map(this.cleanRows(cache.records||[]).map(row=>[row.id,row]));
        this.legacy=this.cleanRows(cache.legacy||[]);this.migrated=cache.migrated===true;
        for(const [id,op] of Object.entries(cache.pending||{})){
          if(validId(id)&&op?.id===id&&typeof op.token==='string'&&op.patch&&this.cleanRow(op.record))this.pending[id]=copy(op);
        }
      }else{this.remote=new Map(seed.map(row=>[row.id,row]));this.legacy=seed}
      this.persist();
    }
    cleanRow(value){
      if(!value||!validId(value.id))return null;
      return this.options.validate&&!this.options.validate(value)?null:copy(value);
    }
    cleanRows(rows){return Array.isArray(rows)?rows.map(row=>this.cleanRow(row)).filter(Boolean):[]}
    now(){return this.options.now?.()||new Date().toISOString()}
    token(){return this.options.token?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}
    snapshot(){
      const rows=new Map(this.remote);
      // Only missing legacy entries are overlaid. A server deletion or rename wins.
      if(!this.migrated)this.legacy.forEach(row=>{if(!rows.has(row.id))rows.set(row.id,row)});
      Object.values(this.pending).forEach(op=>rows.set(op.id,{...(rows.get(op.id)||op.record),...op.patch,id:op.id}));
      return [...rows.values()].map(copy);
    }
    persist(){
      try{
        this.storage.setItem(this.options.storageKey,JSON.stringify({version:1,records:[...this.remote.values()],legacy:this.legacy,migrated:this.migrated,pending:this.pending}));
        this.durable=true;return true;
      }catch{this.durable=false;this.emit('error','local-storage-failed');return false}
    }
    emit(status,error=''){
      this.status=this.durable?status:'error';this.error=this.durable?error:'local-storage-failed';
      this.options.onState?.({status:this.status,error:this.error,pending:Object.keys(this.pending).length,migrating:!this.migrated,localDurable:this.durable});
    }
    publish(){this.options.onRecords?.(this.snapshot())}
    start(user){
      if(user&&this.user?.uid===user.uid&&this.unsubscribe&&this.ready)return;
      this.stop();this.user=user;
      if(!user){this.emit('connecting');return}
      this.emit('connecting');
      const collection=this.db.collection(this.options.collection);
      const query=this.options.query?this.options.query(collection):collection;
      this.unsubscribe=query.onSnapshot({includeMetadataChanges:true},snapshot=>{
        if(this.user!==user)return;
        const rows=[];snapshot.forEach(doc=>{const row=this.cleanRow({...doc.data(),id:doc.id});if(row)rows.push(row)});
        const fromCache=!!snapshot.metadata?.fromCache;
        // An empty/incomplete SDK cache must not erase this device's durable cache.
        if(!fromCache||!this.remote.size)this.remote=new Map(rows.map(row=>[row.id,row]));
        this.ready=!fromCache;
        this.persist();this.publish();
        if(!this.ready){this.emit('offline');return}
        if(!this.migrated||Object.keys(this.pending).length){this.emit('pending');void this.flush()}
        else this.emit(snapshot.metadata?.hasPendingWrites?'saving':'saved');
      },error=>{if(this.user!==user)return;this.ready=false;this.emit('error',error.code||'unknown')});
    }
    stop(){
      if(this.unsubscribe)this.unsubscribe();this.unsubscribe=null;this.ready=false;this.user=null;
      if(this.retryTimer!==null){clearTimeout(this.retryTimer);this.retryTimer=null}
    }
    queue(id,patch,record){
      if(!validId(id))throw new Error('invalid-document-id');
      const before=this.snapshot().find(row=>row.id===id)||record||{id};
      const token=this.token(),merged={...before,...copy(patch),id};
      if(!this.cleanRow(merged))throw new Error('invalid-record');
      const prior=this.pending[id];
      this.pending[id]={id,record:merged,patch:{...(prior?.patch||{}),...copy(patch),id,_mutationId:token,updatedAt:this.now(),updatedBy:this.user?.uid||'offline'},token};
      const error=this.error==='local-storage-failed'?'':this.error;
      const durable=this.persist();this.publish();this.emit(durable?(error?'error':'pending'):'error',error);
      if(durable&&this.ready)void this.flush();
      return durable;
    }
    async migrateLegacy(){
      const user=this.user;if(!user||!this.ready)return false;
      const candidates=new Map(this.legacy.map(row=>[row.id,row]));
      // A confirmed empty fleet uses the first device's existing deletions too.
      if(!this.remote.size){for(const row of this.cleanRows(this.options.emptyServerRows||[]))if(!candidates.has(row.id))candidates.set(row.id,row)}
      const entries=[...candidates.values()];
      for(let offset=0;offset<Math.max(entries.length,1);offset+=100){
        if(!this.ready||this.user!==user)return false;
        const chunk=entries.slice(offset,offset+100),collection=this.db.collection(this.options.collection);
        const refs=chunk.map(row=>collection.doc(row.id));
        const backupRef=this.options.backupCollection&&offset===0?this.db.collection(this.options.backupCollection).doc(user.uid):null;
        const created=await this.db.runTransaction(async transaction=>{
          const snapshots=await Promise.all(refs.map(ref=>transaction.get(ref)));
          const backup=backupRef?await transaction.get(backupRef):null;
          if(!this.ready||this.user!==user)throw {code:'unauthenticated'};
          const created=[];
          snapshots.forEach((snapshot,index)=>{
            if(snapshot.exists)return; // Never overwrite another device, including tombstones.
            const row={...chunk[index],updatedAt:this.now(),updatedBy:user.uid};
            transaction.set(refs[index],row);created.push(row);
          });
          if(backupRef&&!backup.exists)transaction.set(backupRef,{version:1,capturedAt:this.now(),deviceId:user.uid,rows:this.legacy});
          return created;
        });
        created.forEach(row=>{if(!this.remote.has(row.id))this.remote.set(row.id,row)});
        this.persist();this.publish();
      }
      this.migrated=true;if(!this.options.keepLegacy)this.legacy=[];
      this.persist();this.publish();return true;
    }
    flush(){
      if(this.flushing)return this.flushing;
      if(!this.ready||!this.user||!this.durable)return Promise.resolve(false);
      const user=this.user;
      this.flushing=this.flushPass().finally(()=>{
        this.flushing=null;
        if(this.ready&&this.user&&this.user!==user)void this.flush();
      });return this.flushing;
    }
    async flushPass(){
      const user=this.user;this.emit('saving');
      try{
        if(!this.migrated&&!await this.migrateLegacy())return false;
        while(this.ready&&this.user===user&&Object.keys(this.pending).length){
          const op=copy(Object.values(this.pending)[0]);
          op.patch.updatedBy=user.uid;
          await this.db.collection(this.options.collection).doc(op.id).set(op.patch,{merge:true});
          this.remote.set(op.id,{...(this.remote.get(op.id)||op.record),...op.patch,id:op.id});
          if(this.pending[op.id]?.token===op.token)delete this.pending[op.id];
          this.persist();this.publish();
          if(!this.durable)return false;
        }
        this.emit(this.ready&&this.user===user?'saved':'offline');return this.ready;
      }catch(error){
        if(this.user!==user)return false;
        this.emit('error',error.code||'unknown');
        if(!['permission-denied','unauthenticated','invalid-argument'].includes(error.code)&&this.retryTimer===null){
          this.retryTimer=setTimeout(()=>{this.retryTimer=null;if(this.ready)void this.flush()},15000);
        }
        return false;
      }
    }
    retry(){this.persist();if(this.ready)return this.flush();if(this.user)this.start(this.user);return Promise.resolve(false)}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={SharedCatalogSync};
  else root.SharedCatalogSync=SharedCatalogSync;
})(typeof window==='undefined'?this:window);
