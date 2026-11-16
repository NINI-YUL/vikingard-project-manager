import {syncScheduledVersion} from './version-source.mjs';
export function createPoller(pool,source,{corpId,projectId,versionIds,intervalSeconds=900,onError=()=>{}}) {
  let timer,stopped=true,pending;
  async function runOnce() {
    if(pending)return pending;
    pending=(async()=>{
      const due=(await pool.query(`SELECT v.id FROM managed_versions v JOIN source_projects s ON s.id=v.source_project_id JOIN source_sync_states state ON state.managed_version_id=v.id JOIN people p ON p.id=v.owner_id JOIN identity_mappings i ON i.person_id=p.id WHERE v.lifecycle='enrolled' AND s.corp_id=$1 AND s.teambition_project_id=$2 AND v.source_version_id=ANY($3::text[]) AND p.active AND i.confirmed AND i.enabled AND i.corp_id=s.corp_id AND state.next_due_at<=now() ORDER BY state.next_due_at,v.id`,[corpId,projectId,versionIds])).rows;
      const results=[];
      for(const {id} of due) {
        if(stopped && timer)break;
        try {results.push(await syncScheduledVersion(pool,id,binding=>{if(binding.corpId!==corpId)throw new Error('来源企业不匹配');return source.read(binding);},intervalSeconds));}
        catch(error){if(error.status!==409)onError();}
      }
      return results;
    })();
    try{return await pending;}finally{pending=null;}
  }
  return {
    runOnce,
    start(){if(!stopped)return;stopped=false;const tick=async()=>{try{await runOnce();}catch{onError();}finally{if(!stopped){timer=setTimeout(tick,30000);timer.unref();}}};void tick();},
    async stop(){stopped=true;clearTimeout(timer);await pending?.catch(()=>{});}
  };
}