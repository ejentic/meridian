import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon and cannot be bundled into the server output.
  serverExternalPackages: ['better-sqlite3'],
  // resetDb() reads schema.sql from disk at runtime, so the file has to travel with a build.
  outputFileTracingIncludes: { '/**': ['./src/db/schema.sql'] },
};

export default nextConfig;
