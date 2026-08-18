class BaseAdapter {
  constructor(options = {}) {
    this.options = options;
    this.vendor = "Generic router";
    this.capabilities = ["scan"];
  }

  async testConnection() {
    return {
      ok: false,
      error: "This router can be scanned, but management controls are not supported yet."
    };
  }

  async applyAction(action) {
    return {
      ok: false,
      action,
      error: "This router does not expose a supported safe control API yet."
    };
  }
}

class StarlinkAdapter extends BaseAdapter {
  constructor(options) {
    super(options);
    this.vendor = "Starlink";
    this.capabilities = ["scan", "telemetry"];
  }

  async testConnection() {
    return {
      ok: false,
      model: "Starlink router",
      error: "Starlink can be monitored, but per-device block/slow controls require a third-party router in bypass mode."
    };
  }

  async applyAction(action) {
    return {
      ok: false,
      action,
      error: "Starlink's standard router does not provide a supported per-device speed/block API. Put Starlink in bypass mode and connect a MikroTik/OpenWrt router for this action."
    };
  }
}

class MikroTikAdapter extends BaseAdapter {
  constructor(options) {
    super(options);
    this.vendor = "MikroTik";
    this.capabilities = ["scan", "block", "slow", "restore", "schedule"];
  }

  get baseUrl() {
    const host = this.options.host || "192.168.88.1";
    return host.startsWith("http") ? host : `https://${host}`;
  }

  get authHeader() {
    const token = Buffer.from(`${this.options.username || ""}:${this.options.password || ""}`).toString("base64");
    return `Basic ${token}`;
  }

  async request(path, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(`${this.baseUrl}/rest${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "authorization": this.authHeader,
          "content-type": "application/json",
          ...(init.headers || {})
        }
      });
      const text = await res.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }
      if (!res.ok) {
        return { ok: false, status: res.status, body };
      }
      return { ok: true, status: res.status, body };
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection() {
    if (!this.options.username || !this.options.password) {
      return { ok: false, error: "MikroTik username and password are required." };
    }
    const result = await this.request("/system/resource");
    if (!result.ok) {
      return {
        ok: false,
        error: "Could not connect to MikroTik REST API. Enable the RouterOS REST API and check credentials.",
        details: result
      };
    }
    return {
      ok: true,
      model: result.body["board-name"] || result.body.platform || "RouterOS",
      version: result.body.version
    };
  }

  async applyAction(action, device, options) {
    if (!this.options.username || !this.options.password) {
      return {
        ok: false,
        action,
        error: "Connect to the MikroTik router first before applying controls."
      };
    }

    if (action === "block") return this.blockDevice(device);
    if (action === "slow") return this.slowDevice(device, options);
    if (action === "restore") return this.restoreDevice(device);

    return { ok: false, action, error: "Unsupported MikroTik action." };
  }

  async blockDevice(device) {
    const address = device.ip;
    const comment = `RouterWatch block ${device.id}`;
    const result = await this.request("/ip/firewall/address-list", {
      method: "PUT",
      body: JSON.stringify({
        list: "routerwatch-blocked",
        address,
        comment
      })
    });

    if (!result.ok) return { ok: false, action: "block", error: "Could not add device to block list.", details: result };
    return {
      ok: true,
      action: "block",
      message: "Device added to RouterWatch block list. Add one firewall drop rule for routerwatch-blocked if it does not already exist."
    };
  }

  async slowDevice(device, options) {
    const maxLimit = `${options.downloadKbps || 1000}k/${options.uploadKbps || 512}k`;
    const name = `routerwatch-limit-${device.id.replace(/[^a-z0-9]/gi, "-")}`;
    const result = await this.request("/queue/simple", {
      method: "PUT",
      body: JSON.stringify({
        name,
        target: `${device.ip}/32`,
        "max-limit": maxLimit,
        comment: `RouterWatch speed limit for ${device.id}`
      })
    });

    if (!result.ok) return { ok: false, action: "slow", error: "Could not create speed limit queue.", details: result };
    return {
      ok: true,
      action: "slow",
      message: `Speed limit applied at ${maxLimit}.`
    };
  }

  async restoreDevice(device) {
    return {
      ok: true,
      action: "restore",
      message: `Restore request prepared for ${device.ip}. The next version will remove matching queue/firewall entries automatically.`
    };
  }
}

class OpenWrtAdapter extends BaseAdapter {
  constructor(options) {
    super(options);
    this.vendor = "OpenWrt";
    this.capabilities = ["scan", "block", "slow", "restore"];
  }

  async testConnection() {
    return {
      ok: false,
      model: "OpenWrt",
      error: "OpenWrt support is scaffolded. Next step is wiring ubus session login and UCI firewall/SQM commands."
    };
  }

  async applyAction(action) {
    return {
      ok: false,
      action,
      error: "OpenWrt controls are planned but not wired in this prototype."
    };
  }
}

class TpLinkAdapter extends BaseAdapter {
  constructor(options) {
    super(options);
    this.vendor = "TP-Link";
    this.capabilities = ["scan", "block", "slow"];
  }

  async testConnection() {
    return {
      ok: false,
      model: "TP-Link",
      error: "TP-Link models vary a lot. This adapter needs the exact router model/API before management actions are enabled."
    };
  }
}

export function createAdapter(type = "generic", options = {}) {
  if (type === "starlink") return new StarlinkAdapter(options);
  if (type === "mikrotik") return new MikroTikAdapter(options);
  if (type === "openwrt") return new OpenWrtAdapter(options);
  if (type === "tplink") return new TpLinkAdapter(options);
  return new BaseAdapter(options);
}
