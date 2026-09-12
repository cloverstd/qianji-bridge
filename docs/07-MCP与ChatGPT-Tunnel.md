# 钱迹 MCP 与 ChatGPT Secure MCP Tunnel

## 当前实现

钱迹后端与 MCP 共用 `server/account-service.ts`，包含 15 个工具。MCP 使用官方 TypeScript SDK 的 Streamable HTTP 无状态传输；不要求 Authorization、OAuth、API key 或浏览器 Cookie。

MCP 仅绑定 `127.0.0.1:3002`，不通过 Traefik，也不发布 Docker 端口。镜像内置官方 `tunnel-client`，由应用管理子进程，通过 `http://127.0.0.1:3002/mcp` 调用服务，出站连接 OpenAI。网页仍使用 https://qianji.example.com 。

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

## 网页配置（推荐）

官方 GHCR 镜像内置固定版本的 Tunnel 客户端。启用 `ENABLE_MCP=true` 后，打开「设置 → ChatGPT / MCP」：

1. 点击「连接当前账号到 MCP」。演示账号不能绑定或配置 Tunnel。
2. 在 OpenAI Tunnels 设置创建 Tunnel，关联目标 ChatGPT 工作区，准备 Tunnels Read + Use 运行密钥。
3. 填写 Tunnel ID 和运行密钥，点击「保存并连接 Tunnel」。保存成功只代表配置已保存，连接状态随后自动刷新。
4. 等待「已就绪」，再按下文步骤在 ChatGPT 创建连接。页面也提供可展开的接入说明。

支持修改 ID、替换密钥（留空保留已有密钥）、重新连接、停用和删除配置。Tunnel 配置绑定首次保存的账号，其他账号和演示账号不能读取或修改；切换账号前由原账号删除配置。所有修改要求网页会话和同源校验，不提供 MCP 管理工具。

Tunnel ID、运行密钥和启用状态整体使用 AES-256-GCM 加密存入 SQLite 的 `integrations` 表；密钥不回显、不写入 Compose、`.env`、日志或启动命令。仅在客户端子进程环境中使用。正常数据库备份连同 `data/.key` 即可恢复；恢复后已启用的 Tunnel 自动启动。删除配置不会删除历史备份中的密钥，需要撤销密钥时请在 OpenAI 端轮换。

状态每 5 秒刷新，页面隐藏时暂停刷新。服务同时检查客户端 `/readyz` 和官方 `commands_poll_last_successful_timestamp_seconds` 指标：只有本地就绪且最近 90 秒内成功轮询 OpenAI 才显示「已就绪」；首次等待超过 75 秒仍未连接显示异常。展示最近成功轮询时间；过期、缺失或不可读取的指标不会误报成功。客户端异常退出会最多自动重试 5 次，也可手动重新连接。停用会保留配置，删除会停止进程并清除当前配置。

MCP 仍使用 `127.0.0.1:3002`；内置客户端健康和管理端口固定为容器回环 `127.0.0.1:18080`，不对外暴露。网页后端只读取必要状态，不代理管理 UI 或原始日志。无需 Docker socket 或特权容器。

普通 Compose 可在 `.env` 设置 `ENABLE_MCP=true` 后运行 `docker compose up -d --no-build`。Traefik 示例默认开启 MCP。源码运行需预先安装客户端并设置 `TUNNEL_CLIENT_PATH`；镜像已内置。`ENABLE_MANAGED_TUNNEL=false` 可禁用网页管理。

## 独立 Tunnel 容器（兼容原部署）

如果继续使用独立容器，覆盖文件会设置 `ENABLE_MANAGED_TUNNEL=false`，避免两个客户端同时运行。此模式在服务器配置和查看状态，网页管理显示不可用。OpenAI tunnel 使用独立覆盖文件 `compose.tunnel.yaml`，官方镜像固定为 `ghcr.io/openai/tunnel-client:v0.0.14`，升级时查官方最新发布并重新验证。

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

`/readyz` 只表示本地依赖就绪；还需核对管理 UI 中的轮询情况或 `/metrics` 最近成功轮询时间，才能确认与 OpenAI 连通。管理 UI 可用 SSH 本地转发至容器命名空间中的回环端口进行检查，不要将其接到公网 Traefik。

由于两个服务共享网络命名空间，升级钱迹时使用已配置的完整 `docker compose up -d --no-build`，同时处理 tunnel 依赖，不能只通过 `docker restart` 替换容器命名空间。可以先 `docker compose stop qianji-tunnel`，再更新钱迹和 tunnel。

暂停 tunnel：`docker compose stop qianji-tunnel`。撤销账号：网页设置中断开 MCP。密钥轮换后运行 `docker compose up -d --force-recreate qianji-tunnel`。备份包含 `data/`（数据库、`.key`）、私有 `secrets/` 和部署 `.env`；恢复后再次检查连接目标。

从独立容器迁移至网页管理时，先停止 `qianji-tunnel`，在部署 `.env` 将 `COMPOSE_FILE` 恢复为 `compose.home.yaml`，移除 `COMPOSE_PROFILES=chatgpt`，再更新应用并在网页重新填写配置。不会自动导入旧的明文 secret。

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
- 网页 Tunnel：配置校验、账号归属、同源保护、加密与重启恢复、子进程启动/停止/重连、并发修改、缺失二进制、异常退出、未发生或过期轮询不误报成功；浏览器验证配置、密钥不回显、重连、删除及手机布局。使用隔离的本地模拟客户端；生产镜像另验证官方二进制启动与断网状态。
- OpenAI tunnel 的实际 readiness、ChatGPT 工具发现和自然语言调用需配置真实 tunnel 后验证；没有配置不能标为完成。

建议 ChatGPT 验收：查询本月分类支出；筛选一周内餐饮账单；查看预算；分页导出；查询不存在 ID；尝试未验证的写入应明确拒绝；断开网页 MCP 后查询应报未连接。只有真实 ChatGPT 对话通过后再记录该层验收成功。

## 官方资料

- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [连接并测试插件](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [插件打包](https://developers.openai.com/plugins/build/plugins)
- [OpenAI tunnel-client Docker 部署](https://github.com/openai/tunnel-client/blob/main/docs/deployment/docker.md)
