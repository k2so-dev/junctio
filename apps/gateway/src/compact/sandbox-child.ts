import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime
} from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import { PRELUDE, sourceCandidates } from "./prelude.ts";
import {
  CATALOG_ADVICE,
  type ChildMessage,
  type HostMessage,
  type RunMessage,
  type SandboxFailure
} from "./protocol.ts";

const LOADING_FACTOR = 4;
const INDEX_FACTOR = 1;

const deferred = new Map<number, QuickJSDeferredPromise>();
let runtime: QuickJSRuntime | null = null;
let context: QuickJSContext | null = null;
let nextCall = 0;
let started = false;
const idle = setTimeout(() => process.exit(1), 30_000);

function send(message: ChildMessage): void {
  process.send?.(message);
}

function finish(message: ChildMessage): void {
  send(message);
  setTimeout(() => process.exit(0), 50);
}

function pump(): void {
  const result = runtime?.executePendingJobs();
  if (result?.error) result.error.dispose();
}

function location(stack: unknown, offset: number): string | undefined {
  if (typeof stack !== "string") return undefined;
  const match = stack.match(/code\.js:(\d+):(\d+)/);
  if (!match) return undefined;
  const line = Number(match[1]) - offset;
  return line >= 1 ? `line ${line}, column ${match[2]}` : undefined;
}

function describeError(vm: QuickJSContext, handle: QuickJSHandle, offset = 0): SandboxFailure {
  const dumped: unknown = vm.dump(handle);
  if (typeof dumped === "object" && dumped !== null) {
    const record = dumped as { name?: unknown; message?: unknown; stack?: unknown };
    const name = typeof record.name === "string" ? record.name : "Error";
    const message = typeof record.message === "string" ? record.message : JSON.stringify(dumped);
    const where = location(record.stack, offset);
    return { name, message, ...(where ? { location: where } : {}) };
  }
  return { name: "Error", message: String(dumped) };
}

function memoryUsed(vm: QuickJSContext): number {
  const handle = vm.runtime.computeMemoryUsage();
  const usage = vm.dump(handle) as { memory_used_size?: unknown };
  handle.dispose();
  return typeof usage.memory_used_size === "number" ? usage.memory_used_size : 0;
}

function setString(vm: QuickJSContext, name: string, value: string): void {
  const handle = vm.newString(value);
  vm.setProp(vm.global, name, handle);
  handle.dispose();
}

function installHost(vm: QuickJSContext, run: RunMessage): void {
  const log = vm.newFunction("__log", (lineHandle) => {
    send({ type: "log", line: vm.getString(lineHandle) });
  });
  vm.setProp(vm.global, "__log", log);
  log.dispose();

  if (run.mode !== "execute") return;
  const call = vm.newFunction("__call", (nameHandle, inputHandle) => {
    const id = ++nextCall;
    const promise = vm.newPromise();
    deferred.set(id, promise);
    send({ type: "call", id, name: vm.getString(nameHandle), input: vm.getString(inputHandle) });
    return promise.handle;
  });
  vm.setProp(vm.global, "__call", call);
  call.dispose();
}

function settleCall(message: Extract<HostMessage, { type: "result" }>): void {
  const vm = context;
  const promise = deferred.get(message.id);
  if (!vm || !promise) return;
  deferred.delete(message.id);
  if (message.ok) {
    const value = vm.newString(message.value);
    promise.resolve(value);
    value.dispose();
  } else {
    const error = vm.newError({ name: message.name, message: message.error });
    promise.reject(error);
    error.dispose();
  }
  promise.dispose();
  pump();
}

function compile(vm: QuickJSContext, code: string): { source: string; offset: number } | { error: SandboxFailure } {
  let firstError: SandboxFailure | null = null;
  for (const { source, offset } of sourceCandidates(code)) {
    const compiled = vm.evalCode(source, "code.js", { compileOnly: true });
    if (!compiled.error) {
      compiled.value.dispose();
      return { source, offset };
    }
    const error = describeError(vm, compiled.error, offset);
    compiled.error.dispose();
    firstError ??= error;
  }
  return { error: firstError ?? { name: "SyntaxError", message: "empty code" } };
}

async function execute(run: RunMessage): Promise<void> {
  const module = await newQuickJSWASMModuleFromVariant(variant);
  runtime = module.newRuntime();
  runtime.setMemoryLimit(run.memoryBytes + run.catalog.length * LOADING_FACTOR);
  runtime.setMaxStackSize(run.stackBytes);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(run.deadline));
  const vm = runtime.newContext();
  context = vm;

  installHost(vm, run);
  setString(vm, "__catalog", run.catalog);
  setString(vm, "__limits", JSON.stringify({ logChars: run.logChars, logLines: run.logLines }));

  const prelude = vm.evalCode(PRELUDE, "prelude.js");
  if (prelude.error) {
    const failure = describeError(vm, prelude.error);
    if (failure.name === "InternalError" && failure.message === "interrupted") {
      finish({ type: "done", ok: false, error: failure });
      return;
    }
    finish({
      type: "done",
      ok: false,
      catalog: true,
      error: {
        name: "CatalogError",
        message: `the catalog of this endpoint could not be loaded into the sandbox (${failure.message}): ${CATALOG_ADVICE}`
      }
    });
    return;
  }
  prelude.value.dispose();
  runtime.setMemoryLimit(memoryUsed(vm) + run.memoryBytes + run.catalog.length * INDEX_FACTOR);

  const compiled = compile(vm, run.code);
  if ("error" in compiled) {
    finish({ type: "done", ok: false, error: compiled.error });
    return;
  }

  const evaluated = vm.evalCode(compiled.source, "code.js");
  if (evaluated.error) {
    finish({ type: "done", ok: false, error: describeError(vm, evaluated.error, compiled.offset) });
    return;
  }
  const settled = vm.resolvePromise(evaluated.value);
  evaluated.value.dispose();
  pump();
  const outcome = await settled;
  if (outcome.error) {
    finish({ type: "done", ok: false, error: describeError(vm, outcome.error, compiled.offset) });
    return;
  }
  const serialize = vm.getProp(vm.global, "__serialize");
  const serialized = vm.callFunction(serialize, vm.undefined, outcome.value);
  serialize.dispose();
  outcome.value.dispose();
  if (serialized.error) {
    finish({ type: "done", ok: false, error: describeError(vm, serialized.error) });
    return;
  }
  const value = vm.getString(serialized.value);
  serialized.value.dispose();
  finish({ type: "done", ok: true, value });
}

process.on("message", (message: HostMessage) => {
  if (message.type === "result") {
    settleCall(message);
    return;
  }
  if (message.type !== "run" || started) return;
  started = true;
  clearTimeout(idle);
  setTimeout(() => process.exit(1), Math.max(0, message.deadline - Date.now()) + 2_000).unref();
  execute(message).catch((error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    finish({ type: "done", ok: false, error: { name: "InternalError", message: text } });
  });
});

process.on("disconnect", () => process.exit(1));

send({ type: "ready" });
