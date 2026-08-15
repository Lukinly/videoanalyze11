import type { AiNotes } from "@videoanalyze/domain";

export function exportNotesMarkdown(notes: AiNotes) {
  const lines = [`# ${notes.title}`, "", notes.topic, "", "## 核心观点", "", ...notes.coreIdeas.map((idea) => `- ${idea}`), ""];
  for (const section of notes.sections) {
    lines.push(`${"#".repeat(section.level)} ${section.title}`, "", section.body, "", `来源：${section.citations.map((citation) => `[${formatTime(citation.timestampSeconds)}]`).join(" ")}`, "");
  }
  lines.push("## 复习要点", "", ...notes.reviewPoints.map((point) => `- ${point}`));
  return `${lines.join("\n").trim()}\n`;
}

export function exportNotesText(notes: AiNotes) {
  const lines = [notes.title, notes.topic, "", "核心观点", ...notes.coreIdeas.map((idea) => `• ${idea}`), ""];
  for (const section of notes.sections) lines.push(section.title, section.body, `来源：${section.citations.map((citation) => formatTime(citation.timestampSeconds)).join("、")}`, "");
  lines.push("复习要点", ...notes.reviewPoints.map((point) => `• ${point}`));
  return `${lines.join("\n").trim()}\n`;
}

export function notesFileName(title: string, extension: "md" | "txt") {
  const safe = title.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "视频";
  return `${safe}-AI笔记.${extension}`;
}

export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours ? [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":") : [minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}
