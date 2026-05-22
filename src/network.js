import os from "os";

const VPN_OR_TUNNEL = /^(198\.18\.|100\.64\.|10\.\d+\.\d+\.\d+$)/;
const PREFERRED_IFACE = /ethernet|wi-?fi|wlan|eth\d|en\d/i;

/**
 * Pick this PC's LAN IPv4 (Ethernet/Wi‑Fi), not VPN virtual adapters.
 */
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
