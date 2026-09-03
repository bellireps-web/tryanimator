/**
 * Local runner for the motion proxy (no wrangler needed).
 * Serves worker/src/index.js `fetch` on plain Node:
 *
 *   node worker/local.mjs [port]   # default 8787
 *
 * Env = wrangler.toml [vars] overridden by worker/.dev.vars, which is
 * git-ignored and holds local secrets (APP_TOKEN, META_API_KEY, ...).
 * Key names are logged on boot; values never are.
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worker from "./src/index.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function parseVars(text) {
  const env = {};
  for (const line of String(text || "").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}

export function loadLocalEnv(rootDir = root) {
  const env = {};
  const toml = readFileSync(path.join(rootDir, "wrangler.toml"), "utf8");
  const section = String(toml.split(/^\[vars\]/m)[1] || "").split(/^\[/m)[0] || "";
  Object.assign(env, parseVars(section));
  const devVars = path.join(rootDir, ".dev.vars");
  if (existsSync(devVars)) Object.assign(env, parseVars(readFileSync(devVars, "utf8")));
  return env;
}

export function createLocalServer(env) {
  return http.createServer(async (nodeReq, nodeRes) => {
    try {
      const host = nodeReq.headers.host || "127.0.0.1";
      const request = new Request(`http://${host}${nodeReq.url}`, {
        method: nodeReq.method,
        headers: nodeReq.headers,
        body:
          nodeReq.method === "GET" || nodeReq.method === "HEAD"
            ? null
            : await new Promise((resolve, reject) => {
                const chunks = [];
                nodeReq.on("data", (chunk) => chunks.push(chunk));
                nodeReq.on("end", () => resolve(Buffer.concat(chunks)));
                nodeReq.on("error", reject);
              }),
      });
      const response = await worker.fetch(request, env);
      const outHeaders = {};
      response.headers.forEach((value, key) => {
        outHeaders[key] = value;
      });
      nodeRes.writeHead(response.status, outHeaders);
      nodeRes.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      nodeRes.writeHead(500, { "content-type": "application/json" });
      nodeRes.end(JSON.stringify({ code: "local_runner", message: String((error && error.message) || error) }));
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const env = loadLocalEnv();
  const port = Number(process.argv[2]) || 8787;
  // Loopback only: this process holds provider secrets, never expose it.
  createLocalServer(env).listen(port, "127.0.0.1", () => {
    console.log(`motion proxy local on http://localhost:${port} (vars: ${Object.keys(env).join(",")})`);
  });
}
