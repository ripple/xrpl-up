/**
 * Background Docker container stats sampler.
 *
 * Streams `docker stats` during the test run and tracks peak CPU% and memory
 * per container. Call `startStatsSampler()` in globalSetup and
 * `stopStatsSampler()` in teardown to get accurate peak-load metrics instead
 * of a single point-in-time snapshot after tests finish.
 */
import { spawn, type ChildProcess } from "child_process";

interface ContainerPeak {
  peakCpu: number;
  peakMemMb: number;
}

const containerPeaks = new Map<string, ContainerPeak>();
let statsProcess: ChildProcess | null = null;

export function startStatsSampler(): void {
  try {
    const proc = spawn("docker", ["stats", "--format",
      "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    statsProcess = proc;

    let buffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const name = parts[0].trim();
        const cpuPct = parseFloat(parts[1]);
        const memMatch = parts[2].match(/([\d.]+)([GM])iB/);
        const memMb = memMatch
          ? parseFloat(memMatch[1]) * (memMatch[2] === "G" ? 1024 : 1)
          : 0;
        const peak = containerPeaks.get(name) ?? { peakCpu: 0, peakMemMb: 0 };
        peak.peakCpu = Math.max(peak.peakCpu, cpuPct);
        peak.peakMemMb = Math.max(peak.peakMemMb, memMb);
        containerPeaks.set(name, peak);
      }
    });

    proc.on("error", () => { /* best effort */ });
  } catch { /* best effort */ }
}

export function stopStatsSampler(): void {
  if (statsProcess) {
    statsProcess.kill("SIGTERM");
    statsProcess = null;
  }
}

/**
 * Format peak stats as a loggable string. Returns empty string if no data.
 */
export function formatPeakStats(): string {
  if (containerPeaks.size === 0) return "";
  return Array.from(containerPeaks.entries())
    .map(([name, p]) => `  ${name}: peak CPU=${p.peakCpu.toFixed(1)}%, peak Mem=${p.peakMemMb.toFixed(0)}MB`)
    .join("\n");
}

/**
 * Format test process memory as a loggable string.
 */
export function formatProcessMemory(): string {
  const mem = process.memoryUsage();
  return `RSS=${(mem.rss / 1024 / 1024).toFixed(0)}MB Heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB`;
}
