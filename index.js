import z from '@deepseek-ai/schemastery';
import { LspServerEntry, resolveServers } from './lib/servers.js';
import { resolveRoot } from './lib/executor.js';
import { LspSession } from './lib/runner.js';
import { createTools } from './lib/tools.js';

export const name = 'dsh-lsp';

/**
 * Declared here, never in cordis.patch.yml: the bundle patch must stay plain
 * `insert`/`id`/`name` rows or the market cannot hot-mount this plugin.
 *
 * No `systemPrompt` and no `fs` event subscription: this plugin exposes tools
 * only. Diagnostics are pulled when a tool asks for them, not injected into the
 * prompt after every edit, which keeps the fixed context cost at the tool
 * schemas alone.
 */
export const inject = ['tools', 'fs', 'subprocess'];

/**
 * Every key carries a default, so an empty config row is a valid composition.
 *
 * `servers` is empty on purpose: empty means "use the built-in catalog", which is
 * the point of this plugin. A non-empty table REPLACES the catalog.
 */
export const Config = z.object({
  /** Explicit server table; empty keeps the built-in catalog. */
  servers: z.dict(LspServerEntry).default({}),
  /** Cap on diagnostics returned per call. */
  maxDiagnostics: z.number().default(200),
  /** Cap on symbols returned per call. */
  maxSymbols: z.number().default(100),
  /** Cap on code actions returned per call. */
  maxCodeActions: z.number().default(50),
  /** Cap on rendered characters per result. */
  maxResultChars: z.number().default(16000),
  /** Cap on diff lines rendered for a write. */
  maxDiffLines: z.number().default(60),
  /** Largest document the client will open into a server. */
  maxDocumentBytes: z.number().default(8 * 1024 * 1024),
  /** Per-request timeout. */
  timeoutMs: z.number().default(60000),
});

/**
 * Mount the LSP tool surface.
 *
 * Server resolution happens here, before any tool publishes, so a broken explicit
 * entry fails the mount instead of the model's first call. Catalog entries that
 * are missing from PATH are skipped and carried into the tool context, where a
 * route miss explains them.
 */
export async function apply(ctx, config = {}) {
  const resolved = { ...Config({}), ...config };

  const { servers, skipped } = await resolveServers(ctx, resolved.servers);

  /** Live sessions, keyed by server id. Shared by every tool and every call. */
  const sessions = new Map();

  /**
   * Resolve the workspace root for one call.
   *
   * The session's own validated `cwd` is authoritative, read from the calling
   * agent rather than from the process: the plugin lives in a shared profile, so
   * the process directory is not the caller's workspace. The process cwd is only
   * a fallback for a call with no agent behind it.
   */
  const rootCache = new Map();
  const rootFor = async (exec, signal) => {
    const cwd = exec?.agent?.session?.header?.cwd;
    const key = typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd();
    let root = rootCache.get(key);
    if (root === undefined) {
      root = await resolveRoot(ctx.fs, key, signal);
      rootCache.set(key, root);
    }
    return root;
  };

  /** Get (or lazily start) the session for one configured entry. */
  const sessionFor = async (server, root, signal) => {
    let session = sessions.get(server.serverId);
    if (session === undefined) {
      session = new LspSession(
        {
          serverId: server.serverId,
          command: server.executable,
          args: server.entry.args,
          cwd: root.path,
          env: server.entry.env,
          initializationOptions: server.entry.initializationOptions,
          // Answer to `workspace/configuration`: without it every server is told
          // "no settings", silently discarding the entry's tuning.
          configuration: server.entry.configuration,
          maxMessageBytes: server.entry.maxMessageBytes,
          maxStderrBytes: server.entry.maxStderrBytes,
          killGraceMs: server.entry.killGraceMs,
          shutdownTimeoutMs: server.entry.shutdownTimeoutMs,
        },
        (spec) => ctx.subprocess.spawn(spec),
        root.uri,
        resolved.timeoutMs,
      );
      sessions.set(server.serverId, session);
    }
    await session.start(signal);
    return session;
  };

  const toolCtx = {
    fs: ctx.fs,
    servers,
    // Catalog entries that could not run; a route miss reports them so the model
    // learns "no server for this file" plus the reason, instead of a bare refusal.
    skipped,
    sessions,
    rootFor,
    sessionFor,
    // `FormattingOptions` sent with every formatting request. `tabSize` is a
    // protocol-required field; a server that reads the project's own config
    // overrides it, and one that does not still gets a sane value.
    formattingOptions: { tabSize: 2, insertSpaces: true },
    maxDocumentBytes: resolved.maxDocumentBytes,
    limits: {
      maxDiagnostics: resolved.maxDiagnostics,
      maxSymbols: resolved.maxSymbols,
      maxCodeActions: resolved.maxCodeActions,
      maxResultChars: resolved.maxResultChars,
      maxDiffLines: resolved.maxDiffLines,
    },
  };

  for (const tool of createTools(toolCtx)) ctx.tools.register(tool);

  // Disposal must reclaim every child process: a hot-unmount that leaked
  // language servers would leave them indexing forever.
  ctx.effect(() => () => {
    const closing = [...sessions.values()];
    sessions.clear();
    return Promise.all(closing.map((session) => session.dispose().catch(() => {})));
  }, 'dsh-lsp session teardown');
}
