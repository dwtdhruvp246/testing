const state = {
  router: null,
  devices: [],
  query: ""
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
  routerForm: document.querySelector("#routerForm"),
  connectionResult: document.querySelector("#connectionResult"),
  deviceList: document.querySelector("#deviceList"),
  deviceTemplate: document.querySelector("#deviceTemplate"),
  scanMeta: document.querySelector("#scanMeta"),
  deviceSearch: document.querySelector("#deviceSearch")
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || body.message || "Request failed");
  return body;
}

function setBusy(button, busy, label) {
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

function renderRouter() {
  const router = state.router;
  if (!router) return;

  els.routerName.textContent = `${router.vendor || "Unknown"} (${router.type})`;
  els.routerReason.textContent = `${router.confidence || "unknown"} confidence: ${router.reason || "Detected from gateway."}`;
  els.gateway.textContent = router.gateway || "-";
  els.localAddress.textContent = `Local address: ${router.localAddress || "-"}`;
  els.capabilities.textContent = (router.capabilities || ["scan"]).join(", ");

  if (router.type === "starlink") {
    els.capabilityHint.textContent = "Starlink scanning works; block/slow requires a third-party router after Starlink.";
  } else if ((router.capabilities || []).includes("slow")) {
    els.capabilityHint.textContent = "This router type can support device controls once connected.";
  } else {
    els.capabilityHint.textContent = "Scanning is available; management controls need a supported adapter.";
  }
}

function deviceIcon(device) {
  if (device.isRouter) return "R";
  if (/apple|samsung|phone|android/i.test(`${device.vendor} ${device.name}`)) return "M";
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

    title.textContent = device.name || device.vendor || device.ip;
    meta.textContent = `${device.ip || "No IP"}${device.mac ? ` · ${device.mac}` : ""}`;
    icon.textContent = deviceIcon(device);

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
      if (action === "trust") button.textContent = device.trusted ? "Untrust" : "Trust";
      if (device.isRouter && action !== "trust") button.disabled = true;
      if (!canUseAction(action)) button.disabled = action !== "trust";
      button.addEventListener("click", () => handleDeviceAction(action, device, button));
    }

    els.deviceList.appendChild(node);
  }
}

function canUseAction(action) {
  if (action === "trust") return true;
  return (state.router?.capabilities || []).includes(action);
}

async function detectRouter() {
  setBusy(els.detectBtn, true, "Detecting...");
  try {
    state.router = await api("/api/router/detect");
    renderRouter();
  } catch (error) {
    showNotice(error.message, "warn");
  } finally {
    setBusy(els.detectBtn, false);
  }
}

async function scanDevices() {
  setBusy(els.scanBtn, true, "Scanning...");
  try {
    const result = await api("/api/network/scan");
    state.router = result.router;
    state.devices = result.devices;
    els.scanMeta.textContent = `${result.devices.length} device${result.devices.length === 1 ? "" : "s"} found · ${new Date(result.scannedAt).toLocaleString()}`;
    renderRouter();
    renderDevices();
  } catch (error) {
    showNotice(error.message, "warn");
  } finally {
    setBusy(els.scanBtn, false);
  }
}

async function connectRouter(event) {
  event.preventDefault();
  const formData = new FormData(els.routerForm);
  const payload = Object.fromEntries(formData.entries());
  if (!payload.host) payload.host = state.router?.gateway || "";

  try {
    const result = await api("/api/router/connect", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.router = result.router;
    renderRouter();
    renderDevices();
    showNotice(result.ok ? "Router connected. Device controls are available for supported actions." : result.error, result.ok ? "ok" : "warn");
  } catch (error) {
    showNotice(error.message, "warn");
  }
}

async function handleDeviceAction(action, device, button) {
  setBusy(button, true, "...");
  try {
    if (action === "trust") {
      const result = await api("/api/devices/trust", {
        method: "POST",
        body: JSON.stringify({ id: device.id, trusted: !device.trusted })
      });
      state.devices = state.devices.map((item) => item.id === result.id ? { ...item, trusted: result.trusted, risk: result.trusted ? "trusted" : "unknown" } : item);
      renderDevices();
      return;
    }

    const options = action === "slow" ? { downloadKbps: 1000, uploadKbps: 512 } : {};
    const result = await api("/api/devices/action", {
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
