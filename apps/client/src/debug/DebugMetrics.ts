export interface PerformanceStats {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
}

export class DebugMetrics {
  private readonly frameMsBuffer: number[] = new Array(120).fill(0);
  private frameMsIndex = 0;
  private frameCount = 0;

  private readonly chunkGenBuffer: number[] = new Array(120).fill(0);
  private chunkGenIndex = 0;
  private chunkGenCount = 0;
  private benchmarkSamples: number[] | null = null;
  private benchmarkResolve: ((stats: PerformanceStats) => void) | null = null;

  recordFrame(frameMs: number): void {
    this.frameMsBuffer[this.frameMsIndex] = frameMs;
    this.frameMsIndex = (this.frameMsIndex + 1) % 120;
    if (this.frameCount < 120) this.frameCount++;
    if (this.benchmarkSamples) this.benchmarkSamples.push(frameMs);
  }

  recordChunkGen(ms: number): void {
    this.chunkGenBuffer[this.chunkGenIndex] = ms;
    this.chunkGenIndex = (this.chunkGenIndex + 1) % 120;
    if (this.chunkGenCount < 120) this.chunkGenCount++;
  }

  frameStats(): PerformanceStats {
    return this.computeStats(this.frameMsBuffer, this.frameCount);
  }

  chunkStats(): PerformanceStats {
    return this.computeStats(this.chunkGenBuffer, this.chunkGenCount);
  }

  getFrameHistory(): readonly number[] {
    if (this.frameCount < 120) {
      return this.frameMsBuffer.slice(0, this.frameCount);
    }
    const result = new Array(120);
    for (let i = 0; i < 120; i++) {
      result[i] = this.frameMsBuffer[(this.frameMsIndex + i) % 120] as number;
    }
    return result;
  }

  runBenchmark(durationMs = 5000): Promise<PerformanceStats> {
    if (this.benchmarkSamples !== null) {
      return Promise.reject(new Error('Un benchmark est déjà en cours.'));
    }
    this.benchmarkSamples = [];
    return new Promise((resolve) => {
      this.benchmarkResolve = resolve;
      window.setTimeout(() => {
        const samples = this.benchmarkSamples ?? [];
        this.benchmarkSamples = null;
        const finish = this.benchmarkResolve;
        this.benchmarkResolve = null;
        finish?.(this.computeStats(samples, samples.length));
      }, durationMs);
    });
  }

  private computeStats(buffer: readonly number[], count: number): PerformanceStats {
    if (count === 0) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, count: 0 };
    const values = buffer.slice(0, count);
    values.sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += values[i] as number;
    }
    const max = values[count - 1] as number;
    const avg = sum / count;
    const p50 = values[Math.floor(count * 0.5)] as number;
    const p95 = values[Math.floor(count * 0.95)] as number;
    const p99 = values[Math.floor(count * 0.99)] as number;
    return { avg, p50, p95, p99, max, count };
  }
}
