import { getPublicSuffix } from 'tldts';
import readline from 'node:readline';
import fs from 'node:fs';

import { sql } from './lib/postgres';
import { formatNumber } from './utils';

const CHUNK_SIZE = 32_500;

if (!process.env.INPUT_PATH) {
  console.error('INPUT_PATH environment variable is required');
  process.exit(1);
}

if (!process.env.MODE || !['raw', 'json'].includes(process.env.MODE)) {
  console.error('MODE environment variable is required');
  process.exit(1);
}
const MODE = process.env.MODE as 'raw' | 'json';

const rl = readline.createInterface({
  input: fs.createReadStream(process.env.INPUT_PATH),
  crlfDelay: Infinity,
});

const main = async () => {
  let totalInserted = 0;
  let rawChunk: string[] = [];

  for await (const line of rl) {
    rawChunk.push(line);

    if (rawChunk.length === CHUNK_SIZE) {
      await processChunk(rawChunk);
      totalInserted += rawChunk.length;
      console.log(`Inserted ${formatNumber(totalInserted)} domains`);
      rawChunk = [];
    }
  }

  // Process remaining lines
  if (rawChunk.length > 0) {
    await processChunk(rawChunk);
    totalInserted += rawChunk.length;
    console.log(`Inserted ${formatNumber(totalInserted)} domains`);
  }
};

const processChunk = async (rawChunk: string[]) => {
  const domains = rawChunk
    .map((line) => {
      if (MODE === 'raw') return line;

      try {
        const parsed = JSON.parse(line) as { value: string };
        return parsed?.value;
      } catch (e) {
        console.error(`Failed to parse line: ${line}`);
        return null;
      }
    })
    .filter((e): e is string => Boolean(e));

  const data = domains
    .map((domain) => ({
      domain: domain,
      tld: getPublicSuffix(domain),
    }))
    .filter((entry): entry is { domain: string; tld: string } =>
      Boolean(entry.tld)
    );

  await sql`
    INSERT INTO domains ${sql(data)}
    ON CONFLICT (domain) DO NOTHING
  `;
};

main().then(() => process.exit(0));
