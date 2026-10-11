// Demo traffic: about RPS requests per second through the edge, each from a random client address,
// so the sticky (hash-based) split still spreads across versions.
import http from "node:http";

const target = new URL(process.env.TARGET ?? "http://envoy:8080/");
const host = process.env.HOST_HEADER ?? "localhost";
const rps = Number(process.env.RPS ?? 40);
const agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
const octet = () => Math.floor(Math.random() * 256);

function fire() {
  const req = http.request(target, {
    agent,
    headers: { host, "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` },
  });
  req.on("response", (res) => res.resume());
  // The edge may be restarting or down on purpose during the demo; keep going.
  req.on("error", () => {});
  req.setTimeout(5000, () => req.destroy());
  req.end();
}

setInterval(fire, 1000 / rps);
