import whoiser, { type WhoisSearchResult } from 'whoiser';

import { sql } from './lib/postgres';
import { formatNumber } from './utils';

const parallelism = process.env.PARALLELISM
  ? parseInt(process.env.PARALLELISM)
  : 1;

type DoHResponse = {
  Status: number;
  TC: boolean;
  RD: boolean;
  RA: boolean;
  AD: boolean;
  CD: boolean;
  Question: {
    name: string;
    type: number;
  }[];
  Answer?: {
    name: string;
    type: number;
    TTL: number;
    data: string;
  }[];
  Authority?: {
    name: string;
    type: number;
    TTL: number;
    data: string;
  }[];
};

const requestDoH = async (domain: string, type: string) => {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${domain}&type=${type}`,
    {
      method: 'GET',
      headers: { Accept: 'application/dns-json' },
    }
  );
  if (!response.ok)
    throw new Error(
      `DoH request failed with status ${response.status} ${response.statusText} for ${domain}`
    );
  const json = await response.json();
  return json as DoHResponse;
};

const getDnssecStatus = async (domain: string) => {
  const result = await requestDoH(domain, 'A');
  return result.AD;
};

const getDnsRecords = async (domain: string, type: string) => {
  const result = await requestDoH(domain, type);
  return result.Answer?.map((e) => e.data) || [];
};

const getWhois = async (domain: string) => {
  try {
    const response = await whoiser(domain, { follow: 1 });
    const responder = Object.keys(response)[0];
    return response[responder] as WhoisSearchResult;
  } catch (e) {
    console.warn(`Failed to get whois for ${domain}: ${e}`);
    return {};
  }
};

const analyzeDomain = async (domain: string) => {
  const [dnssec, whois, recordsNs, recordsDs, recordsDnskey] =
    await Promise.all([
      getDnssecStatus(domain),
      getWhois(domain),
      getDnsRecords(domain, 'NS'),
      getDnsRecords(domain, 'DS'),
      getDnsRecords(domain, 'DNSKEY'),
    ]);

  return {
    dnssec,
    registrar: (whois['Registrar'] as string) || 'unknown',
    createdAt: parseDateSafe(whois['Created Date'] as string),
    recordsNs,
    recordsDs,
    recordsDnskey,
  };
};

const parseDateSafe = (date: string): Date | null => {
  const parsed = new Date(date);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
};

const processEntry = async () => {
  const startTime = Date.now();
  const rows = await sql`
    UPDATE domains
    SET processing = true
    WHERE domain = (
      SELECT domain
      FROM (
        SELECT domain
        FROM domains
        WHERE dnssec IS NULL
        AND processing = false
        LIMIT 50
      ) AS candidate_domains
      ORDER BY RANDOM()
      LIMIT 1
    )
    RETURNING domain
  `;
  if (rows.length === 0) {
    return false;
  }

  const { domain } = rows[0];

  const result = await analyzeDomain(domain).catch((e) => {
    console.error(`Failed to analyze domain ${domain}: ${e}`);
    return null;
  });
  if (!result) return false;

  await sql`
    UPDATE domains
    SET dnssec = ${result.dnssec},
        registrar = ${result.registrar},
        created_at = ${result.createdAt || null},
        records_ns = ${result.recordsNs},
        records_ds = ${result.recordsDs},
        records_dnskey = ${result.recordsDnskey},
        analyzed_at = NOW(),
        processing = FALSE
    WHERE domain = ${domain}
  `;
  const elapsed = Date.now() - startTime;
  console.log(`Processed domain ${domain} in ${formatNumber(elapsed)}ms`);

  return true;
};

const start = async () => {
  await Promise.all(
    Array.from({ length: parallelism }, async () => {
      while (await processEntry()) {}
    })
  );
};

start().then(() => {
  console.log('Finished');
  process.exit(0);
});
