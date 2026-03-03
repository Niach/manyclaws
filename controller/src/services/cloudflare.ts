const CF_API = "https://api.cloudflare.com/client/v4";

// Configure via CLOUDFLARE_ZONES env: "domain1:zoneId1,domain2:zoneId2"
function parseDomains(): Record<string, string> {
  const raw = process.env.CLOUDFLARE_ZONES;
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const [domain, zoneId] = entry.trim().split(":");
    if (domain && zoneId) result[domain] = zoneId;
  }
  return result;
}

const DOMAINS: Record<string, string> = parseDomains();

function getToken(): string {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN not set");
  return token;
}

function getTunnelId(): string {
  const id = process.env.CLOUDFLARE_TUNNEL_ID;
  if (!id) throw new Error("CLOUDFLARE_TUNNEL_ID not set");
  return id;
}

export function getDomains(): Array<{ domain: string; zoneId: string }> {
  return Object.entries(DOMAINS).map(([domain, zoneId]) => ({ domain, zoneId }));
}

export function getHostname(domain: string, name: string, friendId: string): string {
  return `${name}-${friendId}.${domain}`;
}

export async function createDnsRecord(domain: string, hostname: string): Promise<void> {
  const zoneId = DOMAINS[domain];
  if (!zoneId) throw new Error(`Unknown domain: ${domain}`);

  const tunnelId = getTunnelId();
  const token = getToken();
  const target = `${tunnelId}.cfargotunnel.com`;

  const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "CNAME",
      name: hostname,
      content: target,
      proxied: true,
      comment: "Created by ManyClaws expose",
    }),
  });

  const data = await res.json() as any;
  if (!data.success) {
    // If record already exists, that's fine
    const alreadyExists = data.errors?.some((e: any) => e.code === 81057);
    if (!alreadyExists) {
      throw new Error(`DNS create failed: ${JSON.stringify(data.errors)}`);
    }
  }
}

export async function deleteDnsRecord(domain: string, hostname: string): Promise<void> {
  const zoneId = DOMAINS[domain];
  if (!zoneId) throw new Error(`Unknown domain: ${domain}`);

  const token = getToken();

  // Find the record by name
  const searchRes = await fetch(
    `${CF_API}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const searchData = await searchRes.json() as any;
  if (!searchData.success || !searchData.result?.length) return; // nothing to delete

  for (const record of searchData.result) {
    await fetch(`${CF_API}/zones/${zoneId}/dns_records/${record.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

/** Extract domain from a hostname like "app-danny.manyclaws.net" */
export function domainFromHostname(hostname: string): string | null {
  for (const domain of Object.keys(DOMAINS)) {
    if (hostname.endsWith(`.${domain}`)) return domain;
  }
  return null;
}
