import type { LogLineDto } from "@junctio/schema";

export type LogStream = "stdout" | "stderr" | "system";

const MAX_LINES = 500;

export class LogRegistry {
  private readonly buffers = new Map<string, LogLineDto[]>();
  private readonly subscribers = new Map<string, Set<(line: LogLineDto) => void>>();

  append(serverId: string, stream: LogStream, line: string): void {
    const entry: LogLineDto = { ts: Date.now(), stream, line };
    let buffer = this.buffers.get(serverId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(serverId, buffer);
    }
    buffer.push(entry);
    if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
    const subs = this.subscribers.get(serverId);
    if (subs) for (const fn of subs) fn(entry);
  }

  tail(serverId: string, count = 200): LogLineDto[] {
    const buffer = this.buffers.get(serverId) ?? [];
    return buffer.slice(Math.max(0, buffer.length - count));
  }

  subscribe(serverId: string, fn: (line: LogLineDto) => void): () => void {
    let subs = this.subscribers.get(serverId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(serverId, subs);
    }
    subs.add(fn);
    return () => {
      subs.delete(fn);
      if (subs.size === 0) this.subscribers.delete(serverId);
    };
  }

  clear(serverId: string): void {
    this.buffers.delete(serverId);
  }
}
