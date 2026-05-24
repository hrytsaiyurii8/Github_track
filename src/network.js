import os from "os";

const VPN_OR_TUNNEL = /^(198\.18\.|100\.64\.|10\.\d+\.\d+\.\d+$)/;
const PREFERRED_IFACE = /ethernet|wi-?fi|wlan|eth\d|en\d/i;

/**
 * Pick this PC's LAN IPv4 (Ethernet/Wi‑Fi), not VPN virtual adapters.
 */
export function isIpv4OnThisMachine(ip) {
  if (!ip) return false;
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const net of ifaces || []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (v4 && net.address === ip) return true;
    }
  }
  return false;
}

/**
 * LAN IP for clients — auto-detect if PUBLIC_HOST is wrong or stale (DHCP).
 */
export function resolveServerLanHost() {
  const configured = process.env.PUBLIC_HOST?.trim();
  const detected = getLocalIPv4();
  if (configured && isIpv4OnThisMachine(configured)) return configured;
  if (configured && configured !== detected) {
    console.warn(
      `PUBLIC_HOST=${configured} is not assigned to this PC — using ${detected} instead. Update server/.env PUBLIC_HOST=${detected}`
    );
  }
  return detected;
}

export function listLanIPv4s() {
  const out = [];
  for (const [ifaceName, ifaces] of Object.entries(os.networkInterfaces())) {
    if (/vpn|virtual|loopback|vethernet|wsl|hyper-v/i.test(ifaceName)) continue;
    for (const net of ifaces || []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (!v4 || net.internal || VPN_OR_TUNNEL.test(net.address)) continue;
      out.push({ address: net.address, iface: ifaceName });
    }
  }
  return out;
}

export function getLocalIPv4() {
  const candidates = [];

  for (const [ifaceName, ifaces] of Object.entries(os.networkInterfaces())) {
    if (/vpn|virtual|loopback|vethernet|wsl|hyper-v/i.test(ifaceName)) continue;

    for (const net of ifaces || []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (!v4 || net.internal) continue;
      if (VPN_OR_TUNNEL.test(net.address)) continue;
      candidates.push({ address: net.address, ifaceName });
    }
  }

  const preferred = candidates.find((c) => PREFERRED_IFACE.test(c.ifaceName));
  if (preferred) return preferred.address;

  return (
    candidates.find((c) => /^172\.(1[6-9]|2\d|3[01])\./.test(c.address))
      ?.address ||
    candidates.find((c) => c.address.startsWith("192.168."))?.address ||
    candidates.find((c) => c.address.startsWith("10."))?.address ||
    candidates[0]?.address ||
    "127.0.0.1"
  );
}

export function buildApiUrl(host, port) {
  return `http://${host}:${port}`;
}

/** Public URL clients use (HTTPS on Railway/Render, or LAN). */
export function resolvePublicApiUrl(host, port) {
  const explicit = process.env.PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) return `https://${railway.replace(/^https?:\/\//, "")}`;

  const render = process.env.RENDER_EXTERNAL_URL?.trim();
  if (render) return render.replace(/\/$/, "");

  const fly = process.env.FLY_APP_NAME?.trim();
  if (fly) return `https://${fly}.fly.dev`;

  return buildApiUrl(host, port);
}
