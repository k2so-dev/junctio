import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export type MockSseMcpOptions = {
  name?: string;
  token?: string | null;
};

export type MockSseMcp = {
  url: string;
  counts: { streams: number; posts: number; unauthorized: number; toolCalls: number };
  seenTokens: string[];
  dropStreams(): void;
  stop(): Promise<void>;
};

type Session = {
  transport: StreamTransport;
  server: Server;
};

class StreamTransport implements Transport {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly encoder = new TextEncoder();
  private closed = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  readonly stream: ReadableStream<Uint8Array>;

  constructor(private readonly endpoint: string) {
    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        this.write("endpoint", this.endpoint);
      },
      cancel: () => {
        this.controller = null;
        void this.close();
      }
    });
  }

  private write(event: string, data: string): void {
    if (!this.controller) return;
    try {
      this.controller.enqueue(this.encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
    } catch {
      this.controller = null;
    }
  }

  deliver(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.write("message", JSON.stringify(message));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller?.close();
    } catch {
      /* already closed by the client */
    }
    this.controller = null;
    this.onclose?.();
  }
}

export async function startMockSseMcp(options: MockSseMcpOptions = {}): Promise<MockSseMcp> {
  const name = options.name ?? "legacy";
  const token = options.token ?? null;
  const counts = { streams: 0, posts: 0, unauthorized: 0, toolCalls: 0 };
  const seenTokens: string[] = [];
  const sessions = new Map<string, Session>();

  function buildServer(): Server {
    const server = new Server({ name, version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "ping",
          description: "Returns pong",
          inputSchema: { type: "object", properties: {}, additionalProperties: false }
        }
      ]
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => {
      counts.toolCalls += 1;
      return { content: [{ type: "text", text: "pong" }] };
    });
    return server;
  }

  function authorized(request: Request): boolean {
    if (token === null) return true;
    const header = request.headers.get("authorization") ?? "";
    const seen = /^Bearer\s+(.+)$/i.exec(header)?.[1];
    if (seen) seenTokens.push(seen);
    if (seen === token) return true;
    counts.unauthorized += 1;
    return false;
  }

  const httpServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/sse") {
        if (!authorized(request)) return new Response("unauthorized", { status: 401 });
        counts.streams += 1;
        const sessionId = crypto.randomUUID();
        const transport = new StreamTransport(`/messages?sessionId=${sessionId}`);
        const server = buildServer();
        sessions.set(sessionId, { transport, server });
        transport.onclose = () => sessions.delete(sessionId);
        await server.connect(transport);
        return new Response(transport.stream, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" }
        });
      }

      if (url.pathname === "/messages" && request.method === "POST") {
        if (!authorized(request)) return new Response("unauthorized", { status: 401 });
        counts.posts += 1;
        const session = sessions.get(url.searchParams.get("sessionId") ?? "");
        if (!session) return new Response("unknown session", { status: 404 });
        const body = (await request.json()) as JSONRPCMessage;
        session.transport.deliver(body);
        return new Response("accepted", { status: 202 });
      }

      return new Response("not found", { status: 404 });
    }
  });

  const selfUrl = `http://127.0.0.1:${httpServer.port}`;

  return {
    url: `${selfUrl}/sse`,
    counts,
    seenTokens,
    dropStreams() {
      for (const session of [...sessions.values()]) {
        void session.transport.close();
        void session.server.close();
      }
      sessions.clear();
    },
    async stop() {
      for (const session of [...sessions.values()]) {
        void session.transport.close();
        void session.server.close();
      }
      sessions.clear();
      await httpServer.stop(true);
    }
  };
}
