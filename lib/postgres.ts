import postgres from 'postgres';
import fs from 'node:fs/promises';

export const sql = postgres(process.env.DATABASE_URL!);

fs.readFile('./table.sql', 'utf-8')
  .then((script) => sql.unsafe(script))
  .then(() => console.log('Set up database'));
