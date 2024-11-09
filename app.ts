import { formatNumber } from './utils';
import { getWhoisSummary } from './lib/whois';
import { sql } from './lib/postgres';
import { UNSUPPORTED_TLDS } from './lib/constants';

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

const resolveRegistrarResult = (
  whois:
    | { registered: false }
    | {
        registered: true;
        registrar: string | null;
        createdAt: Date | null;
      }
) => {
  if (!whois.registered) return 'not registered';
  if (whois.registrar) return whois.registrar;
  if (whois.createdAt) return 'unknown';
  return null;
};

const analyzeDomain = async (domain: string) => {
  const [dnssec, whois, recordsNs, recordsDs, recordsDnskey] =
    await Promise.all([
      getDnssecStatus(domain),
      getWhoisSummary(domain),
      getDnsRecords(domain, 'NS'),
      getDnsRecords(domain, 'DS'),
      getDnsRecords(domain, 'DNSKEY'),
    ]);

  return {
    dnssec,
    registrar: resolveRegistrarResult(whois),
    createdAt: whois.registered ? whois.createdAt : null,
    recordsNs,
    recordsDs,
    recordsDnskey,
  };
};

const processEntry = async () => {
  const startTime = Date.now();

  await sql.begin(async (sql) => {
    const rows = await sql`
      SELECT domain, registrar
      FROM domains
      WHERE registrar IS NULL
      AND NOT (tld = ANY(${sql.array(UNSUPPORTED_TLDS, 1043)}))
      LIMIT 1
      FOR UPDATE SKIP LOCKED;
    `;

    if (rows.length === 0) {
      return false;
    }

    const { domain, registrar: initialRegistrar } = rows[0];

    const result = await analyzeDomain(domain).catch((e) => {
      console.error(`Failed to analyze domain ${domain}: ${e}`);
      return null;
    });

    if (!result) {
      await sql`
        UPDATE domains
        SET domain = ${domain}
        WHERE domain = ${domain};
      `;
      return false;
    }

    await sql`
      UPDATE domains
      SET dnssec = ${result.dnssec},
          registrar = ${result.registrar},
          created_at = ${result.createdAt || null},
          records_ns = ${result.recordsNs},
          records_ds = ${result.recordsDs},
          records_dnskey = ${result.recordsDnskey},
          analyzed_at = NOW()
      WHERE domain = ${domain};
    `;

    const elapsed = Date.now() - startTime;
    console.log(
      `Processed domain ${domain} in ${formatNumber(elapsed)}ms, success: ${
        result.registrar === initialRegistrar ? '❌' : '✅'
      }`
    );
  });

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
