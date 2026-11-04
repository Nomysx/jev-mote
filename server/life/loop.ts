// Mote's heartbeat on the server. Once a minute, time passes for its body (energy, sleep, waking
// up), and while no page is watching it thinks now and then and dreams in its sleep. So it keeps
// living while the browser is closed, as long as the Mote server is running. When the computer
// sleeps or the server is stopped, the gap is simulated on the next beat (it slept, it woke up),
// but no thoughts are invented: those only ever come from the model.

export interface Living {
  live(): Promise<void>;
}

export class LifeLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private mote: Living,
    private log: (msg: string) => void = console.log,
    private intervalMs = 60_000,
  ) {}

  start(firstBeatMs = 5_000) {
    this.stop();
    const first = setTimeout(() => void this.beat(), firstBeatMs);
    first.unref();
    this.timer = setInterval(() => void this.beat(), this.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async beat() {
    if (this.running) return;
    this.running = true;
    try {
      await this.mote.live();
    } catch (err) {
      this.log(`[mote] life loop: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
