import { getPublicSuffix } from 'tldts';

import { mongo } from './lib/mongo';
import { sql } from './lib/postgres';

const CHUNK_SIZE = 32_500;

const db = mongo.db('certstream');
const baseDomains = db.collection('baseDomains');

const main = async () => {
  console.log('Retrieving total entries count...');
  const totalEntries = await baseDomains.countDocuments({});
  console.log(`Found ${totalEntries} entries`);

  let lastValue = null;
  for (let i = 0; true; i++) {
    const query = lastValue ? { value: { $gt: lastValue } } : {};

    const chunk = await baseDomains
      .find(query)
      .sort({ value: 1 })
      .limit(CHUNK_SIZE)
      .toArray();

    if (chunk.length === 0) {
      break;
    }

    const data = chunk.map((entry) => ({
      domain: entry.value,
      tld: getPublicSuffix(entry.value),
    }));
    await sql`INSERT INTO domains ${sql(data)}`;
    console.log(
      `Inserted ${(i + 1) * CHUNK_SIZE}/${totalEntries} domains (${
        (((i + 1) * CHUNK_SIZE) / totalEntries) * 100
      }%)`
    );

    lastValue = chunk[chunk.length - 1].value;
  }
};

mongo
  .connect()
  .then(main)
  .then(() => process.exit(0));
