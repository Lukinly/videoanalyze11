import type { Pool } from "pg";
import { createUsageRepository } from "./usage.js";
import { createAuthRepository } from "./auth.js";
import { createUserRepository } from "./users.js";
import { createVideoRepository } from "./videos.js";

export function createRepositories(pool: Pool) {
  return {
    users: createUserRepository(pool),
    videos: createVideoRepository(pool),
    usage: createUsageRepository(pool),
    auth: createAuthRepository(pool)
  };
}
