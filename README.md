# RouterWatch

RouterWatch is a first prototype of a safe router-aware network management app.
It discovers the local gateway, fingerprints the router, scans known LAN
neighbors, and enables device actions only through router adapters.

## What works now

- Detects the local gateway/router.
- Fingerprints known router families where possible: Starlink, MikroTik,
  OpenWrt, TP-Link, Ubiquiti, or generic.
- Lists devices from the local ARP/neighbour table.
- Lets you label devices as trusted.
- Shows capability-aware buttons for block, slow, and restore.
- Includes a MikroTik RouterOS REST adapter scaffold for official controls.

## Starlink note

The normal Starlink router does not expose reliable per-device speed limiting
or blocking controls for third-party apps. For blocking and slowing devices, the
recommended setup is:

```text
Starlink dish -> Starlink router in bypass mode -> MikroTik/OpenWrt router -> WiFi users
```

RouterWatch should then connect to the MikroTik/OpenWrt router and apply rules
there.

## Run

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Next build steps

1. Finish MikroTik restore automation by deleting matching queues/firewall list
   entries.
2. Add OpenWrt ubus login and UCI firewall/SQM commands.
3. Add device history and new-device alerts.
4. Add router-model-specific TP-Link support.
5. Package as Android or desktop app.
