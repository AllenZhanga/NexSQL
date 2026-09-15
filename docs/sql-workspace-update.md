# SQL 工作区调整与验证

## 功能范围

- AI 只保留自然语言生成 SQL 及模型配置。删除优化、设计、数据字典、语义索引、ER 的界面、状态、协议、Provider 方法及 IPC。
- 保留独立开发工作台中的 JSON、时间戳、Markdown 工具；切换工作区不会清空工具输入。
- 查询标签独立 Monaco model，格式化可撤销，SQL 草稿和连接/数据库上下文自动保存。
- 查询操作增加选区条数、停止、超时选择、多结果标签、执行日志；执行中禁止切换其连接及关闭标签。
- 统一桌面导航、按钮间距、深浅主题、编辑器背景、焦点状态；侧栏保证最小可用宽度。

## 执行语义

每次点击执行启动独立进程和数据库会话。同次执行共享临时表、变量和事务，下一次执行不会复用该会话。发生连接故障时不自动重放写语句。

MySQL、PostgreSQL、SQLite 按完整语句执行并在错误后停止。SQL Server 保留原生批次语义：GO 分批、批次内支持 DECLARE，开启 XACT_ABORT；某批次失败后不再执行后续批次，批次内部的错误处理遵循 SQL Server。

事务必须在同次执行中包括 BEGIN / COMMIT。执行结束但未提交时回滚并显示提示。取消不会撤销已经提交的语句，写入响应不确定时需核实状态。

MySQL/PG 的取消使用独立控制连接发送 KILL QUERY / pg_cancel_backend；SQL Server 取消当前 request。SQLite 的同步原生调用放入可终止进程，避免长查询阻塞 Electron 主进程。取消以执行 ID 和所属窗口匹配，不能误停其他执行。

默认超时 5 分钟，支持 30 秒、1 分钟和不限时。SQL 分句支持字符串、注释、引用标识符、MySQL DELIMITER、PostgreSQL dollar quote 和 SQLite trigger；不支持脚本内切换非默认 SQL 词法模式和 GO 次数展开。

## 验证

- TypeScript：renderer 与 main/preload 检查通过。
- 构建：Electron main、执行子进程、preload、renderer 构建通过。
- 测试：48 项，覆盖 SQL 分句、标签状态、草稿持久化、AI 上下文与接口范围，以及真实 SQLite / MySQL 8.4 / PostgreSQL 16 执行。
- 实库检查：同会话临时表、多结果、错误后停止写入、未提交回滚、长查询取消、取消不影响其他查询、并发不同数据库隔离、MySQL 存储过程多个结果集。
- UI：用隔离 SQLite 示例验证选中两条 SQL 返回两个结果；长查询停止且第三条未执行；格式化后切换标签仍可撤销；刷新恢复草稿；开发工作台切换后输入仍在。
- 视觉：深色/浅色主题、默认 1440×900 和最小 900×600 窗口。
- macOS arm64：本地目录打包及 app.asar 内执行子进程 SQLite 冒烟检查通过。

## 尚未覆盖

- SQL Server 实库、Windows/Linux 打包运行。
- 使用真实模型凭据调用 OpenAI/Ollama（测试使用 Provider 替身，未发送业务结构）。
- 超大结果集性能：当前结果仍完整缓存在内存中，应在 SQL 中限定返回范围。
- PostgreSQL 元数据浏览仍以选中数据库的 public schema 为范围。

## 复现

见 README 的 Verification 小节。UI 预览是测试用适配层，使用临时 SQLite 数据库，不会读取用户已保存连接或模型凭据；它不代替完整 Electron UI 验收。
