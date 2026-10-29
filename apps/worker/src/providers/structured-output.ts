export function normalizeProviderCitationTimes(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.sections)) return value;
  return {
    ...record,
    sections: record.sections.map((section) => {
      if (!section || typeof section !== "object") return section;
      const sectionRecord = section as Record<string, unknown>;
      if (!Array.isArray(sectionRecord.citations)) return section;
      return {
        ...sectionRecord,
        citations: sectionRecord.citations.map((citation) => citation && typeof citation === "object"
          ? { ...(citation as Record<string, unknown>), timestampSeconds: 0 }
          : citation)
      };
    })
  };
}
