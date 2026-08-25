import { spawn } from "node:child_process";

export type ProcessResult = { stdout: string; stderr: string };

export function createProcessRunner() {
  return {
    run(command: string, args: string[], options: { signal?: AbortSignal; timeoutMs?: number; maxOutputBytes?: number } = {}): Promise<ProcessResult> {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, detached: true });
        let stdout = "";
        let stderr = "";
        let outputBytes = 0;
        let limitError: Error | null = null;
        const terminate = () => {
          if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
        };
        const capture = (target: "stdout" | "stderr", chunk: Buffer) => {
          outputBytes += chunk.length;
          if (options.maxOutputBytes && outputBytes > options.maxOutputBytes) {
            limitError ??= new Error(`${command} exceeded its output limit`);
            terminate();
            return;
          }
          if (target === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
        };
        child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
        child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
        const abort = () => { limitError ??= new Error(`${command} was aborted`); terminate(); };
        options.signal?.addEventListener("abort", abort, { once: true });
        const timer = options.timeoutMs ? setTimeout(() => { limitError ??= new Error(`${command} timed out`); terminate(); }, options.timeoutMs) : null;
        child.on("error", reject);
        child.on("close", (code) => {
          if (timer) clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
          if (limitError) reject(limitError);
          else if (code === 0) resolve({ stdout, stderr });
          else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-1000)}`));
        });
      });
    }
  };
}
