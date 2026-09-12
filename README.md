# qianji-bridge

钱迹（Qianji）的个人自部署网页版，以及私有 HTTP API 研究文档。

现已包含 React + TypeScript 前端、Fastify 后端、SQLite 持久化、Docker 部署与测试。

## 启动网页版

```bash
npm ci
npm run dev
```

打开 [http://localhost:5173](http://localhost:5173)。可用独立演示账本体验，也可登录自己的钱迹账号；首次登录会自动同步。
需要 Node.js 22.13 或更新的 22.x 版本。

生产模式：

```bash
npm run build
npm start
```

打开 [http://localhost:3001](http://localhost:3001)。默认生成的数据库与加密密钥存放在 `data/`，已忽略提交。

Docker：

```bash
docker compose pull
docker compose up -d --no-build
```

默认仅监听本机 `127.0.0.1:3001`。公网部署需设置 HTTPS 反向代理及对应的 `APP_ORIGIN`、`COOKIE_SECURE=true`。

**支持**：登录、全量/增量同步、多账本查询、账单详情与筛选、精确收支统计、预算进度、资料查询、CSV/JSON 导出。

**写入状态**：新增、编辑、删除、退款、报销和取消报销已实现适配器与测试账本验证流程，**尚未在真实账号实测**。默认只允许在用户指定的测试账本中主动验证；逐项回拉核验成功后才开放对应操作。当前写入范围为基准币种、无资产关联、无图片及手续费的普通收支或待报销支出。账号级报销升级保持关闭。

完整部署、备份、接口、限制和验收步骤见 [网页版使用与部署](./docs/05-网页版使用与部署.md)。

Traefik 部署示例见 `compose.home.yaml`，请配置自己的域名及外部网络。

## ChatGPT / MCP

已实现 15 个免鉴权 MCP 工具，使用独立回环端口和 OpenAI Secure MCP Tunnel 接入个人 ChatGPT 自定义插件。网页版设置可连接或撤销 MCP 账号；写入沿用真实测试验证门禁。

部署与 ChatGPT 注册步骤见 [MCP 与 ChatGPT Tunnel](./docs/07-MCP与ChatGPT-Tunnel.md)。

## API 研究文档

- [认证与签名](./docs/01-认证与签名.md)
- [接口参考](./docs/02-接口参考.md)
- [数据模型](./docs/03-数据模型.md)
- [研究方法与验证边界](./docs/04-抓包与验证记录.md)
- [网页版协议补充](./docs/06-网页版协议补充与验证.md)

上游是钱迹私有 API，可能随客户端升级变化。签名算法及协议参数来自历史研究和 [公开参考实现](https://github.com/fangzhengjin/qianji-mcp)，当前网页与 MCP 的自动测试使用虚构夹具，不能视为真实账号写入已验证。

## 发布与数据安全

公开镜像：`ghcr.io/cloverstd/qianji-bridge:latest`，支持 Linux amd64/arm64。`main` 和版本标签通过 GitHub Actions 构建，PR 只验证不发布。部署生产实例建议固定发布版本或 digest，详见 [镜像发布](./docs/08-镜像发布.md)。

公开仓库从脱敏快照建立新历史。所有示例账号、账单、金额和 ID 均为虚构；不包含原始抓包数据、个人部署信息、凭证或真实账单。运行数据保存在本地卷，Git 忽略和 Docker 构建白名单共同排除它们。修改代码后仍需审查暂存区并执行密钥扫描，忽略规则不能替代审查。
