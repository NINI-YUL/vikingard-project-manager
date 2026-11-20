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
