import { spawn, type ChildProcess } from 'node:child_process';

export type LineHandler = (line: string) => void;

/**
 * One owner of one `arduino-cli monitor` child. A second process on the same
 * port gets "Serial port busy".
 */
export class ConsoleSession {
  private child: ChildProcess | null = null;
  private buffer = '';
  private handlers = new Set<LineHandler>();
  private waiters: { test: (line: string) => unknown; resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  connected = false;
  port: string | null = null;

  onLine(fn: LineHandler): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  send(cmd: string): boolean {
    if (!this.child || !this.connected) return false;
    try {
      this.child.stdin?.write(cmd + '\n');
      return true;
    } catch {
      return false;
    }
  }

  waitFor<T>(test: (line: string) => T | undefined, ms: number): Promise<T | null> {
    return new Promise((resolve) => {
      const w = {
        test: test as (line: string) => unknown,
        resolve: resolve as (v: unknown) => void,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((x) => x !== w);
          resolve(null);
        }, ms),
      };
      this.waiters.push(w);
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    for (const h of this.handlers) h(trimmed);
    for (const w of [...this.waiters]) {
      const v = w.test(trimmed);
      if (v !== undefined) {
        clearTimeout(w.timer);
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve(v);
      }
    }
  }

  async open(port: string): Promise<boolean> {
    await this.close();
    this.port = port;
    this.buffer = '';
    const c = spawn('arduino-cli', ['monitor', '-p', port, '--config', 'baudrate=115200', '--quiet'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = c;
    c.stdout?.on('data', (d: Buffer) => {
      this.buffer += d.toString();
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        this.handleLine(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    c.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) console.error(`console ${port}:`, msg);
    });
    const dead = new Promise<boolean>((resolve) => {
      c.on('exit', () => {
        if (this.child === c) {
          this.connected = false;
          this.child = null;
        }
        resolve(false);
      });
    });
    this.connected = true;
    const ok = await Promise.race([
      new Promise<boolean>((r) => setTimeout(() => r(true), 400)),
      dead,
    ]);
    if (!ok) return false;
    return true;
  }

  async close(): Promise<void> {
    const c = this.child;
    this.child = null;
    this.connected = false;
    this.port = null;
    for (const w of this.waiters) clearTimeout(w.timer);
    this.waiters = [];
    if (!c) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* */ } resolve(); }, 1500);
      c.on('exit', () => { clearTimeout(t); resolve(); });
      try { c.kill('SIGTERM'); } catch { resolve(); }
    });
  }
}

/** Open a console briefly, collect text, send `s`, classify, RELEASE the port. Never sends `p`. */
export async function peekConsole(port: string, msOpen = 2500, msAfter = 2500): Promise<string> {
  const c = spawn('arduino-cli', ['monitor', '-p', port, '--config', 'baudrate=115200', '--quiet'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks: string[] = [];
  c.stdout?.on('data', (d: Buffer) => chunks.push(d.toString()));
  await new Promise((r) => setTimeout(r, msOpen));
  try { c.stdin?.write('s\n'); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, msAfter));
  try { c.kill(); } catch { /* */ }
  await new Promise((r) => setTimeout(r, 200));
  return chunks.join('');
}
