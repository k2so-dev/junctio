import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";

export type StdioSink = {
  write(chunk: Uint8Array): number | Promise<number>;
  flush(): number | Promise<number>;
};

export type StdioProcess = {
  stdin: StdioSink | null;
  stdout: ReadableStream<Uint8Array>;
};

export class ChildProcessTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly buffer = new ReadBuffer();
  private reading?: Promise<void>;
  private closed = false;

  constructor(private readonly proc: StdioProcess) {}

  async start(): Promise<void> {
    if (this.reading) return;
    this.reading = this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const reader = this.proc.stdout.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) this.buffer.append(Buffer.from(value));
        this.drain();
      }
    } catch (error) {
      if (!this.closed) this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      reader.releaseLock();
      this.handleClose();
    }
  }

  private drain(): void {
    for (;;) {
      let message: JSONRPCMessage | null;
      try {
        message = this.buffer.readMessage();
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      if (message === null) return;
      this.onmessage?.(message);
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer.clear();
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.proc.stdin;
    if (!stdin || this.closed) throw new Error("stdio transport is not writable");
    await stdin.write(new TextEncoder().encode(serializeMessage(message)));
    await stdin.flush();
  }

  async close(): Promise<void> {
    this.handleClose();
  }
}
