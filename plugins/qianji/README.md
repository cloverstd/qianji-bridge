# 钱迹个人插件

通过已注册的 ChatGPT Secure MCP Tunnel 连接钱迹。MCP 工具不要求应用层鉴权，账号在钱迹网页设置中绑定和撤销。

本包尚未关联 ChatGPT 应用：先按项目 `docs/07-MCP与ChatGPT-Tunnel.md` 创建 tunnel 连接，再执行 `python3 scripts/configure-plugin.py <真实应用ID>`。当前 `.app.json` 为空，不代表已安装或已连接。

技能提供工具使用、金额精度、分页与写入核查规则。仅用于个人自部署，不提交到公共插件目录。
