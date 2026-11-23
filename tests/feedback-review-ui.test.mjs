import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const script=(await readFile(new URL('../app/public/feedback-ui.js',import.meta.url),'utf8')).replace('export async function','async function');
test('review selector uses current server candidates despite approved history and displays task title',async()=>{
 const nodes=new Map();
 const make=()=>({children:[],value:'',textContent:'',append(child){this.children.push(child);},replaceChildren(){this.children=[];}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
 let candidates=[{taskTitle:'数值任务',progressPercent:30,reasons:['需复核'],validationId:'current-validation'}];
 const api=async path=>path==='/api/versions'?[{id:'version',displayName:'测试版本'}]:{items:[],validations:[{approved:true}],history:[],total:0,validationTotal:1,historyTotal:1,nextOffset:null,sources:[],executors:[],people:[],pendingReviews:candidates};
 await runInNewContext(script+";setupFeedback({role:'owner'},api)",{document:{getElementById:get,createElement:make},api,Intl,Date});
 assert.equal(get('fb-review').children.length,2);
 assert.equal(get('fb-review').children[1].textContent,'数值任务 · 30% · 需复核');
 assert.equal(get('fb-review').children[1].value,'current-validation');
 candidates=[];await get('fb-refresh').onclick();
 assert.equal(get('fb-review').children.length,1);
 assert.equal(get('fb-review').children[0].textContent,'当前没有待复核记录');
});

test('feedback refresh gives immediate progress and restores button on success or failure',async()=>{
 const nodes=new Map(),make=()=>({children:[],value:'version',textContent:'',append(child){this.children.push(child);},replaceChildren(){this.children=[];}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
 let finish,fail=false,delayed=false;
 const api=async path=>{if(path==='/api/versions')return [{id:'version',displayName:'唯一受控版本'}];if(delayed)await new Promise(resolve=>{finish=resolve;});if(fail)throw new Error('503：服务暂不可用');return {items:[],validations:[],history:[],total:14,validationTotal:43,historyTotal:10,nextOffset:null};};
 await runInNewContext(script+";setupFeedback({role:'viewer'},api)",{document:{getElementById:get,createElement:make},api,Intl,Date});
 delayed=true;const pending=get('fb-refresh').onclick();
 assert.equal(get('fb-refresh').disabled,true);assert.match(get('fb-message').textContent,/正在刷新/);
 finish();await pending;assert.equal(get('fb-refresh').disabled,false);assert.match(get('fb-message').textContent,/刷新完成/);
 fail=true;const failed=get('fb-refresh').onclick();finish();await failed;
 assert.equal(get('fb-refresh').disabled,false);assert.match(get('fb-message').textContent,/刷新未完成.*503/);
});
