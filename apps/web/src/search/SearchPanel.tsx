import { useState, type FormEvent } from "react";
import { api, type SearchResult } from "../api/client";
import { formatTimestamp } from "../transcript/TranscriptPanel";

export function SearchPanel({ runId, onSeek }: { runId?: string; onSeek: (seconds: number) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runId || !query.trim()) return;
    setBusy(true);
    try {
      setResults((await api.search(runId, query)).results);
    } finally {
      setBusy(false);
    }
  }

  return <section className="search-panel" aria-labelledby="search-heading">
    <p className="eyebrow">Find a moment</p><h2 id="search-heading">搜索</h2>
    <form className="search-form" role="search" onSubmit={(event) => void submit(event)}><label className="visually-hidden" htmlFor="transcript-search">搜索逐字稿</label><input id="transcript-search" aria-label="搜索逐字稿" role="searchbox" placeholder="搜索逐字稿…" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="secondary-button" disabled={!runId || busy} type="submit">{busy ? "…" : "查找"}</button></form>
    {results.length > 0 && <ol className="search-results">{results.map((result) => <li key={`${result.sourceType}-${result.sourceId}`}><button type="button" onClick={() => onSeek(result.start)}><time>{formatTimestamp(result.start)}</time><span>{result.text}</span></button></li>)}</ol>}
  </section>;
}
