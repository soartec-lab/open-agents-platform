/**
 * flue persistence adapter (the reserved src/db.ts slot: when this file
 * exists, flue imports its default export as the conversation store). Without
 * it, dev uses a throwaway DB deleted on every cold start and the built
 * server uses in-memory SQLite — i.e. every restart would erase all channel
 * conversations. A file under node_modules/.agent-data keeps history across
 * restarts without tripping the dev watcher (same placement rationale as the
 * Prisma DB). Known limit: the store schema is reset-only, so a future flue
 * bump may drop stored conversations.
 *
 * NOT a hand-written model — do not add domain models here (they live in
 * src/models/, one file per table).
 */
import { sqlite } from "@flue/runtime/node";

export default sqlite("./node_modules/.agent-data/flue.db");
