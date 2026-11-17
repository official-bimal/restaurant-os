/**
 * Local development database: an embedded PostgreSQL (PGlite) exposed on
 * 127.0.0.1:5433 so Prisma and `pg` connect to it like any Postgres.
 * Data is kept in ./.pglite (git-ignored). Development only; production uses
 * a managed PostgreSQL. It is isolated from any other Postgres on this machine.
 *
 * Run:  npm run db:dev      (leave it running in its own terminal)
 * URL:  postgresql://postgres:postgres@127.0.0.1:5433/postgres?connection_limit=1
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.DEV_DB_PORT ?? 5433);

async function main() {
  const db = await PGlite.create("./.pglite");
  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();
  console.log(`Dev database ready on 127.0.0.1:${PORT} (data in ./.pglite)`);

  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
