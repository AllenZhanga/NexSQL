# NexSQL

**面向日常 SQL 开发和数据管理的开源桌面数据库客户端。**

A desktop database client for SQL editing, data browsing, and everyday development.

[中文](#中文) · [English](#english) · [下载 / Releases](https://github.com/AllenZhanga/NexSQL/releases) · [问题反馈 / Issues](https://github.com/AllenZhanga/NexSQL/issues)

![Version](https://img.shields.io/badge/version-0.3.0-2563eb)
![License](https://img.shields.io/badge/license-MIT-blue)
![Electron](https://img.shields.io/badge/Electron-33-47848f)
![React](https://img.shields.io/badge/React-18-61dafb)

## 中文

NexSQL 将数据库连接、SQL 编辑、查询结果和表数据管理放在同一个桌面工作区中。支持 MySQL、PostgreSQL、SQL Server、SQLite 和 Redis，提供 SSH 隧道、Navicat 连接导入，以及独立的 JSON、时间戳和 Markdown 开发工具。

自然语言生成 SQL 是可选功能：生成结果会打开为新的查询标签，由用户审查后执行。日常数据库操作不需要配置模型。

### 下载与安装

安装包请查看 [Releases](https://github.com/AllenZhanga/NexSQL/releases)，可下载的版本和架构以发布页附件为准。

| 平台                | 包格式                              | 0.3.0 构建与验证情况                                               |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| macOS Apple Silicon | `.dmg`，arm64                       | 已生成安装包，完成包内版本、签名完整性和查询 / 导入冒烟验证        |
| Windows             | `.exe`，x64                         | 已交叉构建并核验版本、原生依赖架构和安装包完整性，尚未实机运行验证 |
| macOS Intel / Linux | 配置有 x64 DMG、AppImage / deb 目标 | 本轮未构建和运行验证，可从源码构建                                 |

### 核心能力

#### SQL 工作区

- Monaco 编辑器，支持多标签、独立撤销、方言格式化、SQL 草稿和连接 / 数据库上下文恢复。
- 有选区时执行选中的 SQL，可一次选择多条；没有选区时执行全文。
- 多条 SQL 按顺序执行，错误保留在对应结果和日志中，后续语句继续执行。
- 提供停止执行、超时设置、多结果切换、执行日志和查询历史。
- 表设计器支持字段、索引、当前 DDL 和变更 SQL 预览，可一键复制建表语句。

#### 查询结果与表数据

- 查询结果支持矩形选区、搜索、按列筛选、排序，以及调整列宽、隐藏列和固定列。
- 选区可以复制为 TSV、JSON 或 INSERT 语句；INSERT 可指定目标表和 SQL 方言，预览后复制。
- 单元格详情可查看完整文本和格式化 JSON；结果面板可以最大化。
- CSV 导出保留当前结果的筛选、排序和可见列。
- 表数据页支持服务端筛选、排序、分页，以及暂存新增、修改、删除后统一提交；更新和删除已有记录需要主键。

#### 连接与结构浏览

- 连接列表与数据库结构独立滚动，分隔线可拖动并记住比例；连接可按名称、主机 / IP、端口、分组和标签搜索，分组支持折叠。
- 连接分组、标签、测试连接，以及 NexSQL JSON 连接配置导入 / 导出。
- MySQL、PostgreSQL、SQL Server 和 Redis 支持 SSH 隧道，提供密码、私钥及私钥口令认证。
- Navicat `.ncx` 导入先预览再勾选，显示重复、无效和不兼容的连接，并保留支持的 SSH 配置。
- 数据库结构按需加载：先搜索数据库，展开后在库内搜索已加载的数据表，一次展开一个数据库。
- Redis 提供单机连接、Key 扫描分页、详情、值 / TTL 编辑、删除及命令控制台。

#### SQL 文件与开发工具

- 在侧栏或表清单右键导入 / 导出 SQL 文件；可导出选中表或当前数据库内的表。
- 导出可选择仅结构、仅数据或结构和数据；导入先显示目标数据库、语句数量及预览，再确认执行。
- 独立开发工作台提供 JSON 格式化 / 压缩 / 反转义、时间戳与日期互转、Markdown 预览。
- 支持中英文、深色 / 浅色 / 浅蓝主题和编辑器字号设置。

### 使用指南

#### 连接数据库

1. 新建连接，选择数据库类型，填写地址、端口和凭据；SQLite 选择本地文件。
2. 测试连接并保存。连接后选择一个数据库，按需展开它的表清单。
3. 打开查询标签，选择连接和数据库，再编写或粘贴 SQL。
4. 执行后查看结果或执行日志。需要管理记录时，打开对应表的数据页。

**使用 SSH：** 在连接配置中开启 SSH 隧道，填写跳板机地址、端口和账号，选择密码或私钥认证。数据库主机填写**跳板机可以访问的地址**；私钥路径必须在当前电脑有效，支持 `~/.ssh/id_ed25519` 这类路径。首次连接会显示 SHA256 主机指纹，确认后保存信任记录；指纹变化时拒绝连接。数据库浏览、查询和取消执行的控制连接均通过隧道。

#### 从 Navicat 迁移连接

1. 在 Navicat 中导出连接，得到 `.ncx` 文件。
2. 点击 NexSQL 连接列表顶部的导入按钮，选择文件并查看预览。
3. 勾选可导入的连接，导入后测试连接；按提示补填密码或调整私钥 / SQLite 文件路径。

支持识别的 MySQL / MariaDB、PostgreSQL、SQL Server SQL 认证、SQLite 和 Redis 单机连接。MariaDB 配置映射到 MySQL 驱动。Redis 单机导出中空的 `SentinelAddr` 和保存的 `AddressList` 不会覆盖主连接地址与认证配置。

连接文件最大 5 MB、每次最多 2000 条，支持 UTF-8 和带 BOM 的 UTF-16。可识别的 NCX 加密密码和 SSH 口令会迁移；无法转换的密码会提示重新填写。不支持的连接逐条跳过，其余连接仍可导入。NexSQL 导出的连接 JSON **不包含数据库密码、SSH 密码或私钥口令**。

#### 导入与导出表 SQL

在表清单右键选择“导入表（SQL 文件）”或“导出表（SQL 文件）”。SQL 导入支持 UTF-8 / BOM，文件最大 50 MB，执行中可停止并查看逐条日志。

导入按文件里的表名和数据库切换语句执行，右键选中的表不会替换 SQL 中的目标表名。导出用于表结构和数据的逻辑迁移，完整范围见[已知限制](#已知限制)。

#### 自然语言生成 SQL

在模型设置中配置 OpenAI / OpenAI 兼容接口的地址、模型和 API Key，或配置 Ollama 地址及模型。选择数据库后输入需求，生成的 SQL 在新标签中打开，不会自动执行。

生成请求会将输入需求及相关数据库结构发送到配置的模型服务，结构中包含表名、字段名、类型、默认值等信息。使用远程服务前应确认这些元数据可发送给该服务；使用本机 Ollama 时，请将地址配置为本地服务。

### 执行规则与快捷键

每次执行使用独立的数据库会话；同次执行内共享临时表、变量和事务，下一次执行不会复用它们。需要事务时，将 `BEGIN`、操作和 `COMMIT` 放在同一次执行中。

单条语句报错后继续执行，不代表自动恢复事务。PostgreSQL 等数据库的事务报错后可能需要显式 `ROLLBACK` 才能继续；NexSQL 不自动重放 SQL。取消或超时会停止后续执行，**不会撤销已提交的写入**。会话结束时未提交的事务会回滚并报告。

SQL Server 使用 `GO` 独占一行分隔批次，批次失败后继续后续批次；批次内部遵循 SQL Server 规则。支持 MySQL `DELIMITER`、PostgreSQL dollar quote 和 SQLite trigger 等脚本结构；不支持 `GO n` 重复批次。

| 场景       | 快捷键                           | 操作                            |
| ---------- | -------------------------------- | ------------------------------- |
| SQL 编辑器 | `Cmd/Ctrl+Enter` 或 `F5`         | 执行选区；没有选区时执行全文    |
| SQL 编辑器 | `Cmd/Ctrl+Shift+Enter`           | 取消当前执行                    |
| 查询结果   | `Cmd/Ctrl+A` / `Cmd/Ctrl+C`      | 选择当前筛选结果 / 复制选区 TSV |
| 表数据页   | `Cmd/Ctrl+R` 或 `F5`             | 刷新数据                        |
| 表数据页   | `Cmd/Ctrl+F`                     | 聚焦筛选                        |
| 表数据页   | `Cmd/Ctrl+S` 或 `Cmd/Ctrl+Enter` | 提交暂存修改                    |
| 表数据页   | `Cmd/Ctrl+Alt+N`                 | 新增草稿行                      |
| 表数据页   | `F2` / `Delete`                  | 编辑活动行 / 标记删除           |
| 表数据页   | `Shift+↑/↓` / `Alt+←/→`          | 连续选择 / 翻页                 |

表数据页的“快捷键”按钮可查看完整列表。快捷键按当前工作区和焦点生效，文本输入保留常规编辑行为。

### 本地数据与凭据

连接配置、查询历史和模型设置保存在本机应用数据目录。数据库密码、SSH 密码及私钥口令优先使用 Electron `safeStorage` 加密；系统安全存储不可用时，这些连接凭据退回 Base64 编码，**不提供加密保护**。模型 API Key 在安全存储不可用时会拒绝保存。

SSH 信任记录保存在同一目录的 `ssh-known-hosts.json`。连接导出和导入预览不会包含密码明文。SQL 草稿及历史可能包含你输入的业务 SQL，应按本地业务数据管理。

### 已知限制

- PostgreSQL 元数据浏览当前以所选数据库的 `public` schema 为范围。
- 查询结果和 SQL 数据导出仍整体缓存在内存中，大表查询请限制返回范围；结果搜索和列筛选只处理已加载的数据。
- SQL 导出不等同于完整备份：PostgreSQL / SQL Server 的 DDL 未完整覆盖约束、索引、序列等，SQLite 额外索引与触发器也不包含在表 DDL 中。复杂类型、生成列及对象依赖需要另行核对。
- CSV 中 NULL 与空字符串均导出为空字段；需要保留这种区别时，可使用选区 JSON 或 INSERT。
- 当前不支持 Redis Sentinel / Cluster、SSH Agent、多跳 SSH 或多因素交互认证。NCX 中的 HTTP 隧道、客户端证书等不兼容配置会明确提示。
- MySQL / PostgreSQL 的 SSL 开关当前不执行严格证书校验；SQL Server 当前信任服务器证书。SSL 开关不代表完整的服务器身份校验。
- SQL Server 尚未完成实库验证；Windows 尚未实机运行验证，Linux 尚未完成构建和运行验证。

执行语义、SQL 导出范围和验证记录详见 [SQL 工作区说明](docs/sql-workspace-update.md)。

### 开发与构建

当前构建环境为 **Node.js 22、pnpm 10.33.0**；桌面包在 `packageManager` 字段中固定了 pnpm 版本。

```bash
git clone https://github.com/AllenZhanga/NexSQL.git
cd NexSQL
pnpm install --frozen-lockfile
pnpm dev
```

| 命令（仓库根目录）                      | 用途                                    |
| --------------------------------------- | --------------------------------------- |
| `pnpm dev`                              | 启动 Electron 开发模式                  |
| `pnpm typecheck`                        | TypeScript 检查                         |
| `pnpm build`                            | 构建应用代码                            |
| `pnpm --filter nexsql-desktop test:sql` | 构建并运行 SQL、状态、导入和 SSH 等测试 |
| `pnpm build:mac`                        | 构建 macOS 安装包                       |
| `pnpm build:win`                        | 构建 Windows 安装包                     |
| `pnpm build:linux`                      | 构建 Linux 安装包                       |

编译输出为 `apps/desktop/out/`；上述打包脚本输出到 `apps/desktop/release-prod/`，直接运行 `electron-builder` 的默认输出为 `apps/desktop/release/`。各平台依赖对应架构的原生模块，应在目标系统构建，或单独准备匹配的跨平台依赖。

仓库 `.npmrc` 为 Electron 二进制配置了下载镜像，可按网络环境调整。

#### 验证与界面预览

```bash
# 类型检查；构建并运行测试
pnpm typecheck
pnpm --filter nexsql-desktop test:sql

# 构建后启动隔离的界面预览
pnpm --filter nexsql-desktop preview:ui
```

预览监听 `http://127.0.0.1:4179`，使用临时 SQLite 示例，不读取已保存连接或模型凭据，外部连接测试在预览中禁用；完整连接能力请在 Electron 应用中验证。

测试默认跳过未配置的外部数据库用例。可针对**专用临时测试实例**启用集成测试，端口需对应已准备的本机实例：

```bash
NEXSQL_TEST_MYSQL_PORT=3307 \
NEXSQL_TEST_PG_PORT=5433 \
NEXSQL_TEST_REDIS_PORT=6380 \
pnpm --filter nexsql-desktop test:sql
```

MySQL / PostgreSQL 使用数据库 `nexsql_test`，用户分别为 `root` / `postgres`；测试密码为 `nexsql_test_only`，Redis 使用同一测试密码。这些测试会创建或删除测试数据，勿指向业务实例。

#### 技术栈与目录

Electron 33 · React 18 · TypeScript · Monaco · Tailwind CSS · Zustand · TanStack Table / Virtual · better-sqlite3 · ssh2

```text
NexSQL/
├── apps/desktop/
│   ├── src/main/         # 数据库驱动、SSH、SQL 执行、IPC 和模型接口
│   ├── src/preload/      # Electron 桥接 API
│   ├── src/renderer/     # React 界面与工作区状态
│   ├── tests/            # 自动化验证与隔离预览
│   └── electron-builder.yml
├── packages/shared/      # 共享类型、SQL 解析和导出工具
└── docs/                 # 功能范围、执行规则与验证记录
```

### 参与贡献

欢迎提交 [Issue](https://github.com/AllenZhanga/NexSQL/issues) 或 Pull Request。报告问题时请附应用版本、系统与架构、数据库类型 / 版本、复现步骤和脱敏后的日志；NCX 兼容问题请提供脱敏结构，移除主机、密码和私钥等敏感内容。

MIT 许可证，详见 [LICENSE](LICENSE)。

---

## English

NexSQL is an open-source desktop database client for SQL editing, query results, and table data management. Version **0.3.0** supports MySQL, PostgreSQL, SQL Server, SQLite, and standalone Redis, with SSH tunnels and selective Navicat connection import. Natural-language SQL generation is optional; generated queries open in a new tab for review before execution.

### Downloads

See [Releases](https://github.com/AllenZhanga/NexSQL/releases) for available versions and assets. The current build has produced a macOS arm64 DMG and a Windows x64 installer. Windows packages have passed static version, architecture, and archive checks but have not been tested on a Windows host. Intel macOS and Linux targets are configured but were not built or run in this validation round.

### Features

- **SQL editor:** Monaco tabs, independent undo, draft recovery, dialect formatting, selected-script execution, multiple results, history, cancellation, and configurable timeout.
- **Results:** rectangular selection, loaded-result search and filters, sorting, column sizing / hiding / pinning, cell details, CSV export, and selection copy as TSV, JSON, or INSERT.
- **Tables:** server-side filtering, sorting and pagination, staged inserts / updates / deletes, field and index design, and one-click DDL copy. Updating or deleting existing rows requires a primary key.
- **Connections:** independently scrolling connection and schema panes with a saved resize ratio, connection search by name / host / port / group / tags, collapsible groups, on-demand database tree loading, database search followed by table search inside the expanded database, password / private-key SSH authentication, and NexSQL JSON / Navicat NCX import with preview and duplicate detection.
- **Data transfer:** table-list context menus for SQL import / export, structure-only / data-only / combined export, and cancellable script import with execution logs.
- **Redis:** standalone key browsing with scan pagination, value and TTL editing, deletion, and a command console.
- **Developer workbench:** JSON formatting / minifying / unescaping, timestamp conversion, and Markdown preview, independent of SQL tabs.
- **Preferences:** English / Chinese, dark / light / light-blue themes, and editor font sizing.

### Connection setup and migration

Create and test a connection, select a database, then open a query or table. Use the structure search to find a database, then expand it to load tables and reveal its own table-search field.

For SSH, enter the jump-server credentials and a database address reachable **from the jump server**. Private-key paths must exist on the current computer. First use requires explicit SHA256 host-fingerprint acceptance; changed fingerprints are refused. Browsing, query sessions, and cancellation control connections use the tunnel.

Export connections from Navicat as `.ncx`, then use the import button above NexSQL's connection list. Preview and select supported entries; re-enter passwords that cannot be converted and adjust local file paths. Files are limited to 5 MB and 2,000 connections; UTF-8 and BOM-marked UTF-16 are accepted. Recognized MariaDB entries use the MySQL driver. NexSQL connection JSON exports omit database and SSH secrets.

SQL file import accepts UTF-8 / BOM up to 50 MB and previews the target and statements. Object names follow the file; choosing a table in the context menu does not rewrite the script's target table.

### Execution and shortcuts

Execution runs the selection when present, otherwise the entire editor. Each execution owns a database session; statements in that execution share temporary tables, variables, and transactions. Statement errors are recorded and later statements continue. Transaction recovery follows the engine's rules; no SQL is automatically replayed. Cancellation or timeout stops subsequent work and does not undo committed writes. Uncommitted transactions roll back when the session closes.

SQL Server preserves native batches separated by a standalone `GO`; failed batches do not prevent later batches. `GO n` repetition is unsupported. MySQL `DELIMITER`, PostgreSQL dollar-quoted blocks, and SQLite triggers are supported.

| Context       | Shortcut                         | Action                              |
| ------------- | -------------------------------- | ----------------------------------- |
| SQL editor    | `Cmd/Ctrl+Enter` or `F5`         | Run selection or entire script      |
| SQL editor    | `Cmd/Ctrl+Shift+Enter`           | Cancel current execution            |
| Query results | `Cmd/Ctrl+A` / `Cmd/Ctrl+C`      | Select filtered results / copy TSV  |
| Table data    | `Cmd/Ctrl+R` or `F5`             | Refresh data                        |
| Table data    | `Cmd/Ctrl+F`                     | Focus filter                        |
| Table data    | `Cmd/Ctrl+S` or `Cmd/Ctrl+Enter` | Commit staged changes               |
| Table data    | `F2` / `Delete`                  | Edit active row / mark for deletion |

### Optional SQL generation and local storage

Configure an OpenAI / OpenAI-compatible endpoint, model, and API key, or an Ollama endpoint and model. Generation sends your request and database metadata, including table names, columns, types, and defaults, to that endpoint. Generated SQL is not executed automatically.

Connections, history, and model settings are stored locally. Database and SSH secrets use Electron `safeStorage` when available; the fallback is Base64 encoding, **which does not provide encryption**. Saving a model API key requires secure storage. Drafts and query history may contain business SQL. Connection exports and import previews do not include plaintext passwords.

### Limitations

- PostgreSQL metadata browsing currently covers the selected database's `public` schema.
- Results and SQL data exports are buffered in memory; limit large queries. Result-grid search and filters operate on loaded rows.
- SQL export is a logical table transfer, not a complete backup. PostgreSQL / SQL Server DDL omits some constraints, indexes, and sequences; SQLite table DDL omits additional indexes and triggers. Review generated columns, complex types, and dependencies separately.
- CSV exports represent both NULL and empty strings as empty fields; selection JSON or INSERT preserves that distinction.
- Redis Sentinel / Cluster, SSH Agent, multi-hop SSH, and MFA are unsupported. Incompatible NCX settings are reported per connection.
- MySQL / PostgreSQL TLS currently disables strict certificate verification; SQL Server trusts the server certificate. SQL Server has not been verified against a live instance. Platform validation status is listed under Downloads.

### Development

Build environment: **Node.js 22 and pnpm 10.33.0**.

```bash
git clone https://github.com/AllenZhanga/NexSQL.git
cd NexSQL
pnpm install --frozen-lockfile
pnpm dev

# Validate and build
pnpm typecheck
pnpm --filter nexsql-desktop test:sql
pnpm build

# Package on the target platform with matching native dependencies
pnpm build:mac
pnpm build:win
pnpm build:linux
```

Compiled code goes to `apps/desktop/out/`; packaging scripts write to `apps/desktop/release-prod/`. Direct electron-builder runs default to `apps/desktop/release/`. After building, `pnpm --filter nexsql-desktop preview:ui` starts an isolated SQLite preview at `127.0.0.1:4179` without loading saved connections or model credentials.

External integration tests are opt-in via `NEXSQL_TEST_MYSQL_PORT`, `NEXSQL_TEST_PG_PORT`, and `NEXSQL_TEST_REDIS_PORT`. They use local disposable instances and modify test data; never point them at business instances. MySQL / PostgreSQL use database `nexsql_test`, users `root` / `postgres`, and password `nexsql_test_only`; Redis uses the same test password. Set the variables to your test ports before running `test:sql`. Execution and validation notes are in [SQL workspace notes](docs/sql-workspace-update.md).

### Contributing and license

[Issues](https://github.com/AllenZhanga/NexSQL/issues) and pull requests are welcome. Include the app version, OS / architecture, database version, reproduction steps, and sanitized logs. Remove credentials and private keys from connection-file examples.

Licensed under [MIT](LICENSE).
