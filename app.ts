import whoiser, { type WhoisSearchResult } from 'whoiser';

import { sql } from './lib/postgres';

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
  const json = await response.json();
  return json as DoHResponse;
};

const getDnssecStatus = async (domain: string) => {
  const result = await requestDoH(domain, 'A');
  return result.AD;
};

const getWhois = async (domain: string) => {
  const response = await whoiser(domain, { follow: 1 });
  const responder = Object.keys(response)[0];
  return response[responder] as WhoisSearchResult;
};

const analyzeDomain = async (domain: string) => {
  const [dnssec, whois] = await Promise.all([
    getDnssecStatus(domain),
    getWhois(domain),
  ]);

  return {
    dnssec,
    registrar: whois['Registrar'] as string | null,
    createdAt: parseDateSafe(whois['Created Date'] as string),
  };
};

const parseDateSafe = (date: string): Date | null => {
  const parsed = new Date(date);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
};

(async () => {
  const rows =
    await sql`UPDATE domains SET processing = true WHERE dnssec IS NULL LIMIT 1 RETURNING domain`;
  if (rows.length === 0) {
    return;
  }

  const { domain } = rows[0];

  const result = await analyzeDomain(domain);

  await sql`UPDATE domains SET dnssec = ${result.dnssec}, registrar = ${result.registrar}, created_at = ${result.createdAt}, processing = false WHERE domain = ${domain}`;
})().then(() => {
  console.log('Finished');
  process.exit(0);
});
