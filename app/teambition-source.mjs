import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute } from 'node:path';
import { createTeambitionSourceReader } from './version-source.mjs';

const execute = promisify(execFile);
const id = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
const actions = new Map(['query','sprint-query','sfc-query','customfield-query','tfs-query','task-query'].map(action=>[action,['project',action]]));
actions.set('task-detail',['task','query']);
actions.set('task-activity',['task','activity']);
export function validateTeambitionConfig(value) {
  if (!value || !isAbsolute(value.cliPath ?? '') || !/\.exe$/i.test(value.cliPath) || !id(value.organizationId) || !id(value.projectId) || !Array.isArray(value.versionIds) || !value.versionIds.length || !value.versionIds.every(id) || !id(value.categoryFieldId) || !id(value.functionFieldId)) throw new Error('Teambition 只读来源配置不合法');
  if (value.pollingEnabled!=null && typeof value.pollingEnabled!=='boolean')throw new Error('轮询配置不合法');
  if(value.pollIntervalSeconds!=null && (!Number.isInteger(value.pollIntervalSeconds)||value.pollIntervalSeconds<60||value.pollIntervalSeconds>86400))throw new Error('轮询间隔不合法');
  return value;
}
export function createCliQuery(cliPath, run = execute) {
  return async (action, args) => {
    if (!actions.has(action)) throw new Error('来源只允许固定的只读命令');
    try {
      const { stdout } = await run(cliPath, [...actions.get(action),...args,'--json'], {shell:false,windowsHide:true,timeout:20000,maxBuffer:8*1024*1024,encoding:'utf8'});
      const result = JSON.parse(stdout);
      if (result && [403,404].includes(result.code)) {const error=new Error('来源访问失败');error.sourceStatus=result.code;throw error;}
      if (!result || typeof result !== 'object' || Array.isArray(result) || (result.code != null && result.code !== 200) || result.errorCode || result.errorMessage || result.error || !('result' in result)) throw 0;
      return result;
    } catch (error) {
      const safe=new Error('Teambition 只读查询失败');
      let value;try{value=JSON.parse(error.stdout ?? '{}');}catch{}
      const status=value?.code ?? error.sourceStatus;
      if ([403,404].includes(status)) safe.sourceStatus=status;
      throw safe;
    }
  };
}
function rows(page) {
  if (!Array.isArray(page.result) || page.nextPageToken) throw new Error('来源定义不完整');
  return page.result;
}
function names(definitions) {
  const map = {};
  for (const item of definitions) {
    const key = item.id ?? item._id;
    if (!id(key) || typeof item.name !== 'string' || !item.name.trim() || key in map) throw new Error('来源定义不合法');
    map[key] = item.name;
  }
  return map;
}
export function createTeambitionSource(config, query = createCliQuery(config.cliPath)) {
  validateTeambitionConfig(config);
  function allowed(projectId, versionId) {
    if (projectId !== config.projectId || !config.versionIds.includes(versionId)) throw new Error('来源超出已批准范围');
  }
  async function getVersion(projectId, versionId) {
    allowed(projectId,versionId);
    const projects = rows(await query('query',['--project-id',projectId]));
    const project = projects.find(p => p.id === projectId);
    if (projects.length !== 1 || project?.organizationId !== config.organizationId || typeof project.name !== 'string') throw new Error('来源企业或项目不匹配');
    const versions = rows(await query('sprint-query',['--project-id',projectId,'--id',versionId]));
    const version = versions.find(v => v.id === versionId && v.projectId === projectId);
    if (versions.length !== 1 || !version || typeof version.name !== 'string') throw new Error('来源迭代不匹配');
    return {projectId,versionId,projectName:project.name,versionName:version.name};
  }
  return {
    candidates: [{projectId:config.projectId,versionIds:[...config.versionIds]}],
    getVersion,
    async read({projectId,sourceVersionId,knownTaskIds=[]}) {
      await getVersion(projectId,sourceVersionId);
      const args = ['--project-id',projectId];
      const types = rows(await query('sfc-query',args));
      const typeNames = names(types);
      const workflowIds = [...new Set(types.map(t=>t._taskflowId ?? t.taskflowId))];
      if (!workflowIds.length || !workflowIds.every(id)) throw new Error('任务类型缺少工作流绑定');
      const statuses = [];
      for (const workflowId of workflowIds) statuses.push(...rows(await query('tfs-query',[...args,'--taskflow-id',workflowId])));
      const statusNames = names(statuses);
      const definitions = rows(await query('customfield-query',[...args,'--id',config.categoryFieldId+','+config.functionFieldId]));
      for (const [fieldId,name] of [[config.categoryFieldId,'工单分类'],[config.functionFieldId,'职能']]) {
        const matches = definitions.filter(f => (f.id ?? f._id) === fieldId);
        if (matches.length !== 1 || matches[0].name !== name || matches[0].type !== 'dropDown') throw new Error('来源字段绑定不匹配');
      }
      const fieldMap = {category:config.categoryFieldId,function:config.functionFieldId,typeNames,statusNames};
      const read = createTeambitionSourceReader({projectId,versionId:sourceVersionId,fieldMap,listTasks:({pageSize,pageToken}) => query('task-query',[
        ...args,'--tql',`sprintId = '${sourceVersionId}' AND isArchived = false ORDER BY updated DESC`,'--page-size',String(pageSize),
        ...(pageToken ? ['--page-token',pageToken] : [])
      ])});
      const snapshot = await read();
      const currentIds=new Set(snapshot.items.map(item=>item.sourceTaskId)),reconciliations=[];
      for(const taskId of knownTaskIds.filter(id=>!currentIds.has(id))) {
        if(!id(taskId))throw new Error('来源任务标识不合法');
        let detail;
        try {const found=rows(await query('task-detail',['--task-id',taskId,'--include-archived']));if(found.length>1)throw new Error('任务详情不唯一');detail=found[0];}
        catch(error){if(error.sourceStatus===403){reconciliations.push({sourceTaskId:taskId,presence:'access_restricted'});continue;}if(error.sourceStatus===404){reconciliations.push({sourceTaskId:taskId,presence:'missing_unknown'});continue;}throw error;}
        if(detail && (detail.id ?? detail.taskId)!==taskId)throw new Error('任务详情对象不匹配');
        const presence=!detail?'missing_unknown':detail.isDeleted===true?'deleted_confirmed':detail.isArchived===true?'archived':detail.projectId!==projectId||detail.sprintId!==sourceVersionId?'out_of_scope':'missing_unknown';
        reconciliations.push({sourceTaskId:taskId,presence});
      }
      const activities=[];
      for(const item of snapshot.items) {
        if(!id(item.sourceTaskId))throw new Error('来源任务标识不合法');
        let pageToken;const cursors=new Set(),eventIds=new Set();
        for(let page=0;page<100;page++) {
          const data=await query('task-activity',['--task-id',item.sourceTaskId,'--actions=','--page-size','100',...(pageToken?['--page-token',pageToken]:[])]);
          if(!Array.isArray(data.result) || (data.nextPageToken!=null && typeof data.nextPageToken!=='string'))throw new Error('来源动态分页不合法');
          for(const activity of data.result){if(eventIds.has(activity.id))throw new Error('来源动态重复');eventIds.add(activity.id);activities.push({sourceTaskId:item.sourceTaskId,activity});}
          pageToken=data.nextPageToken || '';
          if(!pageToken)break;
          if(page===99 || (cursors.has(pageToken)&&!data.result.length))throw new Error('来源动态分页未完成');
          cursors.add(pageToken);
        }
      }
      return {...snapshot,reconciliations,activities,binding:{organizationId:config.organizationId,categoryFieldId:config.categoryFieldId,functionFieldId:config.functionFieldId,typeNames,statusNames}};
    }
  };
}