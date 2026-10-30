# DSH LSP

为 **DeepSeek Harness** 提供 LSP 工具面：**装好即用，不需要写一行配置**。

插件内置一张语言服务器目录，挂载时按 `PATH` 逐个探测：找到的启用，找不到的跳过并在报错里点名。模型拿到的 6 个工具全部使用扁平参数，固定上下文成本约 **860 tokens**。

## 工具

| 工具 | 作用 | 写盘 |
|---|---|---|
| `lsp_diagnostics` | 单个文件的错误与警告 | 否 |
| `lsp_symbols` | 文件符号大纲，或工作区符号搜索 | 否 |
| `lsp_hover` | 位置上的类型、签名与文档 | 否 |
| `lsp_format` | 整文件格式化 | **是** |
| `lsp_rename` | 语义级重命名，可跨文件 | **是** |
| `lsp_code_action` | 服务器提供的快速修复与重构 | 否 |

位置统一是 **1-based UTF-16**，与 `read` 显示的行列一致。与服务器之间的 0-based 及 `utf-8` / `utf-32` 转换在工具层以下完成。

## 为什么不需要配置

内置目录覆盖 32 个服务器，包含两种主流安装家族：

- 编辑器扩展家族：`typescript-language-server`、`vtsls`、`pyright`、`pylsp`
- pi-lsp 家族：`biome`、`ty`、`ruff`、`rust-analyzer`、`gopls`、`clangd`、`jdtls`、`zls`、`lua-language-server`、`texlab`、`tinymist`、`bash-language-server`、`yaml-language-server`、`terraform-ls` 等

挂载时每个命令都通过子进程 seam 解析：

- 目录条目**不在 PATH 上就跳过**，之后的"没有服务器认领此文件"会点名列出来，所以缺 `rust-analyzer` 不会影响 TypeScript；
- 显式 `servers` 配置里的条目不在 PATH 上则是**报错**，因为那是用户点名的。

一个文件按扩展名路由到目录中第一个匹配的条目。顺序即优先级：类型检查服务器排在 lint / format 服务器之前。

## 环境要求

- 已配置模型的 DSH，要求 **`@deepseek-ai/dsh >= 0.2.0`**。
- Node.js **22 或更新版本**。
- 语言服务器本体需自行安装并出现在 `PATH` 上，插件不代为下载：

```sh
npm i -g typescript-language-server typescript pyright   # TS/JS + Python
go install golang.org/x/tools/gopls@latest               # Go
xcode-select --install                                   # C/C++（clangd）
brew install lua-language-server                         # Lua
```

## 安装

以依赖形式固定到某个提交：

```json
"@satanfire/dsh-lsp": "https://codeload.github.com/satanfire/dsh-lsp/tar.gz/<commit-sha>"
```

或用 CLI 从仓库安装（会读取仓库根目录的 `package.json`）：

```sh
dsh plugin --profile web add github:satanfire/dsh-lsp
```

本地开发时可直接指向 checkout：

```sh
git clone https://github.com/satanfire/dsh-lsp.git
dsh plugin --profile web add "$PWD/dsh-lsp"
```

装完重启 `dsh web`。插件默认启用，不需要在设置页打开开关。

## 配置（可选）

空的配置行就是有效配置。只有想替换目录，或表达目录无法描述的服务器时才需要：

```yaml
- id: lsp-auto
  config:
    servers:
      ts:
        command: typescript-language-server
        args: ["--stdio"]
        extensionToLanguage:
          ".ts": typescript
          ".tsx": typescriptreact
        projectMarkers: ["package.json", "tsconfig.json"]
```

非空 `servers` 表**整体替换**内置目录而不是合并：一张只列了一个服务器的表，不应该悄悄带回其余十七个默认项。

其余键均可选：`maxDiagnostics`（200）、`maxSymbols`（100）、`maxCodeActions`（50）、`maxResultChars`（16000）、`maxDiffLines`（60）、`maxDocumentBytes`（8 MiB）、`timeoutMs`（60000）。

## 已知限制

- **一个文件只路由到一个服务器**。`ty` + `ruff`、`biome` + `tsc` 这类互补组合不会同时运行；此时诊断只来自其中一个。
- **LSP 根目录等于会话工作目录**。请在项目目录中开会话，否则 `tsc` 找不到 `tsconfig.json`，诊断会充满 "Cannot find module" 噪声。
- 目录条目的 `initializationOptions` 未内置，需要时通过 `servers` 配置覆盖。

## 设计说明

- **会话复用**：每个（服务器，工作区根）一个会话，首次调用时懒启动，之后复用。
- **双通道诊断**：先拉取（pull），再与最后一次 `publishDiagnostics` 合并去重。服务器在分析未完成时用空列表回答 pull 的情况，会先等一小段静默窗口，而不是当成"无问题"。
- **写盘走 harness 文件系统 seam**：调用读取之后文件被外部改过，会以冲突失败而不是静默覆盖。
- **卸载回收子进程**：插件卸载时先走协议 `shutdown`/`exit`，再在 grace 之后调用子进程 seam 的 `terminate()`——忽略 `exit` 的服务器不能活过会话。

## 可选的后续增强

- 按项目标记（`tsconfig.json` / `package.json` / `pyproject.toml`）自动选择 LSP 根目录。
- 单文件多服务器合并诊断。

## 致谢

- 协议层与工具架构来自 [dsh-tool-lsp](https://github.com/Jaylor-Wang/dsh-tool-lsp)（MIT）。
- 内置目录与"探测-跳过"策略来自 [@narumitw/pi-lsp](https://github.com/narumiruna/pi-extensions)（MIT）。

## 许可

MIT，见 [LICENSE](./LICENSE)。
