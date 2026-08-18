import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { detectRouter, scanNetwork } from "./src/network.mjs";
import { createAdapter } from "./src/router-adapters.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);

let activeRouter = null;
let trustedDevices = new Set();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/router/detect") {
    const router = await detectRouter();
    const adapter = createAdapter(router.type, { host: router.gateway });
    activeRouter = {
      ...router,
      capabilities: adapter.capabilities,
      connection: activeRouter?.connection?.type === router.type ? activeRouter.connection : null
    };
    return sendJson(res, 200, activeRouter);
  }

  if (req.method === "GET" && url.pathname === "/api/network/scan") {
    const router = activeRouter || await detectRouter();
    const devices = await scanNetwork(router);
    const enriched = devices.map((device) => ({
      ...device,
      trusted: trustedDevices.has(device.id),
      risk: trustedDevices.has(device.id) ? "trusted" : device.isRouter ? "router" : "unknown"
    }));
    return sendJson(res, 200, {
      router,
      devices: enriched,
      scannedAt: new Date().toISOString()
    });
  }

  if (req.method === "POST" && url.pathname === "/api/router/connect") {
    const body = await readBody(req);
    const adapter = createAdapter(body.type, {
      host: body.host,
      username: body.username,
      password: body.password
    });
    const result = await adapter.testConnection();
    activeRouter = {
      type: body.type,
      gateway: body.host,
      vendor: adapter.vendor,
      model: result.model || "Unknown",
      capabilities: adapter.capabilities,
      connection: result.ok ? {
        type: body.type,
        host: body.host,
        username: body.username,
        password: body.password
      } : null
    };
    return sendJson(res, result.ok ? 200 : 400, {
      ...result,
      router: {
        ...activeRouter,
        connection: activeRouter.connection ? { type: body.type, host: body.host } : null
      }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/devices/trust") {
    const body = await readBody(req);
    if (!body.id) return sendJson(res, 400, { ok: false, error: "Missing device id" });
    if (body.trusted === false) trustedDevices.delete(body.id);
    else trustedDevices.add(body.id);
    return sendJson(res, 200, { ok: true, id: body.id, trusted: trustedDevices.has(body.id) });
  }

  if (req.method === "POST" && url.pathname === "/api/devices/action") {
    const body = await readBody(req);
    if (!body.device?.ip && !body.device?.mac) {
      return sendJson(res, 400, { ok: false, error: "Device IP or MAC is required" });
    }

    const router = activeRouter || await detectRouter();
    const connection = activeRouter?.connection || { type: router.type, host: router.gateway };
    const adapter = createAdapter(connection.type, connection);
    const result = await adapter.applyAction(body.action, body.device, body.options || {});
    return sendJson(res, result.ok ? 200 : 409, result);
  }

  return sendJson(res, 404, { ok: false, error: "Unknown API route" });
}

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) await handleApi(req, res);
    else await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Unexpected server error" });
  }
});

server.listen(port, () => {
  console.log(`RouterWatch running at http://localhost:${port}`);
});
