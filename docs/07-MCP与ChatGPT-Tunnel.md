# 钱迹 MCP 与 ChatGPT Secure MCP Tunnel

## 当前实现

钱迹后端与 MCP 共用 `server/account-service.ts`，包含 15 个工具。MCP 使用官方 TypeScript SDK 的 Streamable HTTP 无状态传输；不要求 Authorization、OAuth、API key 或浏览器 Cookie。

MCP 仅绑定 `127.0.0.1:3002`，不通过 Traefik，也不发布 Docker 端口。`qianji-tunnel` 共享 `qianji` 的网络命名空间，通过 `http://127.0.0.1:3002/mcp` 调用服务，出站连接 OpenAI。网页仍使用 https://qianji.example.com 。

免鉴权是 MCP 应用层的选择。OpenAI tunnel 自身仍要求 tunnel ID、运行密钥与对应组织/工作区权限；拥有该 tunnel 访问权限的人可以使用已绑定账号的数据和已开放的操作。因此仅将 tunnel 关联到自己的目标工作区。

在网页「设置 → ChatGPT / MCP」点击「连接当前账号到 MCP」。绑定使用独立的 AES-256-GCM 加密凭证，不依赖七天网页 Cookie；演示账号不能绑定，不能从 MCP 改绑账号。网页退出保留连接，点击「断开 MCP 连接」后新的 MCP 调用立即失效。钱迹 token 失效时，在网页重新登录同一账号会更新绑定凭证。

## 工具

| 工具 | 用途 |
|---|---|
| `qianji_status` | 连接、同步时间、币种、写入能力与待核查请求 |
| `qianji_list_bills` | 筛选与分页账单，最多每页 100 笔 |
| `qianji_get_bill` | 详情、原币、关联账单及 revision |
| `qianji_statistics` | 日/月/年收支与分类统计 |
| `qianji_resources` | 账本、分类、成员、资产、借贷、标签、币种 |
| `qianji_budgets` | 年/月/分类预算与每日消耗 |
| `qianji_export_bills` | 当前筛选的分页 CSV/JSON 文本导出 |
| `qianji_sync` | 全量或增量同步 |
| `qianji_create_bill` | 新增账单 |
| `qianji_edit_bill` | 编辑账单，保留未提供的字段 |
| `qianji_delete_bill` | 删除账单 |
| `qianji_refund` | 退款 |
| `qianji_reimburse` | 报销 |
| `qianji_cancel_reimburse` | 取消报销 |
| `qianji_reconcile_write` | 回拉核查，不重新发送写入 |

所有 ID、金额为字符串；账单时间输入为 Unix 秒，统计默认 Asia/Shanghai。数据工具返回 `structuredContent` 及同内容 JSON 文本：`{ok:true,data:{...}}`；业务错误使用 `isError:true` 和 `{ok:false,error:{code,message}}`。不返回 token 或内部 `_wire`。单次结果最多 1 MiB，超过时要求缩小筛选，不静默截断。分页导出返回 `hasMore`，不能把第一页当成完整导出。

写入工具携带明确的非只读注解，必须使用 UUID `requestId`；编辑等操作要求 `qianji_get_bill` 返回的 `revision` 作为 `expected`。沿用网页门禁，不能通过 MCP 指定 `testing` 或设置测试账本。真实验证未完成的操作仍关闭；未知结果先核查，同一请求不会重复提交。协议模拟测试不代表真实钱迹写入验证。

## Traefik 主机部署示例

MCP 已在 `compose.home.yaml` 中启用。OpenAI tunnel 使用独立覆盖文件 `compose.tunnel.yaml`，官方镜像固定为 `ghcr.io/openai/tunnel-client:v0.0.14`，升级时查官方最新发布并重新验证。

1. 在 [OpenAI Tunnels 设置](https://platform.openai.com/settings/organization/tunnels) 创建 tunnel，关联你的目标 ChatGPT 工作区。准备具备 Tunnels Read + Use 权限的运行密钥；创建/管理 tunnel 另需 Read + Manage。
2. 将运行密钥写入 **自己的服务器上**的私有文件，例如 `/srv/qianji/secrets/openai_tunnel_key`，权限设为 `600`，父目录 `700`。不发送到聊天，不写进 Compose 或 Git。
3. 在部署目录执行（替换真实 tunnel ID）：

```bash
cd /srv/qianji
python3 scripts/configure-tunnel.py \
  --tunnel-id tunnel_你的真实ID \
  --key-file /srv/qianji/secrets/openai_tunnel_key
docker compose config --quiet
docker compose up -d --no-build
```

配置脚本保留其他 `.env` 项，将 `COMPOSE_FILE` 设为 `compose.home.yaml:compose.tunnel.yaml`，开启 `chatgpt` profile，密钥以 Docker secret 文件挂载。脚本不会打印密钥；旧 `.env` 保存为 `.env.before-tunnel`。目录及 `.env` 必须随主机备份管理。

检查 MCP 和 tunnel readiness：

```bash
docker compose ps
docker compose exec -T qianji node -e "fetch('http://127.0.0.1:3002/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)})"
docker compose exec -T qianji node -e "fetch('http://127.0.0.1:8080/readyz').then(r=>{console.log('tunnel readiness:',r.status);process.exit(r.ok?0:1)})"
```

只有 `/readyz` 成功才代表 tunnel 已可用于连接；MCP `/health` 成功不能证明 OpenAI tunnel 已连通。管理 UI 可用 SSH 本地转发至容器命名空间中的回环端口进行检查，不要将其接到公网 Traefik。

由于两个服务共享网络命名空间，升级钱迹时使用已配置的完整 `docker compose up -d --no-build`，同时处理 tunnel 依赖，不能只通过 `docker restart` 替换容器命名空间。可以先 `docker compose stop qianji-tunnel`，再更新钱迹和 tunnel。

暂停 tunnel：`docker compose stop qianji-tunnel`。撤销账号：网页设置中断开 MCP。密钥轮换后运行 `docker compose up -d --force-recreate qianji-tunnel`。备份包含 `data/`（数据库、`.key`）、私有 `secrets/` 和部署 `.env`；恢复后再次检查连接目标。

本地开发可设置 `ENABLE_MCP=true npm run dev`，用 MCP Inspector 或 SDK 客户端连接 `http://127.0.0.1:3002/mcp`。本机其他受信任进程也能访问无鉴权 MCP。

## 连接 ChatGPT 自定义插件

1. 在 ChatGPT 设置的 Security and login 中启用 Developer mode（实际可用性由账号/工作区策略决定）。
2. 打开 [ChatGPT Plugins](https://chatgpt.com/plugins)，点击加号。名称填「钱迹」，描述可用「查询个人账本、分析收支与预算，执行已验证的账单操作」。
3. Connection 选择 **Tunnel**，选择创建的 tunnel 或填写 `tunnel_id`；身份验证选择 **No authentication / 无鉴权**。
4. 创建后检查发现的 15 个工具，在新对话中启用连接。
5. 元数据变化后，在 ChatGPT 中刷新该连接并开启新对话。

若 tunnel 不可见，检查关联的工作区与 Tunnels Read + Use 权限。若工具发现失败，先检查 `/readyz`，再检查 MCP 可达性。此部署用于个人自定义连接；官方 Secure MCP Tunnel 不支持公开插件目录分发，公开上架需要另行设计稳定公网端点及认证。

## 可选插件包

`plugins/qianji` 包含已校验的兼容格式 manifest、`.app.json` 与钱迹操作技能。当前 `.app.json` 的 apps 为空：真实 ChatGPT 应用 ID 只能在注册后获得，不能用 tunnel ID 冒充，也不能伪造。

在 ChatGPT 创建连接后，从页面 URL 复制真实 `plugin_asdk_app_...` 或 `asdk_app_...` ID，执行：

```bash
python3 scripts/configure-plugin.py plugin_asdk_app_你的真实ID
```

脚本写入 `.app.json` 的必需应用引用。包中刻意不声明指向内网的 `.mcp.json`；网页版 ChatGPT 通过已注册的 tunnel 应用调用。注册连接本身已可用于自定义工具，技能包的安装/分发是独立步骤，尚未执行。没有创建个人 marketplace，也没有将插件安装到当前用户账号。

## 验证记录

- 后端：SDK 真实 HTTP initialize / tools/list / tools/call，无 Authorization 或 Cookie；缺少绑定、撤销绑定、加密与重启恢复、备份恢复、大整数、金额精度、分页导出、统计一致性、未知响应、错误处理、Host/Origin、异常 JSON、GET/DELETE 状态和写入门禁。
- 浏览器：演示隔离、真实协议的脱敏登录夹具、连接 MCP、刷新保持连接、断开、账本/筛选/统计/预算/导出、桌面和手机布局。
- 数据与写入测试全部使用本地脱敏夹具，不使用真实账单，不修改真实钱迹账号。
- OpenAI tunnel 的实际 readiness、ChatGPT 工具发现和自然语言调用需配置真实 tunnel 后验证；没有配置不能标为完成。

建议 ChatGPT 验收：查询本月分类支出；筛选一周内餐饮账单；查看预算；分页导出；查询不存在 ID；尝试未验证的写入应明确拒绝；断开网页 MCP 后查询应报未连接。只有真实 ChatGPT 对话通过后再记录该层验收成功。

## 官方资料

- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [连接并测试插件](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [插件打包](https://developers.openai.com/plugins/build/plugins)
- [OpenAI tunnel-client Docker 部署](https://github.com/openai/tunnel-client/blob/main/docs/deployment/docker.md)
