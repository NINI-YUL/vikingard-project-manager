import test from 'node:test';import assert from 'node:assert/strict';import {resourceFixture,reconnectedSessionStatus} from './p08-resource-check.mjs';
test('resource fixtures preserve six versions, five roots, stable identities and valid parent links at each tier',()=>{
 for(const count of [50,250,1000]){const ids=new Set();for(let v=0;v<6;v++){const data=resourceFixture(v,count),byId=new Map(data.items.map(i=>[i.sourceTaskId,i]));assert.equal(data.items.length,count);assert.equal(data.items.filter(i=>i.typeName==='需求').length,5);for(const item of data.items){assert(!ids.has(item.sourceTaskId));ids.add(item.sourceTaskId);assert.equal(item.rawSource.id,item.sourceTaskId);assert.equal(String(item.rawSource.uniqueId),item.visibleKey);if(item.typeName==='子需求')assert.equal(byId.get(item.parentSourceTaskId).typeName,'需求');}}assert.equal(ids.size,6*count);}
 assert.throws(()=>resourceFixture(6,50));assert.throws(()=>resourceFixture(0,1001));
});

test('restart probe opens a new connection and preserves session rejection',async()=>{
 const {createServer}=await import('node:http');let port=0;const sockets=new Set();
 for(let round=0;round<2;round++){
  const server=createServer((req,res)=>{res.writeHead(req.headers.cookie==='vpm_session=synthetic'?200:401);res.end('{}');});
  server.on('connection',socket=>sockets.add(socket));
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));port=server.address().port;
  try{assert.equal(await reconnectedSessionStatus('http://127.0.0.1:'+port,{token:'synthetic'}),200);assert.equal(await reconnectedSessionStatus('http://127.0.0.1:'+port,{token:'revoked'}),401);}
  finally{await new Promise(resolve=>server.close(resolve));}
 }
 assert.equal(sockets.size,4);
});
