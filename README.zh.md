# dsh-session-reference

[English](README.md) | [简体中文](README.zh.md)

一个可独立安装的 DeepSeek Harness 只读跨会话引用插件包。

这个包完整拥有以下功能：

- 从当前 DSH Home 的历史会话列表提供 `@` 菜单候选项；
- 优先排列与当前会话工作目录相同的候选项；
- 通过 `ReferenceInsert` 及其 codec 插入宽度随标题响应式变化的 `@标题` 胶囊；
- 使用规范的 `dsh-session:` mention 格式完成复制、持久化和提交序列化；
- 在消息发送时读取引用会话的当前可见内容，生成有大小限制的投影，并持久化为不受信任的 recall 上下文。

DeepSeek Harness 主仓库只提供通用的输入源、引用展示、会话查询和 pre-step 扩展点，不会默认挂载本功能。

插件要求 DeepSeek Harness `0.1.0-rc.5`。DSH 启动器通过维护的 profile fallback 提供兼容的 Host 和浏览器服务。相关 peer dependency 对包管理器标记为可选，是因为 profile 不会再次安装这些 DSH 内置包。

## 安装

安装依赖并打包插件：

```sh
pnpm install
pnpm run pack:plugin
```

将生成的 tarball 安装到 Web profile：

```sh
dsh plugin --profile web add ./dsh-session-reference-0.1.0.tgz
dsh --profile web --dump-config
dsh --profile web
```

卸载插件：

```sh
dsh plugin --profile web remove dsh-session-reference
```

默认情况下，每条消息最多包含三个会话引用，每个被引用来源最多读取 65,536 字节的 UTF-8 内容。如果部署环境需要更小的限制，请覆盖 profile 的 `cordis.patch.yml` 中唯一的 `session-reference` 配置行。
