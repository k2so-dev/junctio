import { parseJSONRPCMessage, serializeMessage, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/client";

export type StdioSink = {
  write(chunk: Uint8Array): number | Promise<number>;
  flush(): number | Promise<number>;
};

export type StdioProcess = {
  stdin: StdioSink | null;
  stdout: ReadableStream<Uint8Array>;
  onUnparsed?: (line: string) => void;
};

export class ChildProcessTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly decoder = new TextDecoder();
  private pending = "";
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
        if (value) this.pending += this.decoder.decode(value, { stream: true });
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
      const index = this.pending.indexOf("\n");
      if (index === -1) return;
      const line = this.pending.slice(0, index).replace(/\r$/, "");
      this.pending = this.pending.slice(index + 1);
      if (line.trim() === "") continue;
      let message: JSONRPCMessage;
      try {
        message = parseJSONRPCMessage(JSON.parse(line));
      } catch (error) {
        this.proc.onUnparsed?.(line);
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      this.onmessage?.(message);
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pending.trim() !== "") this.proc.onUnparsed?.(this.pending.trim());
    this.pending = "";
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
