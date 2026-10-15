# 第三方来源与许可证

本地工作台新增代码以 MIT 许可证发布；第三方文件保留各自许可证。

| 组件 | 来源与版本 | 许可证位置 |
| --- | --- | --- |
| 抖音浏览器接口选段 | Yht20927/douyin-cli，提交 4073159bea585de6d33a4747a475669440737932 | vendor/LICENSE、vendor/ORIGIN.txt |
| MCP Server / Core | @modelcontextprotocol/server、@modelcontextprotocol/core 2.3.1 | vendor/MCP-SERVER-LICENSE、vendor/MCP-CORE-LICENSE |
| MCP Node adapter | @modelcontextprotocol/node 2.1.1 | vendor/MCP-NODE-LICENSE |
| Electron | 44.7.2 | 安装包内 LICENSE.electron.txt、LICENSES.chromium.html |

MCP SDK 许可证文件包含历史 MIT 部分及 Apache-2.0 新贡献条款，应保留完整声明。其余 npm 依赖的版本锁定在 package-lock.json，许可证随对应包提供。

浏览器接口的修改包括：只保留所需方法、移除通用网络 eval 入口和随机发布元数据、移除原始响应输出、保留 64 位会话 ID。私信回执仍未经真实平台验证。

本仓库未合入 MediaCrawler、DouyinAINexus-D 或其他非商业许可项目的代码，也不携带上游仓库的登录配置和提交历史。
