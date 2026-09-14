import { VERSION } from "../config.ts";

const USAGE = `junctio ${VERSION}

Usage:
  junctio serve                 Start the gateway (default)
  junctio --version             Print the version
  junctio --help                Print this message

Environment:
  JUNCTIO_SECRET        Required. Encryption key for stored credentials.
  JUNCTIO_BASE_URL      Public base url. Required for any oauth flow.
  JUNCTIO_ADMIN_TOKEN   Optional bearer token for headless admin access.
  JUNCTIO_OAUTH_ISSUER  Optional issuer url for resource server mode.
  JUNCTIO_DATA_DIR      Directory for junctio.db. Defaults to /data.
  PORT, HOST, LOG_LEVEL  Listener and logging configuration.
`;

export async function runCli(argv: string[]): Promise<void> {
  const [command] = argv;

  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return;
  }

  if (command === undefined || command === "serve") {
    await import("../index.ts");
    return;
  }

  process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
  process.exit(1);
}

if (import.meta.main) await runCli(process.argv.slice(2));
