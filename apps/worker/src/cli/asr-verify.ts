import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfiguredAsrProvider } from "../providers/asr-provider.js";
import { createMediaProcessor } from "../media/media-processor.js";
import { createProcessRunner } from "../media/process-runner.js";

// One short audio request, no database or storage writes, no credential output.
async function main() {
  const provider = createConfiguredAsrProvider();
  const directory = await mkdtemp(join(tmpdir(), "videoanalyze-asr-verify-"));
  try {
    const wav = join(directory, "probe.wav");
    const suppliedAudio = process.argv[2];
    const runner = createProcessRunner();
    if (suppliedAudio) await createMediaProcessor({ runner }).renderChunk(suppliedAudio, wav, 0, 5);
    else await runner.run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "2", "-c:a", "pcm_s16le", "-y", wav]);
    const metadata = await createMediaProcessor({ runner }).probeAudio(wav);
    const result = await provider.transcribeChunk({ audioFile: wav, durationSeconds: metadata.duration, language: null, timestampLevel: "segment" });
    console.log(JSON.stringify({ ok: true, audioRequest: true, timestampsValidated: true, segmentCount: result.segments.length, sample: suppliedAudio ? "supplied-audio-first-five-seconds" : "generated-silence", note: suppliedAudio ? "Transcription content is not printed." : "Silence verifies the audio API protocol; use a speech sample to check recognition quality." }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch((error: unknown) => {
  // Even local file errors must not print paths, audio data or credentials.
  const message = error instanceof Error && (/^(Qwen ASR |provider request failed with status |LLM_API_KEY |ASR_API_BASE_URL )/.test(error.message)) ? error.message : "ASR verification failed; check the key, endpoint, audio file and FFmpeg configuration";
  console.error(message); process.exitCode = 1;
});
