const http=require('node:http'),fs=require('node:fs'),path=require('node:path');const root=__dirname;http.createServer((req,res)=>{let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.ttf':'font/ttf','.js':'text/javascript; charset=utf-8','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data)})}).listen(4210,'127.0.0.1',()=>console.log('Preview http://127.0.0.1:4210'));








