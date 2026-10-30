/**
 * Built-in language-server catalog.
 *
 * Adapted from @narumitw/pi-lsp (MIT) `src/adapters.ts`, which ships a
 * direct-command catalog so a fresh install works with no configuration.
 * This port keeps the catalog and drops pi-lsp's per-server settle knobs and
 * initialize options: `collectDiagnostics` in tools.js already waits on the push
 * channel, and the few servers that need custom initialize options expose them
 * through the `servers` config override.
 *
 * Every command is probed on PATH at mount time. An unavailable entry is skipped
 * with a reason instead of failing the plugin, which is what makes "install and
 * it works" possible on a machine with a partial toolchain.
 *
 * @module dsh-lsp/catalog
 */

/** Extension to LSP language id, shared by every catalog entry. */
export const LANGUAGE_IDS = {
  '.bash': 'shellscript',
  '.bib': 'bibtex',
  '.c': 'c',
  '.c++': 'cpp',
  '.cc': 'cpp',
  '.cjs': 'javascript',
  '.clj': 'clojure',
  '.cljc': 'clojure',
  '.cljs': 'clojure',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.csx': 'csharp',
  '.cts': 'typescript',
  '.cxx': 'cpp',
  '.dart': 'dart',
  '.edn': 'clojure',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.fs': 'fsharp',
  '.fsi': 'fsharp',
  '.fsscript': 'fsharp',
  '.fsx': 'fsharp',
  '.gemspec': 'ruby',
  '.go': 'go',
  '.gql': 'graphql',
  '.h': 'c',
  '.h++': 'cpp',
  '.hh': 'cpp',
  '.hpp': 'cpp',
  '.hs': 'haskell',
  '.hxx': 'cpp',
  '.jl': 'julia',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.jsonc': 'jsonc',
  '.ksh': 'shellscript',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.lhs': 'lhaskell',
  '.m': 'objective-c',
  '.mjs': 'javascript',
  '.ml': 'ocaml',
  '.mli': 'ocaml.interface',
  '.mm': 'objective-cpp',
  '.mts': 'typescript',
  '.nix': 'nix',
  '.php': 'php',
  '.py': 'python',
  '.pyi': 'python',
  '.rake': 'ruby',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.ru': 'ruby',
  '.sh': 'shellscript',
  '.swift': 'swift',
  '.tex': 'latex',
  '.tf': 'terraform',
  '.tfvars': 'terraform-vars',
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.typ': 'typst',
  '.typc': 'typst-code',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zig': 'zig',
  '.zon': 'zig',
  '.zsh': 'shellscript',
};

/**
 * One built-in server: its argv and the extensions it owns.
 *
 * Order is routing priority, because one file is served by one entry: the first
 * entry whose extensions match wins. Type-checking servers therefore come before
 * the lint/format ones.
 *
 * The four entries below are not in pi-lsp's catalog: it standardizes on `biome`
 * and `ty`/`ruff`, while a machine that installed editor extensions instead
 * carries `typescript-language-server`, `vtsls`, `pyright` or `pylsp`. Listing
 * both families keeps the plugin zero-config either way, because PATH probing
 * skips whichever family is absent.
 */
export const BUILTIN_SERVERS = [
  {
    name: 'typescript-language-server',
    command: ["typescript-language-server", "--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  },
  {
    name: 'vtsls',
    command: ["vtsls", "--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  },
  {
    name: 'pyright',
    command: ["pyright-langserver", "--stdio"],
    extensions: [".py", ".pyi"],
  },
  {
    name: 'pylsp',
    command: ["pylsp"],
    extensions: [".py", ".pyi"],
  },
  {
    name: 'biome',
    command: ["biome", "lsp-proxy"],
    extensions: [".astro", ".css", ".cts", ".cjs", ".graphql", ".gql", ".html", ".js", ".json", ".jsonc", ".jsx", ".mjs", ".mts", ".svelte", ".ts", ".tsx", ".vue"],
  },
  {
    name: 'ty',
    command: ["ty", "server"],
    extensions: [".py", ".pyi"],
  },
  {
    name: 'ruff',
    command: ["ruff", "server"],
    extensions: [".py", ".pyi"],
  },
  {
    name: 'rust-analyzer',
    command: ["rust-analyzer"],
    extensions: [".rs"],
  },
  {
    name: 'gopls',
    command: ["gopls"],
    extensions: [".go"],
  },
  {
    name: 'rubocop',
    command: ["rubocop", "--lsp"],
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
  },
  {
    name: 'elixir-ls',
    command: ["win32", "language_server.bat", "language_server.sh"],
    extensions: [".ex", ".exs"],
  },
  {
    name: 'zls',
    command: ["zls"],
    extensions: [".zig", ".zon"],
  },
  {
    name: 'csharp',
    command: ["roslyn-language-server", "--stdio", "--autoLoadProjects"],
    extensions: [".cs", ".csx"],
  },
  {
    name: 'fsharp',
    command: ["fsautocomplete"],
    extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
  },
  {
    name: 'sourcekit-lsp',
    command: ["sourcekit-lsp"],
    extensions: [".swift", ".mm"],
  },
  {
    name: 'clangd',
    command: ["clangd", "--background-index", "--clang-tidy"],
    extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
  },
  {
    name: 'jdtls',
    command: ["jdtls"],
    extensions: [".java"],
  },
  {
    name: 'kotlin-lsp',
    command: ["kotlin-lsp", "--stdio"],
    extensions: [".kt", ".kts"],
  },
  {
    name: 'yaml-language-server',
    command: ["yaml-language-server", "--stdio"],
    extensions: [".yaml", ".yml"],
  },
  {
    name: 'lua-language-server',
    command: ["lua-language-server"],
    extensions: [".lua"],
  },
  {
    name: 'intelephense',
    command: ["intelephense", "--stdio"],
    extensions: [".php"],
  },
  {
    name: 'prisma',
    command: ["prisma-language-server", "--stdio"],
    extensions: [".prisma"],
  },
  {
    name: 'dart',
    command: ["dart", "language-server"],
    extensions: [".dart"],
  },
  {
    name: 'ocaml-lsp',
    command: ["ocamllsp"],
    extensions: [".ml", ".mli"],
  },
  {
    name: 'bash-language-server',
    command: ["bash-language-server", "start"],
    extensions: [".sh", ".bash"],
  },
  {
    name: 'terraform-ls',
    command: ["terraform-ls", "serve"],
    extensions: [".tf", ".tfvars"],
  },
  {
    name: 'texlab',
    command: ["texlab"],
    extensions: [".tex", ".bib"],
  },
  {
    name: 'gleam',
    command: ["gleam", "lsp"],
    extensions: [".gleam"],
  },
  {
    name: 'clojure-lsp',
    command: ["clojure-lsp", "listen"],
    extensions: [".clj", ".cljs", ".cljc", ".edn"],
  },
  {
    name: 'nixd',
    command: ["nixd"],
    extensions: [".nix"],
  },
  {
    name: 'tinymist',
    command: ["tinymist"],
    extensions: [".typ", ".typc"],
  },
  {
    name: 'haskell-language-server',
    command: ["haskell-language-server-wrapper", "--lsp"],
    extensions: [".hs", ".lhs"],
  },
];

/**
 * The language id for one file, from the shared extension map.
 *
 * Falls back to the bare extension so an unmapped extension still produces a
 * usable id instead of failing the document open.
 *
 * @param extension - the final extension including its leading dot.
 * @returns the LSP language id.
 */
export function languageIdFor(extension) {
  return LANGUAGE_IDS[extension] ?? extension.slice(1);
}
