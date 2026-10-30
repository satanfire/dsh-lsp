/**
 * Language-server entries: their schema, their load-time resolution, and the
 * routing that decides which entry serves a file.
 *
 * Three things are deliberate here:
 *
 *  - The built-in catalog is the default, so a fresh install needs no config.
 *  - Every executable is resolved BEFORE any tool publishes; a catalog entry
 *    that cannot run is skipped, while an explicitly configured one throws.
 *  - A malformed glob throws at load, not at routing time, so a config typo
 *    surfaces while the user is looking at the config.
 *
 * @module dsh-lsp/servers
 */
import z from '@deepseek-ai/schemastery';
import { BUILTIN_SERVERS, languageIdFor } from './catalog.js';
import { DEFAULTS, LSP_ERROR, lspError } from './vocabulary.js';

/**
 * One language server entry.
 *
 * Every optional field has a default so a minimal entry is `command` +
 * `extensionToLanguage`. The tuning fields exist for servers with unusual
 * startup or diagnostic timing; they are not needed for common cases.
 */
export const LspServerEntry = z.object({
  /** Executable name or path, resolved through the subprocess seam at load. */
  command: z.string().required(),
  /** Extension (with leading dot, e.g. `.ts`) to LSP language id. */
  extensionToLanguage: z.dict(String).required(),
  /** Path globs that claim a file before any other rule. */
  fileGlobs: z.array(String).default([]),
  /** Project config file names; the nearest ancestor holding one claims the file. */
  projectMarkers: z.array(String).default([]),
  /** Arguments passed to `command`. */
  args: z.array(String).default([]),
  /** Extra environment entries merged onto the scrubbed parent environment. */
  env: z.dict(String).default({}),
  /** `initializationOptions` sent with `initialize`. */
  initializationOptions: z.any().default(null),
  /** Answer to `workspace/configuration`, shared by every section the server asks for. */
  configuration: z.any().default(null),
  /** `FormattingOptions` override; the plugin's defaults apply when unset. */
  formattingOptions: z.any().default(null),
  /** Largest single framed message accepted from this server. */
  maxMessageBytes: z.number().default(DEFAULTS.MAX_MESSAGE_BYTES),
  /** Retained stderr tail, surfaced when the server fails. */
  maxStderrBytes: z.number().default(DEFAULTS.MAX_STDERR_BYTES),
  /** Grace period the subprocess provider gets when terminating this server. */
  killGraceMs: z.number().default(DEFAULTS.KILL_GRACE_MS),
  /** How long `shutdown` may take before force-termination. */
  shutdownTimeoutMs: z.number().default(DEFAULTS.SHUTDOWN_TIMEOUT_MS),
});

/** Top-level plugin configuration. */
export const Config = z.object({
  /** Server entries keyed by a user-chosen id. Empty by default: the plugin is inert until configured. */
  servers: z.dict(LspServerEntry).default({}),
  /** Cap on diagnostics returned per call. */
  maxDiagnostics: z.number().default(200),
  /** Cap on symbols returned per call. */
  maxSymbols: z.number().default(100),
  /** Cap on code actions returned per call. */
  maxCodeActions: z.number().default(50),
  /** Cap on rendered characters per call. */
  maxResultChars: z.number().default(16000),
  /** Largest document the client will open into a server. */
  maxDocumentBytes: z.number().default(8 * 1024 * 1024),
  /** Per-request timeout. */
  timeoutMs: z.number().default(60000),
});

/** Convert an unknown throwable to an Error. */
function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Build a server entry from one catalog row.
 *
 * The catalog stores extensions as a list and language ids in a shared map;
 * routing consumes the `extensionToLanguage` shape, so the mapping is derived
 * here once instead of at every call.
 *
 * @param server - one `BUILTIN_SERVERS` row.
 * @returns the normalized entry the rest of the plugin routes against.
 */
export function entryFromCatalog(server) {
  const extensionToLanguage = {};
  for (const extension of server.extensions) {
    extensionToLanguage[extension] = languageIdFor(extension);
  }
  const [command, ...args] = server.command;
  return normalizeEntry({ command, args, extensionToLanguage });
}

/**
 * Resolve the server table for one mount.
 *
 * Two sources, in priority order:
 *
 *  1. `config.servers` — an explicit table that REPLACES the built-in catalog.
 *     It does not merge, matching pi-lsp: a user who lists one server must not
 *     silently keep seventeen defaults they meant to drop.
 *  2. the built-in catalog — the zero-config default.
 *
 * The failure policy is the difference that makes "install and it works" true:
 * a catalog entry whose executable is missing is SKIPPED and reported, so an
 * absent `rust-analyzer` never blocks TypeScript diagnostics. An explicitly
 * configured entry is an error instead, because the user named it.
 *
 * @param ctx - the plugin context; uses `subprocess.resolveExecutable`.
 * @param servers - the explicit server table, empty when the catalog should apply.
 * @param signal - optional load cancellation.
 * @returns `{ servers, skipped }`: the resolved entries in routing order, and the
 *   catalog entries that could not run.
 * @throws when an explicit id is empty, a field is invalid, a glob is malformed,
 *   or an explicitly configured command cannot be resolved.
 */
export async function resolveServers(ctx, servers, signal) {
  const configured = servers != null && Object.keys(servers).length > 0;
  const candidates = configured
    ? Object.entries(servers).map(([serverId, entry]) => ({ serverId, entry, explicit: true }))
    : BUILTIN_SERVERS.map((server) => ({
        serverId: server.name,
        entry: entryFromCatalog(server),
        explicit: false,
      }));

  const resolved = [];
  const skipped = [];
  for (const { serverId, entry, explicit } of candidates) {
    if (serverId.trim() === '') throw new Error('dsh-lsp: server ids must be non-empty strings');
    // A raw config handed straight to `apply` (tests, programmatic mounting) may
    // omit a field the schema would have defaulted; fill every default here so
    // validation judges the entry the server will actually run with, not the
    // partial object the caller happened to pass.
    const resolvedEntry = normalizeEntry(entry);
    validateServerEntry(serverId, resolvedEntry);
    for (const glob of resolvedEntry.fileGlobs) {
      globToRegExp(glob); // throws on a malformed pattern at load, not at routing time
    }
    let executable;
    try {
      executable = await ctx.subprocess.resolveExecutable(resolvedEntry.command, resolvedEntry.env, signal);
    } catch (error) {
      const reason = asError(error).message;
      if (explicit) {
        throw lspError(
          LSP_ERROR.COMMAND_NOT_FOUND,
          `dsh-lsp: cannot resolve command "${resolvedEntry.command}" for server "${serverId}": ${reason}`,
        );
      }
      skipped.push({ serverId, command: resolvedEntry.command, reason });
      continue;
    }
    resolved.push({ serverId, entry: resolvedEntry, executable, explicit });
  }
  return { servers: resolved, skipped };
}

/**
 * Fill the schema's defaults into a raw entry.
 *
 * `LspServerEntry` normally does this, but `resolveServers` is also reachable
 * with a bare object (tests, programmatic mounting), where an absent numeric
 * limit would otherwise fail validation for a reason the caller cannot see.
 *
 * @param entry - the raw entry.
 * @returns a copy with defaults applied.
 */
export function normalizeEntry(entry) {
  return {
    args: [],
    fileGlobs: [],
    projectMarkers: [],
    env: {},
    initializationOptions: null,
    configuration: null,
    formattingOptions: null,
    maxMessageBytes: DEFAULTS.MAX_MESSAGE_BYTES,
    maxStderrBytes: DEFAULTS.MAX_STDERR_BYTES,
    killGraceMs: DEFAULTS.KILL_GRACE_MS,
    shutdownTimeoutMs: DEFAULTS.SHUTDOWN_TIMEOUT_MS,
    ...entry,
  };
}

/**
 * Validate one entry's shape beyond what the schema enforces.
 *
 * @param serverId - the entry's key, for error messages.
 * @param entry - the normalized entry.
 * @throws when a required mapping is missing or a limit is not a positive integer.
 */
export function validateServerEntry(serverId, entry) {
  if (typeof entry.command !== 'string' || entry.command.trim() === '') {
    throw new Error(`dsh-lsp: server "${serverId}" needs a non-empty command`);
  }
  const mappings = Object.entries(entry.extensionToLanguage ?? {});
  if (mappings.length === 0) {
    throw new Error(`dsh-lsp: server "${serverId}" maps no extensions`);
  }
  for (const [extension, languageId] of mappings) {
    if (!extension.startsWith('.')) {
      throw new Error(`dsh-lsp: server "${serverId}" extension "${extension}" must start with "."`);
    }
    if (typeof languageId !== 'string' || languageId.trim() === '') {
      throw new Error(`dsh-lsp: server "${serverId}" maps "${extension}" to an empty language id`);
    }
  }
  for (const key of ['maxMessageBytes', 'maxStderrBytes', 'killGraceMs', 'shutdownTimeoutMs']) {
    const value = entry[key];
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`dsh-lsp: server "${serverId}" needs a positive integer ${key}`);
    }
  }
}

/**
 * Route one file to a server entry.
 *
 * Three passes, each in configuration order:
 *
 *  1. entries with a matching `fileGlobs` pattern;
 *  2. the entry claimed by the file's nearest project marker;
 *  3. entries whose `extensionToLanguage` maps the file's extension.
 *
 * A project marker never widens a server's file types — it only decides among
 * entries that already map the file's extension. That is what keeps a
 * `deno.json` project from being served by a TypeScript server that never
 * claimed `.ts` in the first place.
 *
 * @param servers - the resolved servers.
 * @param filePath - the source file path (absolute or workspace-relative).
 * @param projectMarker - the nearest configured marker governing `filePath`, when any.
 * @returns the route, or `undefined` when no entry handles the file.
 */
export function routeFile(servers, filePath, projectMarker) {
  const normalized = filePath.replaceAll('\\', '/');
  const extension = finalExtension(filePath);

  // Pass 1: explicit globs win outright.
  for (const server of servers) {
    for (const glob of server.entry.fileGlobs) {
      if (globToRegExp(glob).test(normalized)) {
        // A glob may select a file whose extension this entry does not map; the
        // entry's first mapping is then the only language id available.
        const languageId = server.entry.extensionToLanguage[extension] ?? firstLanguageId(server);
        return { server, languageId };
      }
    }
  }

  // Pass 2: the nearest project marker, among entries that already map this extension.
  if (projectMarker !== undefined) {
    for (const server of servers) {
      if (!server.entry.projectMarkers.includes(projectMarker)) continue;
      const languageId = server.entry.extensionToLanguage[extension];
      if (languageId !== undefined) return { server, languageId };
    }
  }

  // Pass 3: the extension default.
  for (const server of servers) {
    const languageId = server.entry.extensionToLanguage[extension];
    if (languageId !== undefined) return { server, languageId };
  }
  return undefined;
}

/** The first extension mapping's language id, used when a glob wins without an extension hit. */
export function firstLanguageId(server) {
  const languageId = Object.values(server.entry.extensionToLanguage)[0];
  if (languageId === undefined) {
    throw new Error(`dsh-lsp: server "${server.serverId}" maps no extensions`);
  }
  return languageId;
}

/**
 * The final path extension including its dot, lowercased for mapping lookup.
 *
 * A leading dot is part of the name for dotfiles (`.gitignore` has no
 * extension), and a trailing dot is not an extension either.
 *
 * @param filePath - the file path.
 * @returns the extension, or an empty string when there is none.
 */
export function finalExtension(filePath) {
  const base = filePath.replaceAll('\\', '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot).toLowerCase();
}

/**
 * Compile a path glob (`*` / `**` / `?`) to an anchored regular expression.
 *
 * `*` and `?` do not cross separators; `**` does, and `**​/` also matches zero
 * directories. Matching runs against `/`-normalized paths.
 *
 * @param pattern - the glob pattern.
 * @returns the compiled, anchored expression.
 * @throws when the pattern is empty or contains unbalanced brackets.
 */
export function globToRegExp(pattern) {
  if (pattern === '') throw new Error('dsh-lsp: fileGlob must not be empty');
  let source = '^';
  let i = 0;
  const push = (text) => {
    source += text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  };
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          source += '(?:[^/]+/)*';
          i += 3;
        } else {
          source += '.*';
          i += 2;
        }
        continue;
      }
      source += '[^/]*';
      i += 1;
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      i += 1;
      continue;
    }
    if (char === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close < 0) throw new Error(`dsh-lsp: unbalanced "[" in fileGlob "${pattern}"`);
      source += pattern.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    push(char);
    i += 1;
  }
  source += '$';
  return new RegExp(source, 'u');
}
