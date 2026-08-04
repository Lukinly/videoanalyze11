import type { Pool } from "pg";
import { createUsageRepository } from "./usage.js";
import { createUserRepository } from "./users.js";
import { createVideoRepository } from "./videos.js";

export function createRepositories(pool: Pool) {
  return {
    users: createUserRepository(pool),
    videos: createVideoRepository(pool),
    usage: createUsageRepository(pool)
  };
}
