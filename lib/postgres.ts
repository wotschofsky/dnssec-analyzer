import postgres from 'postgres';
import fs from 'node:fs/promises';

export const sql = postgres({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'secret',
});

fs.readFile('./table.sql', 'utf-8')
  .then((script) => sql.unsafe(script))
  .then(() => console.log('Set up database'));
