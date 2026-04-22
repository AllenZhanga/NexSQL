# NexSQL

<p align="center">
  <b>Open-Source Database Client with AI, SQL Editor, and Data Grid</b>
</p>

<p align="center">
  <a href="#english">English</a> | <a href="#中文">中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/electron-33-47848F.svg" alt="Electron 33" />
  <img src="https://img.shields.io/badge/react-18-61DAFB.svg" alt="React 18" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Cross-platform" />
</p>

---

## English

NexSQL is a cross-platform desktop database client built with Electron and React.
It brings SQL workflow, table data management, Redis key operations, and AI-assisted development into one app.

### Highlights

- Multi-engine support: MySQL, PostgreSQL, SQL Server (MSSQL), SQLite, Redis
- SQL editor: Monaco + SQL formatting + selected-text execution
- Table data view: filtering, sorting, pagination, staged CRUD, CSV export
- SQL helper actions: copy INSERT/UPDATE SQL, export SQL to file
- Schema explorer and table designer: columns, indexes, DDL preview
- AI workspace: NL2SQL, SQL optimization, schema design SQL, data dictionary generation
- Semantic schema index and E-R relation modeling (manual + AI inference workflow)
- Connection management: group/tag organization and encrypted credential storage
- App preferences: language (EN/ZH), theme, editor font size

### Architecture

| Layer | Technology |
|---|---|
| Desktop shell | Electron + electron-vite |
| UI | React + TypeScript + Tailwind CSS |
| Editor | Monaco Editor |
| Data grid | TanStack Table + virtualization |
| State | Zustand |
| Local storage | better-sqlite3 |
| DB drivers | mysql2, pg, mssql, better-sqlite3, redis |

### Quick Start

Prerequisites:

- Node.js >= 18
- pnpm >= 6

```bash
git clone https://github.com/AllenZhanga/NexSQL.git
cd NexSQL

pnpm install
pnpm dev
```

Alternative (desktop package only):

```bash
pnpm --filter nexsql-desktop dev
```

### Build

```bash
pnpm build
pnpm build:win
pnpm build:mac
pnpm build:linux
```

Build outputs:

- Dev/compile output: `apps/desktop/out/`
- Installer output (packaging scripts): `apps/desktop/release-prod/`

### Scripts

At repository root:

- `pnpm dev` - start desktop app in development mode
- `pnpm build` - build desktop app
- `pnpm lint` - run lint across workspaces
- `pnpm typecheck` - run TypeScript checks across workspaces

### Project Structure

```text
NexSQL/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/      # Electron main process (DB drivers, IPC, AI/services)
│       │   ├── preload/   # Bridge API exposed to renderer
│       │   └── renderer/  # React application
│       └── electron-builder.yml
└── packages/
    └── shared/            # Shared TypeScript types
```

### AI Setup

Open AI settings in the app and configure one provider:

- OpenAI
- OpenAI-compatible endpoint (DeepSeek, Qwen, Moonshot, etc.)
- Ollama local model

### Known Limitations

- SSH tunnel in connection config is not implemented yet. For now, use direct DB access or create local port forwarding manually.

### Contributing

Issues and pull requests are welcome.

### License

MIT. See [LICENSE](LICENSE).

---

## 中文

NexSQL 是一个基于 Electron + React 的跨平台桌面数据库客户端。
它将 SQL 开发、表数据管理、Redis Key 管理和 AI 辅助能力整合到一个应用中。

### 核心能力

- 多引擎支持：MySQL、PostgreSQL、SQL Server（MSSQL）、SQLite、Redis
- SQL 编辑器：Monaco + SQL 格式化 + 选中执行
- 表数据视图：筛选、排序、分页、暂存式 CRUD、CSV 导出
- SQL 辅助操作：复制 INSERT/UPDATE SQL、SQL 落盘
- 结构浏览与表设计器（列、索引、DDL 预览）
- AI 工作台：自然语言生成 SQL、SQL 优化诊断、设计 SQL 生成、数据字典生成
- 语义索引与 E-R 关系建模（手工连线 + AI 推断候选）
- 连接管理：分组/标签组织、本地凭据加密存储
- 应用设置：中英文、主题、编辑器字号

### 技术栈

| 层级 | 技术 |
|---|---|
| 桌面容器 | Electron + electron-vite |
| 前端 | React + TypeScript + Tailwind CSS |
| 编辑器 | Monaco Editor |
| 数据表格 | TanStack Table + 虚拟滚动 |
| 状态管理 | Zustand |
| 本地存储 | better-sqlite3 |
| 数据库驱动 | mysql2、pg、mssql、better-sqlite3、redis |

### 快速开始

前置要求：

- Node.js >= 18
- pnpm >= 6

```bash
git clone https://github.com/AllenZhanga/NexSQL.git
cd NexSQL

pnpm install
pnpm dev
```

或仅启动桌面包：

```bash
pnpm --filter nexsql-desktop dev
```

### 构建发布

```bash
pnpm build
pnpm build:win
pnpm build:mac
pnpm build:linux
```

构建产物目录：

- 开发/编译输出：`apps/desktop/out/`
- 安装包输出（打包脚本）：`apps/desktop/release-prod/`

### 常用脚本

仓库根目录：

- `pnpm dev` - 启动开发模式
- `pnpm build` - 构建桌面应用
- `pnpm lint` - 运行多包 lint
- `pnpm typecheck` - 运行多包 TypeScript 校验

### 目录结构

```text
NexSQL/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/      # 主进程（驱动、IPC、AI/服务）
│       │   ├── preload/   # 渲染进程桥接 API
│       │   └── renderer/  # React 界面
│       └── electron-builder.yml
└── packages/
    └── shared/            # 共享类型
```

### AI 配置

在应用内打开 AI 设置，选择并配置一个提供方：

- OpenAI
- 兼容 OpenAI 协议的服务（如 DeepSeek、通义千问、Moonshot）
- 本地 Ollama 模型

### 当前限制

- 连接配置中的 SSH 隧道能力暂未实现。当前可通过直连数据库，或先建立本地端口转发后再连接。

### 参与贡献

欢迎提交 Issue 和 Pull Request。

### 许可证

MIT，详见 [LICENSE](LICENSE)。

