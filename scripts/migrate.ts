import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Client } from 'pg';

function loadEnv() {
  const root = path.resolve(__dirname, '..');
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    throw new Error('.env file not found');
  }
}

function pickPostgresUrl(): string {
  const inDocker = fs.existsSync('/.dockerenv') || process.env.CONTAINER === 'true';
  const urlDocker = process.env.POSTGRES_URL;
  const urlLocal = process.env.POSTGRES_URL_LOCAL || process.env.POSTGRES_URL_HOST || '';
  const fallback = 'postgres://postgres:postgres@localhost:5432/notify';
  return (inDocker ? urlDocker : (urlLocal || urlDocker)) || fallback;
}

async function runMigrations() {
  loadEnv();
  const sqlPath = path.resolve(__dirname, 'schema.sql');
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`schema.sql not found at ${sqlPath}`);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const connectionString = pickPostgresUrl();
  const client = new Client({ connectionString });

  console.log(JSON.stringify({ level: 'info', msg: 'connecting to postgres', connectionString }));
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log(JSON.stringify({ level: 'info', msg: 'migration complete' }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(JSON.stringify({ level: 'error', msg: 'migration failed', error: (err as Error).message }));
    throw err;
  } finally {
    await client.end();
  }
}

runMigrations().catch((err) => {
  console.error(err);
  process.exit(1);
});
