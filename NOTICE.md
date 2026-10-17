# NOTICE

本仓库是非官方兼容性修复，与 DeepSeek 无隶属或背书关系。

## 上游

- **dsh-purge** — MIT，作者/维护者：YuJunZhiXue 及 contributors。
  <https://github.com/YuJunZhiXue/dsh-purge>
- **dsh-purge-cwd-fix** — MIT，上游 `{{cwd}}` 与 registry 扫描兼容修复的
  contributors。本仓库包含其两个 patch 文件，供参考/手工应用。
- **DeepSeek Harness / @deepseek-ai/*** — 名称与源码归其各自所有者。
  本仓库不包含、不重新分发 dsh、dsh-purge 或 DeepSeek Harness 的完整源文件；
  只包含原创脚本、文档和最小兼容性补丁/插入块。

## 许可

本仓库的脚本、文档、原创补丁以 MIT 发布，见 `LICENSE`。
上游 patch 文件保留其 MIT 许可与版权，见 `LICENSE.upstream`。
dsh-purge 自身的 MIT 许可适用于其源码；本仓库不分发该源码。

## 安全与适用性

- 补丁只修改文档中列出的 6 个安装文件；
- 不修改会话、凭据、设置、端口、代理；
- 使用前请阅读 `README.md`、`docs/03-fixes.md`、`docs/04-verification.md`；
- 版本不匹配时脚本会中止，不要强行应用；
- 任何生产/受控环境使用前，请自行备份并评估。
