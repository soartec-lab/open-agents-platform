/**
 * Shared Prisma client for the model layer.
 *
 * One instance is shared by every model module (one per DB table). DB
 * management is Prisma (schema at prisma/schema.prisma). The generated
 * `@prisma/client` is a declared dependency and pinned external in
 * vite.config.ts, so the node build imports it from node_modules at runtime —
 * engine/schema path resolution stays intact. The SQLite file lives under
 * node_modules (see the datasource url in the schema) so `vite dev`, which
 * watches the whole package root, does not reload on every write. Run
 * `prisma generate` + `prisma db push` before starting (the package
 * `dev`/`start` scripts do this).
 *
 * This module is part of the backend layer AROUND flue and has no flue
 * dependency. Production note: point the datasource at a managed database and
 * use migrations instead of `db push`.
 */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
