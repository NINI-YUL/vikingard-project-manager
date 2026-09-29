import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const prototypePath = fileURLToPath(new URL("../docs/prototypes/config-dashboard-prototype.html", import.meta.url));
const port = Number(process.env.PROTOTYPE_PORT ?? 4173);

createServer((request, response) => {
  if (request.url === "/favicon.ico") return response.writeHead(204).end();
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  createReadStream(prototypePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`配置库与管理看板原型：http://127.0.0.1:${port}/?variant=A`);
  console.log("按 Ctrl+C 停止。原型只使用内存中的演示数据。");
});
