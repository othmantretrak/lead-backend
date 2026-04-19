import { config } from "dotenv";
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import { neon } from '@neondatabase/serverless';   // ← Add this

config({ path: ".env" }); // or .env.local
const sql = neon(process.env.DATABASE_URL!);

export const db: NeonHttpDatabase<typeof schema> = drizzle(sql, { schema });
