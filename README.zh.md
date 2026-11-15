# dsh-mistral-pro

**在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）中接入 Mistral 订阅（Vibe Pro / Team）的模型提供方插件。** 提供 `mistral-pro` 模型路由、多账号故障切换、提示词缓存调优，以及侧边栏额度卡片与统计面板。

![version](https://img.shields.io/badge/version-0.7.0-555?style=flat-square) ![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.5-4c84f4?style=flat-square) ![license](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square) ![EN · 中 · 日](https://img.shields.io/badge/EN%20%C2%B7%20%E4%B8%AD%20%C2%B7%20%E6%97%A5-555?style=flat-square)

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md)

![Mistral Pro 统计面板：Vibe 与 API 预算及重置倒计时、提示词缓存统计与已配置账号](docs/images/usage-zh.png)

## 目录

- [一览](#一览)
- [为什么用这个插件](#为什么用这个插件)
- [环境要求](#环境要求)
- [安装](#安装)
- [添加账号](#添加账号)
- [模型](#模型)
- [侧边栏额度卡片与统计面板](#侧边栏额度卡片与统计面板)
- [请求与容灾](#请求与容灾)
- [提示词缓存](#提示词缓存)
- [设置项](#设置项)
- [调试路由](#调试路由)
- [传输与 wire 日志](#传输与-wire-日志)
- [常见问题](#常见问题)
- [数据与隐私](#数据与隐私)
- [已知限制](#已知限制)
- [开发与测试](#开发与测试)
- [分支来源与上游同步](#分支来源与上游同步)
- [License](#license)

## 一览

| | |
| --- | --- |
| 模型路由 | `mistral-pro` |
| 模型目录 | 内置 19 个模型（默认显示 11 个），随 `/v1/models` 刷新 |
| 容灾 | 多账号，仅在首个流式输出前切换 |
| 提示词缓存 | `auto` / `shared` / `off` 三种 key，压缩后轮换，带命中率路由 |
| 界面 | 侧边栏额度卡片、统计面板、设置 → Mistral Pro |
| 传输 | 原生 `node:https`，可选用 `fetch` 路径 |

## 为什么用这个插件

- **在 DSH 里直接用 Mistral 模型。** 注册 `mistral-pro` 路由，内置 19 个模型（默认显示 11 个），支持 `/v1/models` 实时刷新，并可逐模型覆盖上下文窗口、最大输出和思考强度。
- **多账号容灾。** 多个 Mistral Key 按顺序尝试；在首个流式 token 之前失败的账号会被跳过并冷却 300 秒。
- **真正能命中的提示词缓存。** 稳定的前缀、`auto` / `shared` / `off` 三种缓存 key、压缩感知的 key 轮换，以及会回报真实 `cached_tokens` 的路由。
- **订阅额度一眼可见。** 输入框工具栏展示各周期额度、重置倒计时、预付余额与当月 API 消耗。
- **有测试、可观测。** 11 个回归套件、Node 22 / 24 上的 CI、`0600` 权限的 wire 日志，以及只读调试路由。

> **这是 fork。** [`lordraiden/dsh-mistral-pro`](https://github.com/lordraiden/dsh-mistral-pro) 合并了上游 `0.1.2` 之上的两条独立修复线：[`santera-pixel/dsh-mistral-pro`](https://github.com/santera-pixel/dsh-mistral-pro)（0.2.0–0.2.4）和[上游 issue #1 补丁系列](https://github.com/01NGVI-QINGYI/dsh-mistral-pro/issues/1)（0.1.3–0.1.8）。完整的合并过程见 [CHANGELOG.md](CHANGELOG.md)，版本策略见[分支来源与上游同步](#分支来源与上游同步)。

> 英文版 [README.md](README.md) 是权威版本，可能比本译文更新。

## 环境要求

- DSH `>= 0.2.1-rc.5`
- Node `^22.19.0 || >=24.0.0`
- 一个 Mistral 账号：免费档、Vibe Pro / Team 或按量付费均可

## 安装

安装固定到发布 tag 的 fork：

```sh
dsh plugin --profile web add github:lordraiden/dsh-mistral-pro#v0.4.0
```

或者写进 profile 的 `package.json` 再安装：

```json
{
  "dependencies": {
    "dsh-mistral-pro": "github:lordraiden/dsh-mistral-pro#v0.4.0"
  }
}
```

```sh
pnpm install
```

从本地检出安装时，推荐打包成 tarball，也可以直接挂载目录：

```sh
npm pack
dsh plugin --profile web add /absolute/path/to/dsh-mistral-pro-0.4.0.tgz
```

按目录添加会创建符号链接。由于 pnpm 不会为符号链接解析 `peerDependencies`，仓库内预置了指向当前 profile 共享依赖的 `node_modules/@deepseek-ai/*` 软链（打包 tarball 时不会包含）。

安装后到 **插件** 页面启用 `dsh-mistral-pro` 并刷新页面。更换已安装版本后需要重启宿主。

## 添加账号

打开 **设置 → Mistral Pro → 账号**：

1. 点击「添加账号」并填写名称（仅用于界面展示和排序）。
2. 「凭据引用」填一个环境变量名，如 `MISTRAL_API_KEY`。
3. 在密码框粘贴 API Key，点击「设置 Key」。Key 保存在 DSH 凭据存储中，前端不会回显。
4. 点击「测试」，调用一次 `/v1/models` 验证连通性。

API Key 可在 [Code › Vibe CLI](https://chat.mistral.ai/code/extensions) 页面创建。同一个 Key 通用于免费档、订阅套餐和按量付费；调用时会优先扣减套餐内的月度额度，用尽后再走按量计费。

配置多个账号时会按列表顺序调用，可用 ↑ / ↓ 调整优先级，排在第一位且已启用的为主账号。触发容灾切换后，可用账号会在当前进程内临时提为首选，不会改动配置文件。

### 两把 Key: Vibe 与 Studio

最常见的配置是「一把 Vibe Key + 一把 Studio Key 兜底」。**设置 → Mistral Pro → 密钥** 为每把 Key 提供一行：

| 行 | 凭据引用 | 账号 | 顺序 |
| --- | --- | --- | --- |
| Vibe API Key | `MISTRAL_VIBE_KEY` | `Vibe` | 主账号 |
| Studio API Key | `MISTRAL_API_KEY` | `Studio` | 备用 |

- **Vibe API Key**：Vibe CLI 使用的那把 Key。执行 `vibe --setup` 后它保存在 `~/.vibe/.env`；也可以在 Code › Extensions → Advanced → Vibe API Key 页面创建。
- **Studio API Key**：Mistral 管理后台的按量付费 Key，位于 API › API Keys。

每行都有密码框、「保存」和「测试」按钮，并显示该 Key 是否已配置。「保存」会把 Key 写入 DSH 凭据存储，并创建或更新对应账号（`Vibe` 或 `Studio`），同时保持 Vibe 在前、Studio 在后——即使你已经配置了其他账号。「测试」会对该账号调用一次 `/v1/models`。Key 的值之后不会再显示，也不会写入日志。

请求优先走 Vibe。当 Vibe 返回 402（预算耗尽）或 429（限流）时，适配器会在首个流式 token 之前切换到 Studio，失败的账号冷却 300 秒。需要两个以上账号或自定义端点时，仍可使用高级账号列表。

> **服务条款提醒。** 在官方 Vibe CLI 之外使用 Vibe Key 可能不被 Mistral 允许。是否这样做由你决定；插件不附带、也不分发任何 Key。

## 模型

**设置 → Mistral Pro → 模型** 会合并展示内置模型列表与 `/v1/models` 返回的模型。取消勾选「显示」可从模型选择器中隐藏；上下文窗口、最大输出长度和默认 `reasoning_effort`（思考强度）均可按模型单独调整。

内置目录（2026-11，共 19 个，默认显示 11 个）。有 Key 时以 `/v1/models` 为准，同一模型的别名会合并成一项：

| 模型 | 上下文 | 思考强度 |
| --- | --- | --- |
| `mistral-large-4` | 1M | low / medium / high |
| `mistral-small-2603` | 256K | none / low / medium / high |
| `mistral-medium-3-5` | 128K | none / low / medium / high |
| `zai-glm-5-3` | 1M | low / high / max |
| `zai-glm-5-3-flash` | 1M | low / high / max |
| `deepseek-v4-1-flash-1017` | 1M | none / low / high / max |
| `ministral-3-{14b,8b,3b}-25-12` | 256K | — |
| `codestral-25-08` / `codestral-latest` | 256K | — |

`mistral-large-2512`、`devstral-2512`、`mistral-medium-2508` 默认隐藏，需要时可在模型列表中开启。

## 侧边栏额度卡片与统计面板

插件会在侧边栏底部（设置旁）添加一张卡片，把两个 Mistral 钱包——Vibe 预算和 API 预算——合并成一个数字，并用双色条展示：灰色代表 Vibe，主文字色代表 API。百分比是两者的合计消耗（`已用 / 总额`），因此不会再出现 API 钱包在消耗、卡片却显示 0% 的情况。

![侧边栏额度卡片，展示 Vibe 与 API 的合计消耗](docs/images/card-en.png)

点击卡片打开统计面板：

- 每个钱包的已用 / 总额、百分比与重置倒计时；
- 预付余额与当月 API 消耗；
- 合计总额；
- 提示词缓存统计：稳态命中率、逐请求命中率区间的堆叠混合条、最近 20 次请求的迷你柱状图（sparkline）、一行摘要、容灾次数与最近一次请求；
- 已配置账号与模型数量；
- 手动刷新与最后更新时间。

缓存卡片用堆叠混合条（每个区间一段，配一行紧凑的计数图例）取代了原来的六行区间分布，并新增最近 20 次请求的迷你柱状图（每根细柱代表一次请求，高度是命中率，颜色是所属区间，悬停提示显示模型与百分比）和一行摘要，例如 `20 次请求中 18 次 ≥ 76% · 2 次冷启动`。其余缓存数字保持不变。

显示方式由 **设置 → Mistral Pro → 额度 → 侧边栏卡片显示** 控制：`auto` 在配置了账号时显示，`always` 常驻，`off` 隐藏。页面切到后台时暂停轮询，切回前台立即刷新。

额度数据来自 `api.mistral.ai/v1/billing/budget`，用你保存的 API Key 直接读取，不需要额外配置。接口返回 Vibe 和 API 两个月度预算：已用百分比、预算金额、重置时间。

如果这个 Key 没有 usage 权限（账单接口返回 403），可以改用管理站点 Cookie：

1. 登录 [Mistral Admin](https://admin.mistral.ai/organization/usage)。
2. 打开浏览器开发者工具 → Network，任选一条发往 `admin.mistral.ai` 的请求，复制完整的 `Cookie` 请求头（需包含 `ory_session_*`；若含 `csrftoken`，插件会自动附带 `X-CSRFTOKEN`）。
3. 打开 **设置 → Mistral Pro → 高级设置**，粘贴并点击「设置 Cookie」。

Cookie 路径会分别请求 `GET /subscription`、`GET /api/billing/v2/usage?month=&year=` 和 `GET /api/billing/credits`，单个接口失败不影响其余数据展示；会话过期跳转到登录页时会在面板内提示更换。

## 请求与容灾

`llm` 服务将对话交给插件适配器后，会转换为 OpenAI 兼容格式并 POST 到 `https://api.mistral.ai/v1/chat/completions`，逐行解析 SSE 流并转为 DSH 的 `StreamChunk`。历史 assistant 消息中的 reasoning 会按 Mistral 的格式要求还原为 `thinking` 块发回。

多账号切换仅在流式输出开始前触发：

- 遇到 401 / 403、402（API 预算耗尽）、429、额度耗尽、Key 缺失或格式错误时，自动尝试下一个账号，原账号默认冷却 300 秒。
- 一旦已经产出正文、思考内容或工具调用，报错时直接中止，不再中途换号，以免把两个账号的回复拼在一起。

### 流式协议

适配器在返回方向上遵守 DSH 的流式协议：

- 流式工具调用按续传分片累加，只接受非空的 `function.name`——Mistral 会在每个分片上重复 `function.name: ""`。
- 每个块只发一次 `block-start`，流式输出时思考面板不会反复折叠。
- `tool-call-delta` 上的 `id` 始终是字符串。
- 截断的流会抛出 `TRANSPORT`，而不是带着部分输出「成功」结束本轮。
- 重试策略是解析后的扁平、JSON 安全结构。
- 默认不注入 `max_tokens` 上限（`advanced.maxTokensCap` 为 `0`）：推理与正文共享补全预算，看似宽裕的上限也可能被思考内容耗尽。

## 提示词缓存

Mistral 的[提示词缓存](https://docs.mistral.ai/inference/conversations/advanced/prompt-caching)在请求共享同一**前缀**时复用已计算的 prompt token，缓存 token 按标准输入价的 10% 计费，命中数在 `usage.prompt_tokens_details.cached_tokens` 里返回。

文档里的两个事实决定了这里的每一项设计：

- `prompt_cache_key` 是**路由提示**。它「提高命中概率，但不保证命中」——是否命中取决于 API 能否找到兼容的已缓存前缀。Key 不会创建缓存，前缀的稳定性才会。
- 缓存块为 **64 token**。`cached_tokens` 永远是 64 的倍数，少于 64 token 的提示词永远不会命中。共享前缀越长，复用得越多。

插件为保证前缀稳定所做的处理：

- 不向请求注入任何易变内容（时间戳、会话 id、计数器）。
- 保持消息顺序，并把助手推理以 `thinking` 块回放，使前缀在轮次之间逐字节一致。
- 按角色确定性地丢弃非协议字段（`sanitizeMessage`），避免某一轮多出字段而改变前缀。
- 发送 `stream_options.include_usage`，否则 `cached_tokens` 根本不会被上报。

`advanced.promptCacheKey` 选择 key 的派生方式：

| 取值 | 派生方式 | 适用场景 |
| --- | --- | --- |
| `auto`（默认） | 模型 + 系统提示词 + 首条用户消息 | 单个长会话：每轮追加都保持同一个 key。 |
| `shared` | 仅模型 + 系统提示词；会话没有系统/开发者消息时回退到 `auto` | 大量短会话复用同一份（较大的）系统提示词：新会话第一轮也能命中系统提示词前缀。 |
| `off` | 不发送该字段 | 拒绝该字段的提供方或代理。 |
| 其他字符串 | 原样发送 | 自行管理 key（按工作流、团队或订阅区分）。 |

`auto` 与 `shared` 是取舍而非优劣：`auto` 隔离会话，符合 Mistral 的建议（「使用稳定的应用级标识，例如会话 ID」）；`shared` 放弃隔离以换取跨会话复用系统提示词。提供方仍会校验前缀兼容性，因此共享 key 最多只是未命中，绝不会返回其他会话的内容。

如果开头没有系统或开发者消息，就没有可复用的共享前缀，`shared` 会回退到按会话派生的 `auto` key，而不是发出一个该模型上所有会话都会共享的、仅按模型派生的 key。

压缩会重写对话前缀，因此派生 key（`auto` 与 `shared`）每次压缩后轮换一次：DSH 压缩检查点上最新的 `compactionId` 会混入哈希，让重写后的前缀拥有干净的缓存条目，而不是被归到指向旧前缀的 key 下。从不压缩的会话不受影响——它们的 key 派生逐字节一致。

插件还会发送同值的 `x-affinity` 头。该头**未公开且未经验证**：Mistral 的提示词缓存文档没有提到它，针对线上 API 的 A/B 测试也没有测出缓存命中差异（带头 7/8，不带头 8/8；唯一的未命中是第一次冷调用）。保留它是因为第三方证据表明它可能影响缓存路由，不认识它的服务器会忽略它，而移除它无法被证明是中性的——把它当作可能有帮助的提示，而不是请求会落到同一台服务器的保证。`cache.affinity` 与 `cache.reportUsage` 可单独关闭；关掉 `reportUsage` 就同时失去缓存命中数字。

要确认实际发生了什么，`GET /plugins/dsh-mistral-pro/wire?limit=20` 会为每个请求返回一条 `usage` 记录，含 `promptTokens`、`cachedTokens`、服务该请求的 `account`、`conversation` 摘要，以及除本轮新消息外全部内容的 `prefixSha256` 摘要。前缀稳定但命中率接近 0%，通常意味着提示词不足 64 token、缓存已在轮次之间过期，或者上游改写了开头的消息。

`GET /plugins/dsh-mistral-pro/cache` 会汇总整份日志的 `requests`、`promptTokens`、`cachedTokens` 和 `hitRate`，并额外给出三个回答「为什么这么低」的视图：

- `steadyState`——去掉每个会话第一条请求后的同一组数字，那条请求本来就必然冷启动；
- `distribution`——每个请求的命中率落在哪个区间（`0`、`1-25`、`26-50`、`51-75`、`76-99`、`100`）；
- `failovers` 与 `coldAfterFailover`——账号切换次数，以及切换后紧跟的那条冷请求：提示词缓存按账号隔离，这次未命中是预期行为。


### 用量口径

DSH 的 token 用量是**互不重叠**的桶：`inputTokens` 是未缓存输入，`cacheReadTokens` 是命中的缓存前缀，计费输入是两者之和。Mistral 会把缓存前缀合并进 `prompt_tokens`，因此适配器上报前会先减掉它。`/cache` 路由仍上报 prompt 总量，所以 `hitRate` 依然是 `cachedTokens / promptTokens`。

## 设置项

- **密钥**：Vibe 与 Studio 两行，带「保存」和「测试」（见[两把 Key](#两把-key-vibe-与-studio)）。
- **账号**：增删、排序、启停、写入 Key（保存并启用）、连通性测试。
- **模型**：显示开关、上下文窗口、最大输出、默认思考强度。
- **额度**：侧边栏卡片显示（`auto` / `always` / `off`）、刷新间隔、余额、提示词缓存区块，以及可选的 Cookie 兜底。
- **高级**：自动容灾、冷却、超时、目录刷新、输出上限、提示词缓存 key、缓存亲和性、流式用量上报、传输方式、代理、按钮显示模式、刷新间隔，以及可选的 Cookie 兜底。
  - **发送 x-affinity**（`cache.affinity`，默认开启）：把缓存 key 作为 `x-affinity` 发送；这是一个未公开、未经验证的缓存路由提示（见[提示词缓存](#提示词缓存)）。
  - **上报流式用量**（`cache.reportUsage`，默认开启）：发送 `stream_options.include_usage`；关闭它也会隐藏 `cachedTokens` 计数。
  - **显示 Prompt 缓存命中率**（`usage.showCache`，默认开启）：统计面板中读取 `/cache` 的那一块，展示命中率、混合条、迷你柱状图、摘要行以及最近一次请求。
  - **传输方式**（`advanced.transport`，默认 `https`）：`https` 通过 `node:https` 发送已序列化的 body；`fetch` 走 `globalThis.fetch`，让进程内的包装层能看到并改写请求。

![DeepSeek Harness 中的 Mistral Pro 设置页：账号、模型与高级设置](docs/images/settings-zh.png)

所有设置项改动后立即生效，无需重启插件。

## 调试路由

插件注册了以下同源只读路由，便于排查状态：

| 路由 | 说明 |
| --- | --- |
| `/plugins/dsh-mistral-pro/health` | 账号是否就绪、已注册的 provider、模型数量 |
| `/plugins/dsh-mistral-pro/meta` | 当前生效的 usage / advanced / accounts 配置 |
| `/plugins/dsh-mistral-pro/models` | 模型目录、可见性、上下文容量与思考强度 |
| `/plugins/dsh-mistral-pro/usage?account=&force=1` | 聚合后的额度快照 |
| `/plugins/dsh-mistral-pro/test?account=` | 用指定账号测试一次 `/v1/models` |
| `/plugins/dsh-mistral-pro/refresh` | 立即刷新远端模型目录 |
| `/plugins/dsh-mistral-pro/settings` | 设置命名空间与 revision |
| `/plugins/dsh-mistral-pro/wire?limit=20` | 最近的 wire 指纹、逐条消息的键名布局、缓存用量、会话 id、前缀摘要与服务账号 |
| `/plugins/dsh-mistral-pro/cache` | 聚合与稳态命中率、逐请求分布、容灾次数，以及最新 20 条 usage 记录 |

## 传输与 wire 日志

聊天请求走 `node:https`，直接把适配器已经序列化好的 body 写进 socket，不经过 `globalThis.fetch`。

代理类插件会替换 `globalThis.fetch`，在请求出站时重新序列化 body。billion-context 的 ACP 循环就是其中之一：只要模型 id 命中 `/deepseek/i`，它就给每条带工具调用的 assistant 消息补上 `reasoning_content: ""`，而 `deepseek-v4-1-flash-1017` 正好命中。Mistral 不接受 assistant 消息上的这个字段，于是第一次工具调用之后的每一轮都变成 `422 extra_forbidden`。同进程里的插件无法替换 `node:https`，所以适配器构造出的字节就是真正出站的字节。

- 设 `DSH_MISTRAL_TRANSPORT=fetch` 可退回旧路径；只有在没有包装层改写请求体时才应使用。
- 配置了 `advanced.proxy` 时仍走 fetch + undici `ProxyAgent`，因为那条路径需要 dispatcher。
- 代价：走 `node:https` 时发出的流量不经过代理插件的压缩与改写。正确性优先。

每次请求都会向 `%TEMP%\dsh-mistral-wire.log` 追加一行（可用 `DSH_MISTRAL_WIRE_LOG` 改路径）：模型 id、消息条数、每条消息的 role 与键名、带 `reasoning_content` 的消息数，以及序列化 body 的 16 位 SHA-256。第二条 `usage` 行记录 `promptTokens`、`cachedTokens`、服务账号 `account`、`conversation` 摘要、`prefixSha256`、`messages` 与 `prefixMessages`；账号切换会追加一条 `failover` 行，含 `from`、`to` 与失败码。日志保留 400 行，写日志失败不会影响请求。

日志以 `0600` 权限创建：`%TEMP%` 通常是 `/tmp`（`1777`），而日志条目是提示词元数据。如果旧版本留下了全局可读的文件，下一次写入会把它收紧到 `0600`，轮转也会保持该权限。

## 常见问题

### 免费档能用吗？

能。同一个 API Key 通用于免费档、订阅套餐和按量付费；调用时优先扣减套餐内的月度额度，用尽后再走按量计费。

### 去哪里创建 Mistral API Key？

Vibe Key 在执行 `vibe --setup` 后位于 `~/.vibe/.env`，也可以在 Code › Extensions → Advanced → Vibe API Key 页面创建；Studio Key 在 Mistral 管理后台的 API › API Keys 页面创建。两把 Key 都粘贴到 **设置 → Mistral Pro → 密钥**，见[两把 Key](#两把-key-vibe-与-studio)。

### 支持工具调用、思考内容和图片吗？

支持。流式工具调用会跨续传分片累加，助手推理会以 `thinking` 块回放，图片输入使用 DSH 的 `attachments` 服务（该服务不可用时退化为文本占位符）。

### 为什么提示词缓存命中率是 0%？

通常是三种情况之一：提示词不足 64 token、缓存已在轮次之间过期，或者上游改写了开头的消息。用 `/plugins/dsh-mistral-pro/wire?limit=20` 查看每次请求的 `cachedTokens` 与 `prefixSha256`，用 `/plugins/dsh-mistral-pro/cache` 查看稳态命中率与分布——整份日志的命中率低而稳态命中率高，说明是冷启动，不是缓存坏了。

### API Key 会被发到 Mistral 以外的地方吗？

不会。对话内容仅发往你配置的 Mistral API 端点；拉取模型目录时仅携带 API Key 和 `User-Agent`；额度查询仅请求 `admin.mistral.ai` 并携带你填入的 Cookie。Key 与 Cookie 保存在宿主凭据系统中，前端只能读取「是否已配置」状态。

### 和 `01NGVI-QINGYI/dsh-mistral-pro` 有什么区别？

上游停在 `0.1.2`。本 fork 合并了建立在其上的两条独立修复线，加入 CI 与回归套件，并提供原生 `node:https` 传输、提示词缓存 key 模式、侧边栏额度卡片、统计面板和调试路由。两个仓库的版本号不可比较——见[分支来源与上游同步](#分支来源与上游同步)。

## 数据与隐私

- 对话内容仅发往你配置的 Mistral API 端点。
- 拉取模型目录时仅携带 API Key 和 `User-Agent`，不含对话内容。
- 额度查询仅请求 `admin.mistral.ai`（端点可改）并携带你填入的 Cookie。
- Key 与 Cookie 均保存在宿主凭据系统中，前端只能读取「是否已配置」状态。

## 已知限制

- `/v1/billing/budget` 与管理站点的额度接口都没有公开文档，插件按字段名读取；上游调整结构时部分窗口可能无法识别。
- `prompt_cache_key` 只是提示而非保证：前缀稳定也可能在提供方缓存过期后未命中，少于 64 token 的提示词永远不会命中。
- 容灾切换后的账号顺位只保留在内存中，进程重启后恢复为配置顺序。
- 图片输入依赖 DSH 的 `attachments` 服务；缺失时会退化为文本占位符。
- 代理功能要求宿主环境可解析 `undici`，否则请求会直接报错。

## 开发与测试

```sh
npm test                  # 每个 test/*.mjs 套件，无网络、无 key
npm run check             # 对每个随包发布的 JS 文件执行 node --check
node test/tool-name.mjs   # 或直接运行单个套件
```

测试针对本地模拟 Mistral SSE 流的 mock HTTP 服务运行，不发起外部网络请求，也不需要 API Key。

## 分支来源与上游同步

```text
01NGVI-QINGYI 0.1.2 (263a4f0)
├── santera-pixel 0.2.0 … 0.2.4
└── 上游 issue #1 补丁系列 0.1.3 … 0.1.8
        └── 本 fork 0.3.0 → 0.4.0
```

本 fork 通过 cherry-pick 具体修复来跟踪上游 [`01NGVI-QINGYI/dsh-mistral-pro`](https://github.com/01NGVI-QINGYI/dsh-mistral-pro)，绝不合并上游 `main`，因为那会回退 0.2.x/0.3.0 的工作。先添加一次 remote，再查看有什么新内容：

```sh
git remote add upstream https://github.com/01NGVI-QINGYI/dsh-mistral-pro
git fetch upstream --depth=50
git log --oneline upstream/main
```

两条 `0.x` 版本线相互独立：一个仓库里的数字更大，不代表另一个仓库的代码更新。合并策略、版本策略以及如何在 [CHANGELOG.md](CHANGELOG.md) 中记录一次同步，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

MIT · 最初由 01NGVI-QINGYI 编写，fork 由 lordraiden 维护。
