import type { Socket } from "bun";
import type { StdioSink } from "../stdio.ts";
import { DockerError } from "./client.ts";

export type Frame = {
  stream: "stdin" | "stdout" | "stderr";
  payload: Uint8Array;
};

const STREAMS = ["stdin", "stdout", "stderr"] as const;

export class Demux {
  private pending = new Uint8Array(0);

  push(chunk: Uint8Array): Frame[] {
    const merged = new Uint8Array(this.pending.length + chunk.length);
    merged.set(this.pending, 0);
    merged.set(chunk, this.pending.length);
    this.pending = merged;

    const frames: Frame[] = [];
    let offset = 0;
    for (;;) {
      if (this.pending.length - offset < 8) break;
      const header = this.pending.subarray(offset, offset + 8);
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const size = view.getUint32(4);
      if (this.pending.length - offset - 8 < size) break;
      const payload = this.pending.slice(offset + 8, offset + 8 + size);
      offset += 8 + size;
      const stream = STREAMS[header[0] ?? 0];
      if (stream && size > 0) frames.push({ stream, payload });
    }
    if (offset > 0) this.pending = this.pending.slice(offset);
    return frames;
  }
}

export type Attachment = {
  stdin: StdioSink;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  close(): void;
};

function splitHead(buffer: Uint8Array): { status: number; rest: Uint8Array } | null {
  const text = new TextDecoder("latin1").decode(buffer);
  const index = text.indexOf("\r\n\r\n");
  if (index === -1) return null;
  const status = Number(text.split("\r\n")[0]?.split(" ")[1] ?? "0");
  return { status, rest: buffer.slice(index + 4) };
}

export async function attachContainer(socketPath: string, id: string): Promise<Attachment> {
  const demux = new Demux();
  const outbox: Uint8Array[] = [];

  let out!: ReadableStreamDefaultController<Uint8Array>;
  let err!: ReadableStreamDefaultController<Uint8Array>;
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      out = controller;
    }
  });
  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      err = controller;
    }
  });

  const state = {
    upgraded: false,
    finished: false,
    head: new Uint8Array(0),
    socket: null as Socket<undefined> | null
  };

  const finish = () => {
    if (state.finished) return;
    state.finished = true;
    try {
      out.close();
      err.close();
    } catch {
      return;
    }
  };

  const deliver = (frame: Frame) => {
    if (state.finished || frame.stream === "stdin") return;
    try {
      (frame.stream === "stdout" ? out : err).enqueue(frame.payload);
    } catch {
      return;
    }
  };

  const pump = () => {
    const socket = state.socket;
    if (!socket) return;
    while (outbox.length > 0) {
      const chunk = outbox[0] as Uint8Array;
      const written = socket.write(chunk);
      if (written < chunk.length) {
        outbox[0] = chunk.subarray(written);
        return;
      }
      outbox.shift();
    }
  };

  const settled = Promise.withResolvers<void>();

  const connection = await Bun.connect<undefined>({
    unix: socketPath,
    socket: {
      open(socket) {
        socket.write(
          `POST /containers/${id}/attach?stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.1\r\n` +
            "Host: docker\r\n" +
            "Connection: Upgrade\r\n" +
            "Upgrade: tcp\r\n" +
            "Content-Length: 0\r\n\r\n"
        );
      },
      data(socket, chunk) {
        if (state.upgraded) {
          for (const frame of demux.push(chunk)) deliver(frame);
          return;
        }
        const merged = new Uint8Array(state.head.length + chunk.length);
        merged.set(state.head, 0);
        merged.set(chunk, state.head.length);
        state.head = merged;
        const split = splitHead(state.head);
        if (!split) return;
        if (split.status !== 101 && split.status !== 200) {
          settled.reject(new DockerError(`the daemon refused the attach with ${split.status}`, split.status));
          socket.end();
          return;
        }
        state.upgraded = true;
        state.head = new Uint8Array(0);
        state.socket = socket;
        settled.resolve();
        pump();
        for (const frame of demux.push(split.rest)) deliver(frame);
      },
      drain() {
        pump();
      },
      close() {
        finish();
        if (!state.upgraded) settled.reject(new DockerError("the daemon closed the attach stream", null));
      },
      error(_socket, error) {
        finish();
        if (!state.upgraded) settled.reject(error);
      }
    }
  });

  try {
    await settled.promise;
  } catch (error) {
    connection.end();
    throw error;
  }

  const stdin: StdioSink = {
    write(chunk) {
      outbox.push(chunk);
      pump();
      return chunk.length;
    },
    flush() {
      pump();
      return 0;
    }
  };

  return {
    stdin,
    stdout,
    stderr,
    close() {
      finish();
      connection.end();
    }
  };
}
