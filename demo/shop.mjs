// Demo upstream: one tiny page per version. ERROR_RATE makes a share of real requests fail
// while /healthz stays green, which is exactly the failure a plain health check misses.
import http from "node:http";

const version = process.env.VERSION ?? "v1";
const color = process.env.COLOR ?? "#2563eb";
const errorRate = Number(process.env.ERROR_RATE ?? 0);

const page = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>shop ${version}</title></head>
  <body style="margin:0;display:grid;place-items:center;height:100vh;background:${color};color:#fff;font:600 48px system-ui,sans-serif">
    shop ${version}
  </body>
</html>
`;

http
  .createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
      return;
    }
    if (Math.random() < errorRate) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`shop ${version}: simulated failure\n`);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-shop-version": version });
    res.end(page);
  })
  .listen(3000);
