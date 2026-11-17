import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Must point to a NEW, empty database dedicated to this app.
    url: process.env.DATABASE_URL ?? "",
  },
});
