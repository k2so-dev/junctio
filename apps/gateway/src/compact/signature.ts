type JsonObject = Record<string, unknown>;

type Context = {
  root: JsonObject;
  seen: Set<unknown>;
  depth: number;
};

const MAX_DEPTH = 8;
const MAX_ENUM = 40;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const CONSTRAINT_KEYS: [string, string][] = [
  ["format", "format"],
  ["pattern", "pattern"],
  ["minimum", "min"],
  ["maximum", "max"],
  ["exclusiveMinimum", "greater than"],
  ["exclusiveMaximum", "less than"],
  ["minLength", "min length"],
  ["maxLength", "max length"],
  ["minItems", "min items"],
  ["maxItems", "max items"]
];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function propertyKey(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

export function memberAccess(name: string): string {
  return IDENTIFIER.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function commentSafe(text: string): string {
  return text.replaceAll("*/", "*\\/");
}

export function docComment(lines: string[], indent: string): string {
  const body = lines.map((line) => commentSafe(line)).filter((line) => line !== "");
  if (body.length === 0) return "";
  if (body.length === 1) return `${indent}/** ${body[0]} */\n`;
  return `${indent}/**\n${body.map((line) => `${indent} * ${line}`).join("\n")}\n${indent} */\n`;
}

function literal(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "unknown";
}

function resolveRef(ref: string, root: JsonObject): unknown {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const segment = decodeURIComponent(raw).replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function propertyNotes(schema: JsonObject): string[] {
  const notes: string[] = [];
  if (typeof schema.description === "string" && schema.description.trim() !== "") {
    notes.push(singleLine(schema.description));
  } else if (typeof schema.title === "string" && schema.title.trim() !== "") {
    notes.push(singleLine(schema.title));
  }
  const constraints = CONSTRAINT_KEYS.filter(([key]) => schema[key] !== undefined).map(
    ([key, label]) => `${label} ${typeof schema[key] === "string" ? schema[key] : JSON.stringify(schema[key])}`
  );
  if (constraints.length > 0) notes.push(constraints.join(", "));
  if (schema.default !== undefined) {
    const shown = JSON.stringify(schema.default);
    if (shown !== undefined && shown.length <= 80) notes.push(`@default ${shown}`);
  }
  if (schema.deprecated === true) notes.push("@deprecated");
  return notes;
}

function union(members: string[]): string {
  const unique = [...new Set(members)];
  if (unique.length === 0) return "never";
  if (unique.includes("unknown")) return "unknown";
  return unique.join(" | ");
}

function wrapUnion(type: string): string {
  return type.includes(" | ") && !type.startsWith("{") ? `(${type})` : type;
}

function objectType(schema: JsonObject, ctx: Context, indent: string): string {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((v) => typeof v === "string") : []);
  const inner = `${indent}  `;
  const lines: string[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    const resolved = isObject(raw) && typeof raw.$ref === "string" ? resolveRef(raw.$ref, ctx.root) : raw;
    const notes = isObject(raw) ? propertyNotes(raw) : [];
    if (notes.length === 0 && isObject(resolved)) notes.push(...propertyNotes(resolved));
    const optional = required.has(name) ? "" : "?";
    lines.push(`${docComment(notes, inner)}${inner}${propertyKey(name)}${optional}: ${typeOf(raw, ctx, inner)};`);
  }
  const additional = schema.additionalProperties;
  if (additional !== undefined && additional !== false) {
    const valueType = additional === true || !isObject(additional) ? "unknown" : typeOf(additional, ctx, inner);
    lines.push(`${inner}[key: string]: ${valueType};`);
  } else if (lines.length === 0 && additional === undefined && !isObject(schema.properties)) {
    return "Record<string, unknown>";
  }
  if (lines.length === 0) return "{}";
  return `{\n${lines.join("\n")}\n${indent}}`;
}

function arrayType(schema: JsonObject, ctx: Context, indent: string): string {
  if (Array.isArray(schema.prefixItems)) {
    const members = schema.prefixItems.map((item) => typeOf(item, ctx, indent));
    return `[${members.join(", ")}]`;
  }
  if (Array.isArray(schema.items)) {
    const members = schema.items.map((item) => typeOf(item, ctx, indent));
    return `[${members.join(", ")}]`;
  }
  if (schema.items === undefined || schema.items === true) return "unknown[]";
  return `${wrapUnion(typeOf(schema.items, ctx, indent))}[]`;
}

function namedType(type: string, schema: JsonObject, ctx: Context, indent: string): string {
  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return arrayType(schema, ctx, indent);
    case "object":
      return objectType(schema, ctx, indent);
    default:
      return "unknown";
  }
}

export function typeOf(schema: unknown, ctx: Context, indent = ""): string {
  if (schema === true || schema === undefined) return "unknown";
  if (schema === false) return "never";
  if (!isObject(schema)) return "unknown";
  if (ctx.depth >= MAX_DEPTH || ctx.seen.has(schema)) return "unknown";

  if (typeof schema.$ref === "string") {
    const target = resolveRef(schema.$ref, ctx.root);
    if (target === undefined) return "unknown";
    ctx.seen.add(schema);
    try {
      return typeOf(target, { ...ctx, depth: ctx.depth + 1 }, indent);
    } finally {
      ctx.seen.delete(schema);
    }
  }

  ctx.seen.add(schema);
  const next: Context = { ...ctx, depth: ctx.depth + 1 };
  try {
    const nullable = schema.nullable === true ? " | null" : "";
    if (schema.const !== undefined) return literal(schema.const) + nullable;
    if (Array.isArray(schema.enum)) {
      if (schema.enum.length > MAX_ENUM) return union(schema.enum.map((v) => typeof v)) + nullable;
      return union(schema.enum.map(literal)) + nullable;
    }
    for (const key of ["anyOf", "oneOf"] as const) {
      const options = schema[key];
      if (Array.isArray(options)) return union(options.map((option) => typeOf(option, next, indent))) + nullable;
    }
    if (Array.isArray(schema.allOf)) {
      const parts = schema.allOf.map((part) => wrapUnion(typeOf(part, next, indent)));
      const known = parts.filter((part) => part !== "unknown");
      return (known.length === 0 ? "unknown" : known.join(" & ")) + nullable;
    }
    if (Array.isArray(schema.type)) {
      return union(schema.type.map((t) => (typeof t === "string" ? namedType(t, schema, next, indent) : "unknown")));
    }
    if (typeof schema.type === "string") return namedType(schema.type, schema, next, indent) + nullable;
    if (isObject(schema.properties)) return objectType(schema, next, indent) + nullable;
    if (schema.items !== undefined || schema.prefixItems !== undefined)
      return arrayType(schema, next, indent) + nullable;
    return "unknown";
  } finally {
    ctx.seen.delete(schema);
  }
}

export function schemaType(schema: unknown, indent = ""): string {
  const root = isObject(schema) ? schema : {};
  return typeOf(schema, { root, seen: new Set(), depth: 0 }, indent);
}

export type SignatureInput = {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?:
    | {
        readOnlyHint?: boolean | undefined;
        destructiveHint?: boolean | undefined;
        idempotentHint?: boolean | undefined;
        openWorldHint?: boolean | undefined;
      }
    | undefined;
};

function hasRequired(schema: unknown): boolean {
  if (!isObject(schema)) return false;
  return Array.isArray(schema.required) && schema.required.length > 0;
}

function behaviour(annotations: SignatureInput["annotations"]): string | null {
  if (!annotations) return null;
  if (annotations.readOnlyHint === true) return "Read-only.";
  const parts: string[] = [];
  if (annotations.destructiveHint === true) parts.push("Destructive.");
  if (annotations.destructiveHint === false) parts.push("Not destructive.");
  if (annotations.idempotentHint === true) parts.push("Idempotent.");
  return parts.length > 0 ? parts.join(" ") : null;
}

export function toolSignature(tool: SignatureInput): string {
  const lines: string[] = [];
  const description = tool.description?.trim() ?? "";
  const title = tool.title?.trim() ?? "";
  if (title !== "" && !description.toLowerCase().startsWith(title.toLowerCase())) lines.push(`${title}.`);
  if (description !== "") lines.push(...description.split(/\r?\n/).map((line) => line.trimEnd()));
  const hint = behaviour(tool.annotations);
  if (hint) lines.push(hint);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const input = schemaType(tool.inputSchema ?? { type: "object" });
  const parameter = hasRequired(tool.inputSchema) ? "input" : "input?";
  const output = tool.outputSchema === undefined ? "unknown" : schemaType(tool.outputSchema);
  return `${docComment(lines, "")}${propertyKey(tool.name)}(${parameter}: ${input}): Promise<${output}>;`;
}
