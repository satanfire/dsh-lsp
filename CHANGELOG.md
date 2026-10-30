# Changelog

## 1.0.0 — 2026-10-30

首个公开发布版本。

- 内置 32 个语言服务器的目录，挂载时按 `PATH` 探测；缺命令只跳过并记录，不让插件挂载失败。
- 6 个模型工具：`lsp_diagnostics`、`lsp_symbols`、`lsp_hover`、`lsp_format`、`lsp_rename`、`lsp_code_action`。
- 工具参数全部扁平化，去掉嵌套 range 对象，六个工具的固定上下文成本约 860 tokens。
- 双通道诊断：pull 结果与 `publishDiagnostics` 合并去重，空 pull 不再被当成"无问题"。
- 写盘走 harness 文件系统 seam，外部改过的文件以冲突失败而不是静默覆盖。
- 卸载时先走协议 `shutdown`/`exit`，再按 grace 调用子进程 `terminate()`，不泄漏语言服务器。
- 可选 `servers` 配置整体替换内置目录，用于目录无法表达的服务器。
