import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
dotenv.config();

// This file is strictly for the Drizzle CLI to read schema
// and generate SQL migrations or push directly to the DB.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
  },
});