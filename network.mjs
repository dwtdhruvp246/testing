import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { Socket } from "node:net";

const execFileAsync = promisify(execFile);

const routerFingerprints = [
  {
    type: "starlink",
    vendor: "Starlink",
    match: /starlink|spacex/i,
    capabilities: ["scan", "telemetry"]
  },
  {
    type: "mikrotik",
    vendor: "MikroTik",
    match: /mikrotik|routeros/i,
    capabilities: ["scan", "block", "slow", "restore", "schedule"]
  },
  {
    type: "openwrt",
    vendor: "OpenWrt",
    match: /openwrt|luci/i,
    capabilities: ["scan", "block", "slow", "restore"]
  },
  {
    type: "tplink",
    vendor: "TP-Link",
    match: /tp-link|tplink/i,
    capabilities: ["scan", "block", "slow"]
  },
  {
    type: "ubiquiti",
    vendor: "Ubiquiti UniFi",
    match: /unifi|ubiquiti/i,
    capabilities: ["scan", "block", "slow", "restore"]
  }
];

const macVendors = [
  ["00:0C:42", "MikroTik"],
  ["48:A9:8A", "Starlink"],
  ["74:24:9F", "Starlink"],
  ["D8:3A:DD", "Starlink"],
  ["50:C7:BF", "TP-Link"],
  ["A4:2B:B0", "TP-Link"],
  ["F4:F2:6D", "TP-Link"],
  ["24:A4:3C", "Ubiquiti"],
  ["DC:9F:DB", "Ubiquiti"],
  ["B4:FB:E4", "Ubiquiti"],
  ["3C:5C:F1", "Apple"],
  ["A4:C3:F0", "Apple"],
  ["F0:18:98", "Apple"],
  ["28:6A:BA", "Samsung"],
  ["5C:F6:DC", "Samsung"],
  ["B8:27:EB", "Raspberry Pi"],
  ["DC:A6:32", "Raspberry Pi"]
];

function run(command, args, timeout = 3000) {
  return execFileAsync(command, args, { timeout }).then(({ stdout }) => stdout).catch(() => "");
}

function firstLocalNetwork() {
  let nets = {};
  try {
    nets = networkInterfaces();
  } catch {
    return null;
  }
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry;
      }
    }
  }
  return null;
}

function normalizeMac(mac = "") {
  return mac.trim().toUpperCase().replace(/-/g, ":");
}

function deviceId({ ip, mac }) {
  return normalizeMac(mac) || ip;
}

function detectVendor(mac = "") {
  const prefix = normalizeMac(mac).slice(0, 8);
  const match = macVendors.find(([oui]) => oui === prefix);
  return match?.[1] || "Unknown";
}

function parseGateway(output) {
  const lines = output.split("\n");
  for (const line of lines) {
    const match = line.match(/default\s+via\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }
  return null;
}

function parseNeighbors(output) {
  return output
    .split("\n")
    .map((line) => {
      const ip = line.match(/^(\d+\.\d+\.\d+\.\d+)/)?.[1];
      const mac = line.match(/lladdr\s+([0-9a-f:]{17})/i)?.[1] || line.match(/at\s+([0-9a-f:]{17})/i)?.[1];
      if (!ip || !mac) return null;
      return {
        id: deviceId({ ip, mac }),
        ip,
        mac: normalizeMac(mac),
        name: "",
        vendor: detectVendor(mac),
        online: true
      };
    })
    .filter(Boolean);
}

async function httpFingerprint(host) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(`http://${host}/`, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal
    });
    const headers = [...res.headers.entries()].map(([key, value]) => `${key}: ${value}`).join("\n");
    let body = "";
    try {
      body = await res.text();
    } catch {
      body = "";
    }
    return `${headers}\n${body.slice(0, 5000)}`;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function openPort(host, port) {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(900);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
    socket.connect(port, host);
  });
}

async function detectByPorts(host) {
  const checks = await Promise.all([
    openPort(host, 8728),
    openPort(host, 8729),
    openPort(host, 80),
    openPort(host, 443)
  ]);
  if (checks[0] || checks[1]) {
    return {
      type: "mikrotik",
      vendor: "MikroTik",
      confidence: checks[1] ? "high" : "medium",
      reason: "RouterOS API port is reachable."
    };
  }
  return null;
}

export async function detectRouter() {
  const localNetwork = firstLocalNetwork();
  const routeOutput = await run("ip", ["route"]);
  const gateway = parseGateway(routeOutput) || "192.168.1.1";
  const fingerprint = await httpFingerprint(gateway);
  const portMatch = await detectByPorts(gateway);

  if (portMatch) {
    return {
      ...portMatch,
      gateway,
      localAddress: localNetwork?.address || null,
      capabilities: routerFingerprints.find((item) => item.type === portMatch.type)?.capabilities || ["scan"]
    };
  }

  const match = routerFingerprints.find((item) => item.match.test(fingerprint));
  if (match) {
    return {
      type: match.type,
      vendor: match.vendor,
      gateway,
      localAddress: localNetwork?.address || null,
      confidence: "medium",
      reason: "Matched router web interface fingerprint.",
      capabilities: match.capabilities
    };
  }

  if (gateway === "192.168.100.1" || fingerprint.match(/starlink/i)) {
    return {
      type: "starlink",
      vendor: "Starlink",
      gateway,
      localAddress: localNetwork?.address || null,
      confidence: "medium",
      reason: "Starlink management subnet detected.",
      capabilities: ["scan", "telemetry"]
    };
  }

  return {
    type: "generic",
    vendor: "Generic router",
    gateway,
    localAddress: localNetwork?.address || null,
    confidence: "low",
    reason: "No supported router fingerprint found yet.",
    capabilities: ["scan"]
  };
}

export async function scanNetwork(router) {
  const [ipNeigh, arpOutput] = await Promise.all([
    run("ip", ["neigh"]),
    run("arp", ["-a"])
  ]);

  const byId = new Map();
  for (const device of [...parseNeighbors(ipNeigh), ...parseNeighbors(arpOutput)]) {
    byId.set(device.id, {
      ...device,
      isRouter: device.ip === router.gateway
    });
  }

  if (router.gateway && ![...byId.values()].some((device) => device.ip === router.gateway)) {
    byId.set(router.gateway, {
      id: router.gateway,
      ip: router.gateway,
      mac: "",
      name: router.vendor,
      vendor: router.vendor,
      online: true,
      isRouter: true
    });
  }

  return [...byId.values()].sort((a, b) => {
    if (a.isRouter) return -1;
    if (b.isRouter) return 1;
    return a.ip.localeCompare(b.ip, undefined, { numeric: true });
  });
}
