const routerCapabilities = {
  starlink: ["scan", "telemetry"],
  mikrotik: ["scan", "block", "slow", "restore", "schedule"],
  openwrt: ["scan", "block", "slow", "restore"],
  tplink: ["scan", "block", "slow"],
  generic: ["scan"]
};

const routerVendors = {
  starlink: "Starlink",
  mikrotik: "MikroTik",
  openwrt: "OpenWrt",
  tplink: "TP-Link",
  generic: "Generic router",
  static: "GitHub Pages static preview"
};

const demoDevices = [
  {
    id: "192.168.1.1",
    ip: "192.168.1.1",
    mac: "",
    name: "Gateway router",
    vendor: "Detected after local scan",
    online: true,
    isRouter: true,
    trusted: true,
    risk: "router"
  },
  {
    id: "demo-phone",
    ip: "192.168.1.24",
    mac: "AA:BB:CC:11:22:33",
    name: "Vidhi phone",
    vendor: "Mobile device",
    online: true,
    isRouter: false,
    trusted: true,
    risk: "trusted"
  },
  {
    id: "demo-unknown",
    ip: "192.168.1.41",
    mac: "DD:EE:FF:44:55:66",
    name: "Unknown device",
    vendor: "Unknown",
    online: true,
    isRouter: false,
    trusted: false,
    risk: "unknown"
  }
];

const state = {
  router: null,
  devices: [],
  query: "",
  hostedMode: false
};

const els = {
  detectBtn: document.querySelector("#detectBtn"),
  scanBtn: document.querySelector("#scanBtn"),
  routerName: document.querySelector("#routerName"),
  routerReason: document.querySelector("#routerReason"),
  gateway: document.querySelector("#gateway"),
  localAddress: document.querySelector("#localAddress"),
  capabilities: document.querySelector("#capabilities"),
  capabilityHint: document.querySelector("#capabilityHint"),
  hostingMode: document.querySelector("#hostingMode"),
  routerForm: document.querySelector("#routerForm"),
  connectionResult: document.querySelector("#connectionResult"),
  deviceList: document.querySelector("#deviceList"),
  deviceTemplate: document.querySelector("#deviceTemplate"),
  scanMeta: document.querySelector("#scanMeta"),
  deviceSearch: document.querySelector("#deviceSearch")
};

function apiUnavailableError(message = "The local RouterWatch API is not available from this hosted page.") {
  const error = new Error(message);
  error.code = "API_UNAVAILABLE";
  return error;
}

function isApiUnavailable(error) {
  return error?.code === "API_UNAVAILABLE" || /failed to fetch|not available|unexpected html/i.test(error?.message || "");
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
  } catch {
    throw apiUnavailableError();
  }

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  let body = {};

  if (contentType.includes("application/json")) {
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("The API returned invalid JSON.");
    }
  } else if (!res.ok || text.trim().startsWith("<")) {
    throw apiUnavailableError("The hosted page loaded, but the local API is missing.");
  }

  if (!res.ok) throw new Error(body.error || body.message || "Request failed");
  return body;
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
}

function showNotice(message, tone = "ok") {
  els.connectionResult.textContent = message;
  els.connectionResult.className = `notice show ${tone}`;
}

function enableHostedMode() {
  state.hostedMode = true;
  if (els.hostingMode) {
    els.hostingMode.hidden = false;
    els.hostingMode.textContent = "GitHub Pages mode: the page can show setup details, but real router scanning/control needs the Node backend running inside your WiFi network.";
  }
}

function staticRouter(type = "static", host = "") {
  return {
    type,
    vendor: routerVendors[type] || routerVendors.generic,
    gateway: host || "Unavailable in browser hosting",
    localAddress: "Browser-only static page",
    confidence: "static",
    reason: "GitHub Pages cannot read your LAN gateway or ARP table directly.",
    capabilities: routerCapabilities[type] || ["scan"]
  };
}

function renderRouter() {
  const router = state.router;
  if (!router) return;

  els.routerName.textContent = `${router.vendor || "Unknown"} (${router.type})`;
  els.routerReason.textContent = `${router.confidence || "unknown"} confidence: ${router.reason || "Detected from gateway."}`;
  els.gateway.textContent = router.gateway || "-";
  els.localAddress.textContent = `Local address: ${router.localAddress || "-"}`;
  els.capabilities.textContent = (router.capabilities || ["scan"]).join(", ");

  if (state.hostedMode) {
    els.capabilityHint.textContent = "Hosted mode is for viewing and setup. Start the backend on your network for live scanning and controls.";
  } else if (router.type === "starlink") {
    els.capabilityHint.textContent = "Starlink scanning works; block/slow requires a third-party router after Starlink.";
  } else if ((router.capabilities || []).includes("slow")) {
    els.capabilityHint.textContent = "This router type can support device controls once connected.";
  } else {
    els.capabilityHint.textContent = "Scanning is available; management controls need a supported adapter.";
  }
}

function deviceIcon(device) {
  if (device.isRouter) return "R";
  if (/apple|samsung|phone|android|mobile/i.test(`${device.vendor} ${device.name}`)) return "M";
  if (/raspberry/i.test(device.vendor)) return "Pi";
  return "D";
}

function filteredDevices() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.devices;
  return state.devices.filter((device) => {
    return [device.name, device.ip, device.mac, device.vendor, device.risk]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query));
  });
}

function detailHtml(device) {
  const rows = [
    ["Name", device.name || "Unknown"],
    ["IP address", device.ip || "Not available"],
    ["MAC address", device.mac || "Not available"],
    ["Vendor", device.vendor || "Unknown"],
    ["Status", device.online ? "Online" : "Unknown"],
    ["Trust state", device.isRouter ? "Router" : device.trusted ? "Trusted" : "Unknown"]
  ];

  return rows.map(([label, value]) => `
    <div>
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function renderDevices() {
  const devices = filteredDevices();
  els.deviceList.innerHTML = "";

  if (!devices.length) {
    els.deviceList.className = "device-list empty";
    els.deviceList.textContent = state.devices.length ? "No devices match your search." : "Run a scan to see connected devices.";
    return;
  }

  els.deviceList.className = "device-list";
  for (const device of devices) {
    const node = els.deviceTemplate.content.firstElementChild.cloneNode(true);
    const title = node.querySelector("h3");
    const meta = node.querySelector("p");
    const icon = node.querySelector(".device-icon");
    const badges = node.querySelector(".device-badges");
    const details = node.querySelector(".device-details");

    title.textContent = device.name || device.vendor || device.ip;
    meta.textContent = `${device.ip || "No IP"}${device.mac ? ` - ${device.mac}` : ""}`;
    icon.textContent = deviceIcon(device);
    details.innerHTML = detailHtml(device);
    details.hidden = !device.detailsOpen;

    const badgeData = [
      [device.vendor || "Unknown", ""],
      [device.isRouter ? "Router" : device.trusted ? "Trusted" : "Unknown", device.isRouter || device.trusted ? "ok" : "warn"]
    ];

    for (const [label, tone] of badgeData) {
      const badge = document.createElement("span");
      badge.className = `badge ${tone}`;
      badge.textContent = label;
      badges.appendChild(badge);
    }

    for (const button of node.querySelectorAll("button")) {
      const action = button.dataset.action;
      if (action === "details") {
        button.textContent = device.detailsOpen ? "Hide Details" : "Details";
        button.setAttribute("aria-expanded", String(Boolean(device.detailsOpen)));
      }
      if (action === "trust") button.textContent = device.trusted ? "Untrust" : "Trust";
      if (device.isRouter && !["details", "trust"].includes(action)) button.disabled = true;
      if (!state.hostedMode && !canUseAction(action)) button.disabled = !["details", "trust"].includes(action);
      button.addEventListener("click", () => handleDeviceAction(action, device, button));
    }

    els.deviceList.appendChild(node);
  }
}

function canUseAction(action) {
  if (["details", "trust"].includes(action)) return true;
  return (state.router?.capabilities || []).includes(action);
}

async function detectRouter() {
  setBusy(els.detectBtn, true, "Detecting...");
  try {
    state.router = await api("api/router/detect");
    renderRouter();
    showNotice("Router detected from the local backend.", "ok");
  } catch (error) {
    if (isApiUnavailable(error)) {
      enableHostedMode();
      state.router = staticRouter();
      renderRouter();
      showNotice("Static page loaded successfully. For live router detection, run the Node backend on a computer connected to your WiFi.", "warn");
    } else {
      showNotice(error.message, "warn");
    }
  } finally {
    setBusy(els.detectBtn, false);
  }
}

async function scanDevices() {
  setBusy(els.scanBtn, true, "Scanning...");
  try {
    const result = await api("api/network/scan");
    state.router = result.router;
    state.devices = result.devices;
    els.scanMeta.textContent = `${result.devices.length} device${result.devices.length === 1 ? "" : "s"} found - ${new Date(result.scannedAt).toLocaleString()}`;
    renderRouter();
    renderDevices();
  } catch (error) {
    if (isApiUnavailable(error)) {
      enableHostedMode();
      state.router = state.router || staticRouter();
      state.devices = demoDevices.map((device) => ({ ...device }));
      els.scanMeta.textContent = `${state.devices.length} sample devices shown - live scan needs the local backend.`;
      renderRouter();
      renderDevices();
      showNotice("GitHub Pages cannot scan your private WiFi by itself. This demo stays clickable so you can view the workflow before adding the backend.", "warn");
    } else {
      showNotice(error.message, "warn");
    }
  } finally {
    setBusy(els.scanBtn, false);
  }
}

async function connectRouter(event) {
  event.preventDefault();
  const formData = new FormData(els.routerForm);
  const payload = Object.fromEntries(formData.entries());
  if (!payload.host) payload.host = state.router?.gateway || "";

  if (state.hostedMode) {
    state.router = staticRouter(payload.type, payload.host);
    renderRouter();
    renderDevices();
    showNotice("Connection details saved for preview. Real connection requires the Node backend, because GitHub Pages cannot log in to routers on your local network.", "warn");
    return;
  }

  try {
    const result = await api("api/router/connect", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.router = result.router;
    renderRouter();
    renderDevices();
    showNotice(result.ok ? "Router connected. Device controls are available for supported actions." : result.error, result.ok ? "ok" : "warn");
  } catch (error) {
    if (isApiUnavailable(error)) {
      enableHostedMode();
      showNotice("The router API backend is not available from this hosted page.", "warn");
    } else {
      showNotice(error.message, "warn");
    }
  }
}

async function handleDeviceAction(action, device, button) {
  if (action === "details") {
    state.devices = state.devices.map((item) => item.id === device.id ? { ...item, detailsOpen: !item.detailsOpen } : item);
    renderDevices();
    return;
  }

  setBusy(button, true, "...");
  try {
    if (action === "trust") {
      if (state.hostedMode) {
        state.devices = state.devices.map((item) => item.id === device.id
          ? { ...item, trusted: !item.trusted, risk: !item.trusted ? "trusted" : "unknown" }
          : item);
        renderDevices();
        return;
      }

      const result = await api("api/devices/trust", {
        method: "POST",
        body: JSON.stringify({ id: device.id, trusted: !device.trusted })
      });
      state.devices = state.devices.map((item) => item.id === result.id ? { ...item, trusted: result.trusted, risk: result.trusted ? "trusted" : "unknown" } : item);
      renderDevices();
      return;
    }

    if (state.hostedMode) {
      showNotice(`${action} needs the local backend and a supported router adapter. On GitHub Pages this button stays visible as a setup preview only.`, "warn");
      return;
    }

    const options = action === "slow" ? { downloadKbps: 1000, uploadKbps: 512 } : {};
    const result = await api("api/devices/action", {
      method: "POST",
      body: JSON.stringify({ action, device, options })
    });
    showNotice(result.message || `${action} applied.`, "ok");
  } catch (error) {
    showNotice(error.message, "warn");
  } finally {
    setBusy(button, false);
  }
}

els.detectBtn.addEventListener("click", detectRouter);
els.scanBtn.addEventListener("click", scanDevices);
els.routerForm.addEventListener("submit", connectRouter);
els.deviceSearch.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderDevices();
});

detectRouter();
