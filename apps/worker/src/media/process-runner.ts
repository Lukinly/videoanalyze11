import { spawn } from "node:child_process";

export type ProcessResult = { stdout: string; stderr: string };

export function createProcessRunner() {
  return {
    run(command: string, args: string[], options: { signal?: AbortSignal } = {}): Promise<ProcessResult> {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        const abort = () => child.kill("SIGTERM");
        options.signal?.addEventListener("abort", abort, { once: true });
        child.on("error", reject);
        child.on("close", (code) => {
          options.signal?.removeEventListener("abort", abort);
          if (code === 0) resolve({ stdout, stderr });
          else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-1000)}`));
        });
      });
    }
  };
}
