export type SearchResult = {
  sourceType: "transcript" | "chapter" | "bullet";
  sourceId: string;
  text: string;
  start: number;
  end: number;
};

type SearchRepository = {
  query(input: { userId: string; runId: string; query: string; limit: number; mode: "trgm" | "like" }): Promise<SearchResult[]>;
};

export type SearchService = {
  query(input: { userId: string; runId: string; query: string; limit: number }): Promise<SearchResult[]>;
};

export function createSearchService(dependencies: { search: SearchRepository; availability?: { assertAvailable(input: { userId: string; runId: string }): Promise<unknown> } }): SearchService {
  return {
    async query(input) {
      const query = input.query.trim();
      if (!query) return [];
      await dependencies.availability?.assertAvailable({ userId: input.userId, runId: input.runId });
      const limit = Math.min(50, Math.max(1, Math.floor(input.limit) || 20));
      const mode = isShortChineseQuery(query) ? "like" : "trgm";
      return dependencies.search.query({ userId: input.userId, runId: input.runId, query, limit, mode });
    }
  };
}

function isShortChineseQuery(query: string) {
  return /^[\u3400-\u9fff]{1,2}$/u.test(query);
}
