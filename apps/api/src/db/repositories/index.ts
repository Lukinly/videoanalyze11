import type { Pool } from "pg";
import { createUsageRepository } from "./usage.js";
import { createAuthRepository } from "./auth.js";
import { createUserRepository } from "./users.js";
import { createVideoRepository } from "./videos.js";
import { createAnalysisRunRepository } from "./analysis-runs.js";
import { createSearchRepository } from "./search.js";
import { createCreditRepository } from "./credits.js";
import { createAdminRepository } from "./admin.js";
import { createTransientMediaRepository } from "../../retention/transient-media-repository.js";

export function createRepositories(pool: Pool, options: { transientCapacityBytes?: number } = {}) {
  return {
    users: createUserRepository(pool),
    videos: createVideoRepository(pool),
    usage: createUsageRepository(pool),
    credits: createCreditRepository(pool),
    admin: createAdminRepository(pool),
    auth: createAuthRepository(pool),
    runs: createAnalysisRunRepository(pool),
    search: createSearchRepository(pool),
    transientMedia: createTransientMediaRepository(pool, { capacityBytes: options.transientCapacityBytes })
  };
}
