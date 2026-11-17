/**
 * dsh-mistral-pro browser half.
 *
 * Three contributions: a settings page that manages subscription accounts,
 * models, usage display and transport settings; a sidebar footer card that
 * shows the combined subscription usage; and the statistics panel that card
 * opens in the centre column. Both usage surfaces read the Host's existing
 * routes. All data crosses the same-origin plugin route or the generated
 * settings/credentials Remote namespaces; the API key never reaches the
 * browser.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mistral-pro',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const NS = 'mistral-pro'
    const API = '/plugins/dsh-mistral-pro'

    const EN = {
      sectionTitle: 'Mistral Pro',
      sectionSubtitle: 'Mistral subscription accounts, models and usage',
      keysTitle: 'Keys',
      keysHint:
        'Paste each key once. Vibe is tried first, Studio second; extra accounts and custom base URLs stay under Accounts.',
      keyVibeLabel: 'Vibe API key',
      keyStudioLabel: 'Studio API key',
      keyStatusConfigured: 'configured',
      keyStatusMissing: 'not configured',
      saveKey: 'Save',
      accountsTitle: 'Accounts',
      accountsHint:
        'Requests try accounts from top to bottom. A key that fails authentication, rate limiting or quota is skipped before any text is produced.',
      accountsEmpty: 'No account yet. Add one to start using Mistral models.',
      addAccount: 'Add account',
      nameLabel: 'Account name',
      namePlaceholder: 'e.g. work',
      keyRefLabel: 'Credential reference',
      keyRefHint: 'Environment-variable name the key is stored under, e.g. MISTRAL_API_KEY.',
      baseURLLabel: 'Base URL',
      baseURLHint: 'Leave empty to use the provider default.',
      enabledLabel: 'Enabled',
      configured: 'Key configured',
      missing: 'No key',
      setKey: 'Set key',
      replaceKey: 'Replace key',
      clearKey: 'Clear key',
      remove: 'Remove',
      moveUp: 'Up',
      moveDown: 'Down',
      test: 'Test',
      testing: 'Testing…',
      testOk: 'Reachable · {count} models',
      testFailed: 'Failed: {message}',
      keySaved: 'Key stored.',
      keyCleared: 'Key cleared.',
      saveAccounts: 'Save accounts',
      saveModels: 'Save models',
      configure: 'Configure',
      collapse: 'Collapse',
      saveKeyEnable: 'Save & enable',
      cookieFallbackHint: 'Optional: an admin-site cookie is only needed when the key cannot read billing.',
      saveUsage: 'Save usage settings',
      saved: 'Saved.',
      saveFailed: 'Could not save: {message}',
      modelsTitle: 'Models',
      modelsHint: 'Hidden models disappear from the model selector. Capacity overrides apply to the next request.',
      refreshModels: 'Refresh from Mistral',
      refreshing: 'Refreshing…',
      visible: 'Visible',
      contextWindow: 'Context window',
      maxTokens: 'Max output',
      reasoning: 'Default effort',
      restoreDefaults: 'Restore defaults',
      modelsEmpty: 'No models discovered yet. Add an account, then refresh.',
      usageTitle: 'Subscription usage',
      usageHint:
        'Usage is read with the API key from /v1/billing/budget. If the key lacks the usage permission, add an admin-site cookie as a fallback.',
      cookieRef: 'Cookie credential reference',
      cookieSet: 'Cookie configured',
      cookieMissing: 'No cookie',
      setCookie: 'Set cookie',
      clearCookie: 'Clear cookie',
      displayLabel: 'Sidebar card visibility',
      displayAuto: 'When an account is configured',
      displayAlways: 'Always',
      displayOff: 'Hidden',
      refreshSeconds: 'Refresh interval (seconds)',
      showCredits: 'Show credit balance',
      showCache: 'Show prompt-cache hit rate',
      credits: 'Credits',
      spend: 'API spend this month',
      updated: 'Updated {when}',
      refresh: 'Refresh',
      advancedTitle: 'Advanced',
      failover: 'Automatic account failover',
      routingTitle: 'Routing',
      routingHint: 'Which key is tried first, and whether a failed key falls back to the other.',
      priorityVibe: 'Vibe first',
      priorityStudio: 'Studio first',
      priorityAuto: 'Automatic',
      priorityHint: 'Vibe first and Studio first keep that order and never promote a fallback. Automatic promotes the account that last worked.',
      fallbackHint: 'When the first key is out of budget or rate-limited, try the other before failing.',
      routingSaved: 'Routing saved.',
      routingOrderHint: 'Vibe and Studio order is set by Routing; other accounts keep their own order.',
      cooldown: 'Failed-account cooldown (seconds)',
      requestTimeout: 'Request timeout (ms)',
      streamIdle: 'Stream idle timeout (ms)',
      modelsRefresh: 'Model catalog refresh (minutes)',
      maxTokensCap: 'Default output cap (tokens)',
      promptCacheKey: 'Prompt cache key (empty = auto, "off" = disable)',
      cacheAffinity: 'Send x-affinity (undocumented cache-routing hint)',
      cacheReportUsage: 'Report stream usage (cached tokens)',
      cacheReportUsageHint: 'Turning this off also hides cached-token counts.',
      transport: 'Transport',
      transportHint: 'https posts the serialized body over node:https (default, correct); fetch lets in-process wrappers see and rewrite the request.',
      proxy: 'Proxy URL (http/https/socks5)',
      saveAdvanced: 'Save advanced settings',
      advancedSaved: 'Advanced settings saved.',
      panelClose: 'Close',
      panelSetup: 'Open Settings → Mistral Pro to add an account and an API key.',
      panelNoData: 'No usage data yet.',
      panelUnavailable: 'Usage unavailable',
      cardTitle: 'Usage card',
      cardNoAccount: 'no account',
      cardUnavailable: 'unavailable',
      cardNoData: '—',
      subscriptionTitle: 'Subscription',
      combinedTotal: 'Combined total',
      resetsIn: 'Resets in {when}',
      accountPrimary: 'primary',
      accountDisabled: 'disabled',
      modelsCount: '{count} models',
      loading: 'Loading…',
      timeNow: 'now',
      timeMinutesAgo: '{n} min ago',
      timeMinutesShort: '{n} min',
      timeHours: '{n} h',
      timeDays: '{n} d',
      searchModels: 'Search models',
      onlyVisible: 'Only visible',
      panelCookieTitle: 'The API key could not read usage',
      panelCookieBody: 'The billing endpoints refused this key; it may lack the usage permission. An admin-site cookie can read the same numbers.',
      panelCookieSteps: 'Sign in to admin.mistral.ai, copy the Cookie header from any request, and paste it under Settings → Mistral Pro → Advanced.',
      panelOpenAdmin: 'Open Mistral Admin',
      cacheTitle: 'Prompt cache',
      cacheTokens: '{cached} / {total} prompt tokens cached',
      cacheLast: 'Last request: {rate} · {model}',
      cacheEmpty: 'No cached requests recorded yet.',
      cacheUnavailable: 'Cache statistics are unavailable.',
      cacheRefresh: 'Refresh cache',
      cacheHitRate: 'Hit rate',
      cacheRequests: 'Requests',
      cacheFailovers: 'Failovers',
      cacheColdAfterFailover: 'Cold after failover',
      cacheMix: 'Hit-rate mix',
      cacheRecent: 'Last 20 requests',
      cacheSummary: '{high} of {total} requests ≥ 76% · {cold} cold starts',
      cacheSparkTitle: '{model} · {rate}',
      cacheSteady: 'steady state (log window)',
      windowVibe: 'Vibe budget',
      windowApi: 'API budget',
      windowBudget: 'Monthly budget',
    }

    const ZH = {
      sectionTitle: 'Mistral Pro',
      sectionSubtitle: 'Mistral 订阅账号、模型与额度',
      keysTitle: '密钥',
      keysHint: '每个 Key 只需粘贴一次。Vibe 优先，Studio 其次；其他账号与自定义接口地址仍在“账号”中管理。',
      keyVibeLabel: 'Vibe API Key',
      keyStudioLabel: 'Studio API Key',
      keyStatusConfigured: '已配置',
      keyStatusMissing: '未配置',
      saveKey: '保存',
      accountsTitle: '账号',
      accountsHint: '请求按从上到下的顺序尝试。鉴权失败、限流或额度耗尽的 Key 会在开始输出文字前被跳过。',
      accountsEmpty: '还没有账号，添加一个即可使用 Mistral 模型。',
      addAccount: '添加账号',
      nameLabel: '账号名称',
      namePlaceholder: '例如：工作号',
      keyRefLabel: '凭据引用',
      keyRefHint: '保存 Key 的环境变量名，例如 MISTRAL_API_KEY。',
      baseURLLabel: '接口地址',
      baseURLHint: '留空使用默认地址。',
      enabledLabel: '启用',
      configured: '已配置 Key',
      missing: '未配置 Key',
      setKey: '设置 Key',
      replaceKey: '更换 Key',
      clearKey: '清除 Key',
      remove: '删除',
      moveUp: '上移',
      moveDown: '下移',
      test: '测试',
      testing: '测试中…',
      testOk: '连接成功 · {count} 个模型',
      testFailed: '失败：{message}',
      keySaved: 'Key 已保存。',
      keyCleared: 'Key 已清除。',
      saveAccounts: '保存账号',
      saveModels: '保存模型',
      configure: '设置',
      collapse: '收起',
      saveKeyEnable: '保存并启用',
      cookieFallbackHint: '可选：只有 Key 读不到账单时，才需要配置管理站点 Cookie。',
      saveUsage: '保存额度设置',
      saved: '已保存。',
      saveFailed: '保存失败：{message}',
      modelsTitle: '模型',
      modelsHint: '隐藏的模型不会出现在模型选择器中。容量覆盖从下一次请求开始生效。',
      refreshModels: '从 Mistral 刷新',
      refreshing: '刷新中…',
      visible: '显示',
      contextWindow: '上下文窗口',
      maxTokens: '最大输出',
      reasoning: '默认思考强度',
      restoreDefaults: '恢复默认',
      modelsEmpty: '还没有发现模型。先添加账号，然后刷新。',
      usageTitle: '订阅额度',
      usageHint:
        '额度由 API Key 直接读取（/v1/billing/budget）。如果这个 Key 没有 usage 权限，再配置管理站点的 Cookie 作为兜底。',
      cookieRef: 'Cookie 凭据引用',
      cookieSet: '已配置 Cookie',
      cookieMissing: '未配置 Cookie',
      setCookie: '设置 Cookie',
      clearCookie: '清除 Cookie',
      displayLabel: '侧边栏卡片显示',
      displayAuto: '已配置账号时显示',
      displayAlways: '常驻',
      displayOff: '隐藏',
      refreshSeconds: '刷新间隔（秒）',
      showCredits: '显示余额',
      showCache: '显示 Prompt 缓存命中率',
      credits: '余额',
      spend: '本月 API 消费',
      updated: '{when}更新',
      refresh: '刷新',
      advancedTitle: '高级设置',
      failover: '自动切换备用账号',
      routingTitle: '路由',
      routingHint: '先尝试哪把 Key，以及失败后是否切换到另一把。',
      priorityVibe: 'Vibe 优先',
      priorityStudio: 'Studio 优先',
      priorityAuto: '自动',
      priorityHint: 'Vibe 优先和 Studio 优先会固定该顺序，不会把备用账号提升为主账号；自动模式会提升最近成功的账号。',
      fallbackHint: '第一把 Key 额度耗尽或被限流时，先尝试另一把再报错。',
      routingSaved: '路由已保存。',
      routingOrderHint: 'Vibe 与 Studio 的顺序由「路由」决定；其他账号保持自己的顺序。',
      cooldown: '失败账号冷却（秒）',
      requestTimeout: '请求超时（毫秒）',
      streamIdle: '流空闲超时（毫秒）',
      modelsRefresh: '模型目录刷新（分钟）',
      maxTokensCap: '默认输出上限（token）',
      promptCacheKey: 'Prompt 缓存键（留空=自动，"off"=关闭）',
      cacheAffinity: '发送 x-affinity（未文档化的缓存路由提示）',
      cacheReportUsage: '上报流式用量（缓存 token）',
      cacheReportUsageHint: '关闭后也将看不到缓存命中的 token 数。',
      transport: '传输方式',
      transportHint: 'https 通过 node:https 发送序列化后的请求体（默认，推荐）；fetch 允许进程内的包装层读取并改写请求。',
      proxy: '代理地址（http/https/socks5）',
      saveAdvanced: '保存高级设置',
      advancedSaved: '高级设置已保存。',
      panelClose: '关闭',
      panelSetup: '打开 设置 → Mistral Pro 添加账号与 API Key。',
      panelNoData: '暂无用量数据。',
      panelUnavailable: '额度不可用',
      cardTitle: '额度卡片',
      cardNoAccount: '未配置账号',
      cardUnavailable: '不可用',
      cardNoData: '—',
      subscriptionTitle: '订阅',
      combinedTotal: '合计',
      resetsIn: '{when}后重置',
      accountPrimary: '主账号',
      accountDisabled: '已停用',
      modelsCount: '{count} 个模型',
      loading: '加载中…',
      timeNow: '刚刚',
      timeMinutesAgo: '{n} 分钟前',
      timeMinutesShort: '{n} 分钟',
      timeHours: '{n} 小时',
      timeDays: '{n} 天',
      searchModels: '搜索模型',
      onlyVisible: '只看已启用',
      panelCookieTitle: 'API Key 读取额度失败',
      panelCookieBody: '账单接口拒绝了这个 Key，可能是缺少 usage 权限。也可以用管理站点 Cookie 读取同样的数据。',
      panelCookieSteps: '登录 admin.mistral.ai，从任意请求复制 Cookie 头，粘贴到 设置 → Mistral Pro → 高级设置。',
      panelOpenAdmin: '打开 Mistral Admin',
      cacheTitle: 'Prompt 缓存',
      cacheTokens: '{cached} / {total} 个 prompt token 命中缓存',
      cacheLast: '最近一次：{rate} · {model}',
      cacheEmpty: '还没有记录到缓存请求。',
      cacheUnavailable: '缓存统计不可用。',
      cacheRefresh: '刷新缓存',
      cacheHitRate: '命中率',
      cacheRequests: '请求数',
      cacheFailovers: '故障切换',
      cacheColdAfterFailover: '切换后冷启动',
      cacheMix: '命中率分布',
      cacheRecent: '最近 20 次请求',
      cacheSummary: '{total} 次请求中 {high} 次 ≥ 76% · {cold} 次冷启动',
      cacheSparkTitle: '{model} · {rate}',
      cacheSteady: '稳态（日志窗口）',
      windowVibe: 'Vibe 额度',
      windowApi: 'API 额度',
      windowBudget: '月度预算',
    }

    const JA = {
      sectionTitle: 'Mistral Pro',
      sectionSubtitle: 'Mistral サブスクリプションのアカウント・モデル・使用量',
      keysTitle: 'キー',
      keysHint: '各キーは一度貼り付けるだけです。Vibe が先、Studio が次に試され、その他のアカウントとカスタム URL は「アカウント」で管理します。',
      keyVibeLabel: 'Vibe API キー',
      keyStudioLabel: 'Studio API キー',
      keyStatusConfigured: '設定済み',
      keyStatusMissing: '未設定',
      saveKey: '保存',
      accountsTitle: 'アカウント',
      accountsHint:
        'リクエストは上から順に試されます。認証失敗・レート制限・枠の枯渇が起きたキーは、出力が始まる前にスキップされます。',
      accountsEmpty: 'アカウントがありません。追加すると Mistral モデルを使えます。',
      addAccount: 'アカウントを追加',
      nameLabel: 'アカウント名',
      namePlaceholder: '例: work',
      keyRefLabel: 'クレデンシャル参照',
      keyRefHint: 'キーの保存先となる環境変数名（例: MISTRAL_API_KEY）。',
      baseURLLabel: 'ベース URL',
      baseURLHint: '空欄なら既定のエンドポイントを使います。',
      enabledLabel: '有効',
      configured: 'キー設定済み',
      missing: 'キー未設定',
      setKey: 'キーを設定',
      replaceKey: 'キーを変更',
      clearKey: 'キーを削除',
      remove: '削除',
      moveUp: '上へ',
      moveDown: '下へ',
      test: 'テスト',
      testing: 'テスト中…',
      testOk: '接続 OK · {count} モデル',
      testFailed: '失敗: {message}',
      keySaved: 'キーを保存しました。',
      keyCleared: 'キーを削除しました。',
      saveAccounts: 'アカウントを保存',
      saved: '保存しました。',
      saveFailed: '保存できませんでした: {message}',
      modelsTitle: 'モデル',
      modelsHint: '非表示にしたモデルは選択リストから消えます。容量の上書きは次のリクエストから反映されます。',
      refreshModels: 'Mistral から更新',
      refreshing: '更新中…',
      visible: '表示',
      contextWindow: 'コンテキスト',
      maxTokens: '最大出力',
      reasoning: '既定の推論強度',
      restoreDefaults: '既定に戻す',
      modelsEmpty: 'モデルがまだありません。アカウントを追加して更新してください。',
      usageTitle: 'サブスクリプション使用量',
      usageHint:
        '使用量は API キーで /v1/billing/budget から取得します。キーに usage 権限がない場合は、管理サイトの Cookie をフォールバックとして設定してください。',
      cookieRef: 'Cookie クレデンシャル参照',
      cookieSet: 'Cookie 設定済み',
      cookieMissing: 'Cookie 未設定',
      setCookie: 'Cookie を設定',
      clearCookie: 'Cookie を削除',
      displayLabel: 'サイドバーカードの表示',
      displayAuto: 'アカウント設定時に表示',
      displayAlways: '常に表示',
      displayOff: '非表示',
      refreshSeconds: '更新間隔（秒）',
      showCredits: '残高を表示',
      showCache: 'プロンプトキャッシュのヒット率を表示',
      credits: '残高',
      spend: '今月の API 利用額',
      updated: '最終更新: {when}',
      refresh: '更新',
      advancedTitle: '詳細設定',
      failover: 'アカウントの自動フェイルオーバー',
      routingTitle: 'ルーティング',
      routingHint: 'どちらのキーを先に試すか、失敗時に切り替えるか。',
      priorityVibe: 'Vibe 優先',
      priorityStudio: 'Studio 優先',
      priorityAuto: '自動',
      priorityHint: 'Vibe 優先と Studio 優先はその順序を固定し、フォールバックを昇格しません。自動は最後に成功したアカウントを昇格します。',
      fallbackHint: '最初のキーが予算切れかレート制限のとき、エラーにする前に別のキーを試します。',
      routingSaved: 'ルーティングを保存しました。',
      routingOrderHint: 'Vibe と Studio の順序は「ルーティング」で決まります。他のアカウントは独自の順序を保ちます。',
      cooldown: '失敗アカウントのクールダウン（秒）',
      requestTimeout: 'リクエストタイムアウト（ms）',
      streamIdle: 'ストリームのアイドルタイムアウト（ms）',
      modelsRefresh: 'モデルカタログの更新間隔（分）',
      maxTokensCap: '既定の出力上限（トークン）',
      promptCacheKey: 'プロンプトキャッシュキー（空=自動、"off"=無効）',
      cacheAffinity: 'x-affinity を送信（未文書化のキャッシュルーティングヒント）',
      cacheReportUsage: 'ストリームの使用量を報告（キャッシュトークン）',
      cacheReportUsageHint: 'オフにするとキャッシュヒットのトークン数も見えなくなります。',
      transport: 'トランスポート',
      transportHint: 'https はシリアライズした本文を node:https で送信します（既定・推奨）。fetch はプロセス内のラッパーがリクエストを参照・書き換えできます。',
      proxy: 'プロキシ URL（http/https/socks5）',
      saveAdvanced: '詳細設定を保存',
      advancedSaved: '詳細設定を保存しました。',
      saveModels: 'モデルを保存',
      configure: '設定',
      collapse: '閉じる',
      saveKeyEnable: '保存して有効化',
      cookieFallbackHint: '任意: キーで請求を読めない場合のみ、管理サイトの Cookie が必要です。',
      saveUsage: '使用量設定を保存',
      panelClose: '閉じる',
      panelSetup: '設定 → Mistral Pro でアカウントと API キーを追加してください。',
      panelNoData: '使用量データはまだありません。',
      panelUnavailable: '使用量を取得できません',
      cardTitle: '使用量カード',
      cardNoAccount: 'アカウント未設定',
      cardUnavailable: '取得不可',
      cardNoData: '—',
      subscriptionTitle: 'サブスクリプション',
      combinedTotal: '合計',
      resetsIn: '{when}後にリセット',
      accountPrimary: 'プライマリ',
      accountDisabled: '無効',
      modelsCount: '{count} モデル',
      loading: '読み込み中…',
      timeNow: 'たった今',
      timeMinutesAgo: '{n} 分前',
      timeMinutesShort: '{n} 分',
      timeHours: '{n} 時間',
      timeDays: '{n} 日',
      searchModels: 'モデルを検索',
      onlyVisible: '表示中のみ',
      panelCookieTitle: 'API キーでは使用量を取得できませんでした',
      panelCookieBody: '請求エンドポイントがこのキーを拒否しました。usage 権限がない可能性があります。管理サイトの Cookie でも同じ数値を取得できます。',
      panelCookieSteps: 'admin.mistral.ai にログインし、任意のリクエストから Cookie ヘッダーをコピーして Settings → Mistral Pro → Advanced に貼り付けてください。',
      panelOpenAdmin: 'Mistral Admin を開く',
      cacheTitle: 'プロンプトキャッシュ',
      cacheTokens: 'プロンプト {cached} / {total} トークンがキャッシュ済み',
      cacheLast: '直近のリクエスト: {rate} · {model}',
      cacheEmpty: 'キャッシュされたリクエストはまだありません。',
      cacheUnavailable: 'キャッシュ統計を取得できません。',
      cacheRefresh: 'キャッシュを更新',
      cacheHitRate: 'ヒット率',
      cacheRequests: 'リクエスト数',
      cacheFailovers: 'フェイルオーバー',
      cacheColdAfterFailover: '切替後のコールド',
      cacheMix: 'ヒット率の分布',
      cacheRecent: '直近 20 リクエスト',
      cacheSummary: '{total} 件中 {high} 件が 76% 以上 · コールドスタート {cold} 件',
      cacheSparkTitle: '{model} · {rate}',
      cacheSteady: '定常状態（ログ範囲）',
      windowVibe: 'Vibe 使用枠',
      windowApi: 'API 使用枠',
      windowBudget: '月次予算',
    }

    const S = {
      card: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        padding: '12px 14px',
        marginBottom: 12,
        minWidth: 0,
        boxSizing: 'border-box',
      },
      title: { color: 'var(--dsw-alias-label-primary)', fontSize: 14, fontWeight: 600, margin: 0 },
      hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.5, margin: '4px 0 0' },
      label: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, display: 'block', marginBottom: 4 },
      input: {
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        padding: '6px 8px',
        fontSize: 13,
        width: '100%',
        boxSizing: 'border-box',
      },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      button: {
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        padding: '5px 10px',
        fontSize: 12,
        cursor: 'pointer',
      },
      primary: {
        background: 'var(--dsw-alias-label-primary)',
        color: 'var(--dsw-alias-bg-base)',
        border: '1px solid var(--dsw-alias-label-primary)',
        borderRadius: 6,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      },
      ok: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12 },
      warn: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 12 },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 },
    }

    async function callRemote(ctx, namespace, method, ...args) {
      const result = await ctx.remote[namespace][method](...args)
      if (result === null || typeof result !== 'object' || result.ok !== true) {
        const failure = result?.error
        throw new Error(failure?.message ?? `${namespace}.${method} failed`)
      }
      return result.value
    }

    async function getJSON(path) {
      const response = await fetch(`${API}${path}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    function fill(template, params) {
      return template.replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? ''))
    }

    function money(value, unit) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const symbol = unit === 'USD' || unit === undefined ? '$' : unit === 'EUR' ? '€' : ''
      return `${symbol}${value.toFixed(2)}${symbol === '' ? ` ${unit}` : ''}`
    }

    function when(iso, t) {
      if (typeof iso !== 'string' || iso === '') return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const delta = date.getTime() - Date.now()
      const days = Math.round(delta / 86400000)
      if (days > 1) return fill(t('timeDays'), { n: days })
      const hours = Math.round(delta / 3600000)
      if (hours >= 1) return fill(t('timeHours'), { n: hours })
      const minutes = Math.max(0, Math.round(delta / 60000))
      return fill(t('timeMinutesShort'), { n: minutes })
    }

    function updated(ts, t) {
      if (typeof ts !== 'number') return ''
      const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000))
      return minutes <= 0 ? t('timeNow') : fill(t('timeMinutesAgo'), { n: minutes })
    }

    function ratePercent(rate) {
      if (typeof rate !== 'number' || !Number.isFinite(rate)) return '—'
      return `${Math.round(rate * 100)}%`
    }

    function formatCount(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return Math.round(value).toLocaleString()
    }

    function Field({ label, hint, children }) {
      return h('div', { style: { marginBottom: 10 } }, h('span', { style: S.label }, label), children, hint ? h('p', { style: S.hint }, hint) : null)
    }

    function Notice({ notice }) {
      if (notice === null || notice === undefined) return null
      return h('p', { style: notice.kind === 'error' ? S.error : S.ok }, notice.text)
    }

    function serializeAccounts(accounts) {
      return accounts.map((account) => ({
        name: account.name.trim() === '' ? 'default' : account.name.trim(),
        apiKeyEnv: account.apiKeyEnv.trim() === '' ? 'MISTRAL_API_KEY' : account.apiKeyEnv.trim(),
        baseURL: '',
        enabled: account.enabled !== false,
      }))
    }

    /**
     * The two first-class keys: account name, credential ref and label key.
     * The order here is the order the accounts are written in.
     */
    const KEY_ROWS = [
      { name: 'Vibe', ref: 'MISTRAL_VIBE_KEY', labelKey: 'keyVibeLabel' },
      { name: 'Studio', ref: 'MISTRAL_API_KEY', labelKey: 'keyStudioLabel' },
    ]

    /** Canonical order of the two key accounts; mirrors lib/config.js. */
    const KEY_ACCOUNT_ORDER = ['Vibe', 'Studio']

    /**
     * Create or update one of the two key accounts, returning a new array.
     *
     * The browser bundle cannot import the server ESM module, so this mirrors
     * `upsertKeyAccount` in lib/config.js (which test/key-accounts.mjs pins):
     * the key accounts lead in Vibe, Studio order and every other account
     * keeps its relative order. The input is never mutated.
     */
    function upsertKeyAccount(accounts, { name, ref }) {
      const list = Array.isArray(accounts) ? accounts : []
      const index = list.findIndex((account) => account?.name === name)
      const entry =
        index === -1
          ? { name, apiKeyEnv: ref, baseURL: '', enabled: true }
          : { ...list[index], name, apiKeyEnv: ref, enabled: true }
      const next = index === -1 ? [...list, entry] : list.map((account, position) => (position === index ? entry : account))
      const rank = (account) => {
        const position = KEY_ACCOUNT_ORDER.indexOf(account?.name)
        return position === -1 ? KEY_ACCOUNT_ORDER.length : position
      }
      // Array#sort is stable, so the non-key accounts keep their relative order.
      return next.sort((left, right) => rank(left) - rank(right))
    }

    /** Serialize accounts for the settings patch, keeping custom base URLs. */
    function serializeKeyAccounts(accounts) {
      return accounts.map((account) => ({
        name: account.name.trim() === '' ? 'default' : account.name.trim(),
        apiKeyEnv: account.apiKeyEnv.trim() === '' ? 'MISTRAL_API_KEY' : account.apiKeyEnv.trim(),
        baseURL: typeof account.baseURL === 'string' ? account.baseURL : '',
        enabled: account.enabled !== false,
      }))
    }

    // ── Settings page ────────────────────────────────────────────────────────

    function SettingsSection({ ctx, t }) {
      const [state, setState] = useState({ status: 'loading', meta: null, value: null, revision: undefined, creds: {}, models: [], error: null })
      const [draft, setDraft] = useState(null)
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState(false)
      const [keyDraft, setKeyDraft] = useState({})
      const [keyNotice, setKeyNotice] = useState({})
      const [cookieDraft, setCookieDraft] = useState('')
      const [testing, setTesting] = useState({})
      const [modelQuery, setModelQuery] = useState('')
      const [onlyVisible, setOnlyVisible] = useState(false)
      const [expandedModel, setExpandedModel] = useState(null)

      const load = useCallback(async () => {
        try {
          const meta = await getJSON('/meta')
          const described = await callRemote(ctx, 'settings', 'describe')
          const view = described.namespaces.find((entry) => entry.ns === meta.settingsNs)
          const value = view?.value ?? {}
          const refs = new Set([meta.usage.adminCookieEnv, 'MISTRAL_API_KEY', 'MISTRAL_VIBE_KEY'])
          for (const account of value.accounts ?? []) if (account?.apiKeyEnv) refs.add(account.apiKeyEnv)
          const creds = await callRemote(ctx, 'credentials', 'describe', Array.from(refs))
          const models = ((await getJSON('/models')).models ?? []).map((model) => ({
            ...model,
            originalContextWindow: model.contextWindow,
            originalMaxTokens: model.maxTokens,
            originalReasoning: model.defaultReasoning ?? '',
            reasoningEffort: model.defaultReasoning ?? '',
          }))
          setState({ status: 'ready', meta, value, revision: view?.revision, creds, models, error: null })
          setDraft({
            accounts: (value.accounts && value.accounts.length > 0 ? value.accounts : [{ name: 'default', apiKeyEnv: 'MISTRAL_API_KEY', baseURL: '', enabled: true }]).map((account) => ({
              name: account.name ?? '',
              apiKeyEnv: account.apiKeyEnv ?? 'MISTRAL_API_KEY',
              baseURL: account.baseURL && account.baseURL !== meta.baseURL ? account.baseURL : '',
              enabled: account.enabled !== false,
            })),
            usage: {
              display: value.usage?.display ?? meta.usage.display ?? 'auto',
              refreshSeconds: value.usage?.refreshSeconds ?? meta.usage.refreshSeconds ?? 60,
              adminCookieEnv: value.usage?.adminCookieEnv ?? meta.usage.adminCookieEnv ?? 'MISTRAL_ADMIN_COOKIE',
              showCredits: value.usage?.showCredits !== false,
              showCache: value.usage?.showCache !== false,
            },
            advanced: { ...meta.advanced, ...(value.advanced ?? {}) },
            cache: {
              affinity: value.cache?.affinity !== false,
              reportUsage: value.cache?.reportUsage !== false,
            },
          })
        } catch (error) {
          setState((current) => ({ ...current, status: 'error', error: String(error?.message ?? error) }))
        }
      }, [ctx])

      useEffect(() => {
        void load()
      }, [load])

      const update = useCallback(
        async (patch, successText) => {
          if (state.meta === null) return
          setBusy(true)
          setNotice(null)
          try {
            await callRemote(ctx, 'settings', 'update', state.meta.settingsNs, patch, state.revision)
            setNotice({ kind: 'ok', text: successText ?? t('saved') })
            await load()
          } catch (error) {
            setNotice({ kind: 'error', text: fill(t('saveFailed'), { message: String(error?.message ?? error) }) })
          } finally {
            setBusy(false)
          }
        },
        [ctx, load, state.meta, state.revision, t],
      )

      const setKey = useCallback(
        async (ref, nextAccounts) => {
          const value = keyDraft[ref]
          if (typeof value !== 'string' || value.trim() === '') return
          setBusy(true)
          try {
            await callRemote(ctx, 'credentials', 'set', ref, value.trim())
            if (Array.isArray(nextAccounts) && state.meta !== null) {
              await callRemote(ctx, 'settings', 'update', state.meta.settingsNs, { accounts: serializeAccounts(nextAccounts) }, state.revision)
            }
            setKeyDraft((current) => ({ ...current, [ref]: '' }))
            setNotice({ kind: 'ok', text: t('keySaved') })
            await load()
          } catch (error) {
            setNotice({ kind: 'error', text: fill(t('saveFailed'), { message: String(error?.message ?? error) }) })
          } finally {
            setBusy(false)
          }
        },
        [ctx, keyDraft, load, state.meta, state.revision, t],
      )

      const clearKey = useCallback(
        async (ref) => {
          setBusy(true)
          try {
            await callRemote(ctx, 'credentials', 'unset', ref)
            setNotice({ kind: 'ok', text: t('keyCleared') })
            await load()
          } catch (error) {
            setNotice({ kind: 'error', text: fill(t('saveFailed'), { message: String(error?.message ?? error) }) })
          } finally {
            setBusy(false)
          }
        },
        [ctx, load, t],
      )

      const testAccount = useCallback(
        async (name) => {
          setTesting((current) => ({ ...current, [name]: true }))
          try {
            const result = await getJSON(`/test?account=${encodeURIComponent(name)}`)
            if (result.ok) setNotice({ kind: 'ok', text: fill(t('testOk'), { count: result.count }) })
            else setNotice({ kind: 'error', text: fill(t('testFailed'), { message: result.error?.message ?? 'unknown' }) })
          } catch (error) {
            setNotice({ kind: 'error', text: fill(t('testFailed'), { message: String(error?.message ?? error) }) })
          } finally {
            setTesting((current) => ({ ...current, [name]: false }))
          }
        },
        [t],
      )

      /**
       * Store one key row: write the credential, then upsert the account in the
       * persisted settings array (Vibe first, Studio second) and save it. The
       * key value only ever travels to the credentials Remote; it is never put
       * into a notice or the rendered output.
       */
      const persistKeyRow = useCallback(
        async (row) => {
          const value = keyDraft[row.ref]
          if (typeof value !== 'string' || value.trim() === '') return false
          await callRemote(ctx, 'credentials', 'set', row.ref, value.trim())
          if (state.meta !== null) {
            const next = upsertKeyAccount(state.value?.accounts ?? [], { name: row.name, ref: row.ref })
            await callRemote(
              ctx,
              'settings',
              'update',
              state.meta.settingsNs,
              { accounts: serializeKeyAccounts(next) },
              state.revision,
            )
          }
          setKeyDraft((current) => ({ ...current, [row.ref]: '' }))
          return true
        },
        [ctx, keyDraft, state.meta, state.revision, state.value],
      )

      const saveKeyRow = useCallback(
        async (row) => {
          setBusy(true)
          setKeyNotice((current) => ({ ...current, [row.ref]: null }))
          try {
            const saved = await persistKeyRow(row)
            if (!saved) return
            setKeyNotice((current) => ({ ...current, [row.ref]: { kind: 'ok', text: t('keySaved') } }))
            await load()
          } catch (error) {
            setKeyNotice((current) => ({
              ...current,
              [row.ref]: { kind: 'error', text: fill(t('saveFailed'), { message: String(error?.message ?? error) }) },
            }))
          } finally {
            setBusy(false)
          }
        },
        [load, persistKeyRow, t],
      )

      const testKeyRow = useCallback(
        async (row) => {
          setBusy(true)
          setTesting((current) => ({ ...current, [row.name]: true }))
          setKeyNotice((current) => ({ ...current, [row.ref]: null }))
          try {
            const saved = await persistKeyRow(row)
            if (saved) await load()
            const result = await getJSON(`/test?account=${encodeURIComponent(row.name)}`)
            setKeyNotice((current) => ({
              ...current,
              [row.ref]: result.ok
                ? { kind: 'ok', text: fill(t('testOk'), { count: result.count }) }
                : { kind: 'error', text: fill(t('testFailed'), { message: result.error?.message ?? 'unknown' }) },
            }))
          } catch (error) {
            setKeyNotice((current) => ({
              ...current,
              [row.ref]: { kind: 'error', text: fill(t('testFailed'), { message: String(error?.message ?? error) }) },
            }))
          } finally {
            setTesting((current) => ({ ...current, [row.name]: false }))
            setBusy(false)
          }
        },
        [load, persistKeyRow, t],
      )

      if (state.status === 'loading') return h('p', { style: S.hint }, t('loading'))
      if (state.status === 'error') return h('p', { style: S.error }, state.error)
      if (draft === null) return h('p', { style: S.hint }, t('loading'))

      const accounts = draft.accounts
      const setAccounts = (next) => setDraft({ ...draft, accounts: next })
      const setUsage = (next) => setDraft({ ...draft, usage: { ...draft.usage, ...next } })
      const setAdvanced = (next) => setDraft({ ...draft, advanced: { ...draft.advanced, ...next } })
      const setCache = (next) => setDraft({ ...draft, cache: { ...draft.cache, ...next } })

      const saveAccounts = () => update({ accounts: serializeAccounts(accounts) }, t('saved'))

      const saveModels = () => {
        const models = {}
        for (const model of state.models) {
          const override = {}
          if (model.visible === false) override.visible = false
          if (model.contextWindow !== model.originalContextWindow) override.contextWindow = model.contextWindow
          if (model.maxTokens !== model.originalMaxTokens) override.maxTokens = model.maxTokens
          if (model.reasoningEffort && model.reasoningEffort !== model.originalReasoning) override.reasoningEffort = model.reasoningEffort
          if (Object.keys(override).length > 0) models[model.id] = override
        }
        return update({ models }, t('saved'))
      }

      const saveUsage = () => update({ usage: draft.usage }, t('saved'))
      const saveAdvanced = () => update({ advanced: draft.advanced, usage: draft.usage, cache: draft.cache }, t('advancedSaved'))

      // Routing saves immediately: the priority also reorders the two key
      // accounts so the account list below never contradicts the choice.
      //
      // This is a plain function, not a useCallback: it sits after the early
      // returns above, so a hook here would change the hook count between the
      // loading render and the ready render and React would throw, leaving the
      // whole settings section blank.
      const applyRouting = async (patch) => {
        const nextAdvanced = { ...draft.advanced, ...patch }
        let nextAccounts = draft.accounts
        if (patch.priority !== undefined && patch.priority !== 'auto') {
          const first = patch.priority === 'studio-first' ? 'Studio' : 'Vibe'
          const second = first === 'Vibe' ? 'Studio' : 'Vibe'
          const rank = (account) => (account.name === first ? 0 : account.name === second ? 1 : 2)
          nextAccounts = [...draft.accounts].sort((left, right) => rank(left) - rank(right))
          setAccounts(nextAccounts)
        }
        setAdvanced(nextAdvanced)
        await update({ advanced: nextAdvanced, accounts: serializeKeyAccounts(nextAccounts) }, t('routingSaved'))
      }

      const setModel = (id, patch) =>
        setState((current) => ({
          ...current,
          models: current.models.map((model) => (model.id === id ? { ...model, ...patch } : model)),
        }))

      return h(
        'div',
        { style: { paddingBottom: 24, width: '100%', minWidth: 0, boxSizing: 'border-box' } },
        h('h2', { style: { ...S.title, fontSize: 18, marginBottom: 2 } }, t('sectionTitle')),
        h('p', { style: { ...S.hint, marginBottom: 14 } }, t('sectionSubtitle')),
        h(Notice, { notice }),

        // Keys: the two first-class credentials, one row each.
        h(
          'section',
          { style: S.card },
          h('h3', { style: S.title }, t('keysTitle')),
          h('p', { style: S.hint }, t('keysHint')),
          KEY_ROWS.map((row) => {
            const configured = state.creds[row.ref]?.configured === true
            const rowNotice = keyNotice[row.ref]
            return h(
              'div',
              { key: row.ref, style: { ...S.card, background: 'var(--dsw-alias-bg-layer-2)', marginTop: 10 } },
              h(
                'div',
                { style: { ...S.row, justifyContent: 'space-between' } },
                h('span', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 600 } }, t(row.labelKey)),
                h('span', { style: configured ? S.ok : S.warn }, configured ? t('keyStatusConfigured') : t('keyStatusMissing')),
              ),
              h(
                'div',
                { style: { ...S.row, marginTop: 8 } },
                h('input', {
                  style: { ...S.input, flex: '1 1 200px', width: 'auto', minWidth: 0 },
                  type: 'password',
                  autoComplete: 'off',
                  placeholder: t('setKey'),
                  value: keyDraft[row.ref] ?? '',
                  onChange: (event) => setKeyDraft((current) => ({ ...current, [row.ref]: event.target.value })),
                }),
                h('button', {
                  style: S.primary,
                  disabled: busy || (keyDraft[row.ref] ?? '').trim() === '',
                  onClick: () => void saveKeyRow(row),
                }, t('saveKey')),
                h('button', {
                  style: S.button,
                  disabled: busy || testing[row.name] === true,
                  onClick: () => void testKeyRow(row),
                }, testing[row.name] ? t('testing') : t('test')),
              ),
              rowNotice ? h('p', { style: rowNotice.kind === 'error' ? S.error : S.ok }, rowNotice.text) : null,
            )
          }),
        ),

        // Routing: which key is tried first and whether a failure falls back.
        h(
          'section',
          { style: S.card },
          h('h3', { style: S.title }, t('routingTitle')),
          h('p', { style: S.hint }, t('routingHint')),
          h(
            'div',
            { style: { ...S.row, gap: 6, marginTop: 10, flexWrap: 'wrap' } },
            [
              ['vibe-first', 'priorityVibe'],
              ['studio-first', 'priorityStudio'],
              ['auto', 'priorityAuto'],
            ].map(([value, labelKey]) =>
              h(
                'button',
                {
                  key: value,
                  style: draft.advanced.priority === value ? S.primary : S.button,
                  disabled: busy,
                  onClick: () => void applyRouting({ priority: value }),
                },
                t(labelKey),
              ),
            ),
          ),
          h('p', { style: S.hint }, t('priorityHint')),
          h(
            'label',
            { style: { ...S.row, gap: 6, marginTop: 10 } },
            h('input', {
              type: 'checkbox',
              checked: draft.advanced.failover !== false,
              disabled: busy,
              onChange: (event) => void applyRouting({ failover: event.target.checked }),
            }),
            t('failover'),
          ),
          h('p', { style: S.hint }, t('fallbackHint')),
        ),

        // Accounts
        h(
          'section',
          { style: S.card },
          h('h3', { style: S.title }, t('accountsTitle')),
          h('p', { style: S.hint }, t('accountsHint')),
          accounts.length === 0 ? h('p', { style: S.hint }, t('accountsEmpty')) : null,
          accounts.map((account, index) =>
            h(
              'div',
              { key: `${account.name}-${index}`, style: { ...S.card, background: 'var(--dsw-alias-bg-layer-2)', marginTop: 10 } },
              h(Field, { label: t('nameLabel') }, h('input', {
                style: S.input,
                value: account.name,
                placeholder: t('namePlaceholder'),
                onChange: (event) => setAccounts(accounts.map((entry, position) => (position === index ? { ...entry, name: event.target.value } : entry))),
                onBlur: () => void saveAccounts(),
              })),
              h(
                'div',
                { style: { ...S.row, marginTop: 4 } },
                h('label', { style: { ...S.row, gap: 4 } }, h('input', {
                  type: 'checkbox',
                  checked: account.enabled !== false,
                  onChange: (event) => setAccounts(accounts.map((entry, position) => (position === index ? { ...entry, enabled: event.target.checked } : entry))),
                }), t('enabledLabel')),
                h('span', { style: state.creds[account.apiKeyEnv]?.configured ? S.ok : S.warn }, state.creds[account.apiKeyEnv]?.configured ? t('configured') : t('missing')),
              ),
              h(
                'div',
                { style: { ...S.row, marginTop: 8 } },
                h('input', {
                  style: { ...S.input, flex: '1 1 180px', width: 'auto', minWidth: 0 },
                  type: 'password',
                  placeholder: t('setKey'),
                  value: keyDraft[account.apiKeyEnv] ?? '',
                  onChange: (event) => setKeyDraft((current) => ({ ...current, [account.apiKeyEnv]: event.target.value })),
                }),
                h('button', {
                  style: S.primary,
                  disabled: busy,
                  onClick: () =>
                    void setKey(
                      account.apiKeyEnv,
                      accounts.map((entry, position) => (position === index ? { ...entry, enabled: true } : entry)),
                    ),
                }, t('saveKeyEnable')),
                h('button', { style: S.button, disabled: busy, onClick: () => void clearKey(account.apiKeyEnv) }, t('clearKey')),
              ),
              h(
                'div',
                { style: { ...S.row, marginTop: 8 } },
                h('button', { style: S.button, disabled: testing[account.name] === true, onClick: () => void testAccount(account.name) }, testing[account.name] ? t('testing') : t('test')),
                h('button', {
                  style: S.button,
                  disabled: account.name === 'Vibe' || account.name === 'Studio' || index === 0,
                  onClick: () => {
                    const next = [...accounts]
                    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                    setAccounts(next)
                  },
                }, '↑'),
                h('button', {
                  style: S.button,
                  disabled: account.name === 'Vibe' || account.name === 'Studio' || index === accounts.length - 1,
                  onClick: () => {
                    const next = [...accounts]
                    ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                    setAccounts(next)
                  },
                }, '↓'),
                h('button', { style: S.button, onClick: () => setAccounts(accounts.filter((_, position) => position !== index)) }, t('remove')),
              ),
            ),
          ),
          h('p', { style: S.hint }, t('routingOrderHint')),
          h(
            'div',
            { style: { ...S.row, marginTop: 10 } },
            h('button', {
              style: S.button,
              onClick: () =>
                setAccounts([
                  ...accounts,
                  { name: `account-${accounts.length + 1}`, apiKeyEnv: accounts.length === 0 ? 'MISTRAL_API_KEY' : `MISTRAL_API_KEY_${accounts.length + 1}`, baseURL: '', enabled: true },
                ]),
            }, t('addAccount')),
          ),
        ),

        // Models
        h(
          'section',
          { style: S.card },
          h('h3', { style: S.title }, t('modelsTitle')),
          h('p', { style: S.hint }, t('modelsHint')),
          h(
            'div',
            { style: { ...S.row, margin: '8px 0' } },
            h('button', {
              style: S.button,
              onClick: async () => {
                setBusy(true)
                try {
                  await getJSON('/refresh')
                  await load()
                } finally {
                  setBusy(false)
                }
              },
            }, t('refreshModels')),
            h('button', { style: S.primary, disabled: busy, onClick: () => void saveModels() }, t('saveModels')),
          ),
          state.models.length === 0
            ? h('p', { style: S.hint }, t('modelsEmpty'))
            : h(
                'div',
                { style: { minWidth: 0 } },
                h(
                  'div',
                  { style: { ...S.row, margin: '4px 0 8px' } },
                  h('input', {
                    style: { ...S.input, flex: '1 1 160px', width: 'auto' },
                    placeholder: t('searchModels'),
                    value: modelQuery,
                    onChange: (event) => setModelQuery(event.target.value),
                  }),
                  h('label', { style: { ...S.row, gap: 4 } }, h('input', {
                    type: 'checkbox',
                    checked: onlyVisible,
                    onChange: (event) => setOnlyVisible(event.target.checked),
                  }), t('onlyVisible')),
                ),
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 } },
                  state.models
                    .filter((model) => {
                      if (onlyVisible && model.visible === false) return false
                      const query = modelQuery.trim().toLowerCase()
                      if (query === '') return true
                      return model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query)
                    })
                    .map((model) =>
                      h(
                        'div',
                        { key: model.id, style: { borderBottom: '1px solid var(--dsw-alias-border-l1)', minWidth: 0 } },
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', minWidth: 0 } },
                          h('input', {
                            type: 'checkbox',
                            checked: model.visible !== false,
                            onChange: (event) => setModel(model.id, { visible: event.target.checked }),
                          }),
                          h('span', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, model.name),
                          h('span', { style: { ...S.hint, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 60px' } }, model.id),
                          h('button', {
                            style: { ...S.button, flex: '0 0 auto' },
                            onClick: () => setExpandedModel(expandedModel === model.id ? null : model.id),
                          }, expandedModel === model.id ? t('collapse') : t('configure')),
                        ),
                        expandedModel === model.id
                          ? h(
                              'div',
                              { style: { display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 0 10px 26px' } },
                              h('div', { style: { flex: '1 1 120px', minWidth: 0 } },
                                h('span', { style: S.label }, t('contextWindow')),
                                h('input', { style: S.input, type: 'number', value: model.contextWindow, onChange: (event) => setModel(model.id, { contextWindow: Number(event.target.value) }) }),
                              ),
                              h('div', { style: { flex: '1 1 120px', minWidth: 0 } },
                                h('span', { style: S.label }, t('maxTokens')),
                                h('input', { style: S.input, type: 'number', value: model.maxTokens, onChange: (event) => setModel(model.id, { maxTokens: Number(event.target.value) }) }),
                              ),
                              h('div', { style: { flex: '1 1 120px', minWidth: 0 } },
                                h('span', { style: S.label }, t('reasoning')),
                                model.reasoningEfforts.length === 0
                                  ? h('div', { style: { ...S.hint, margin: 0, paddingTop: 6 } }, '—')
                                  : h(
                                      'select',
                                      { style: S.input, value: model.reasoningEffort ?? '', onChange: (event) => setModel(model.id, { reasoningEffort: event.target.value }) },
                                      h('option', { value: '' }, 'default'),
                                      model.reasoningEfforts.map((effort) => h('option', { key: effort, value: effort }, effort)),
                                    ),
                              ),
                            )
                          : null,
                      ),
                    ),
                ),
              ),
        ),



        // Advanced
        h(
          'details',
          { style: S.card },
          h('summary', { style: { ...S.title, cursor: 'pointer' } }, t('advancedTitle')),
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 8 } },
            h(Field, { label: t('cooldown') }, h('input', {
              style: S.input,
              type: 'number',
              value: draft.advanced.cooldownSeconds,
              onChange: (event) => setAdvanced({ cooldownSeconds: Number(event.target.value) }),
            })),
            h(Field, { label: t('requestTimeout') }, h('input', {
              style: S.input,
              type: 'number',
              value: draft.advanced.requestTimeoutMs,
              onChange: (event) => setAdvanced({ requestTimeoutMs: Number(event.target.value) }),
            })),
            h(Field, { label: t('streamIdle') }, h('input', {
              style: S.input,
              type: 'number',
              value: draft.advanced.streamIdleTimeoutMs,
              onChange: (event) => setAdvanced({ streamIdleTimeoutMs: Number(event.target.value) }),
            })),
            h(Field, { label: t('modelsRefresh') }, h('input', {
              style: S.input,
              type: 'number',
              value: draft.advanced.modelsRefreshMinutes,
              onChange: (event) => setAdvanced({ modelsRefreshMinutes: Number(event.target.value) }),
            })),
            h(Field, { label: t('maxTokensCap') }, h('input', {
              style: S.input,
              type: 'number',
              value: draft.advanced.maxTokensCap,
              onChange: (event) => setAdvanced({ maxTokensCap: Number(event.target.value) }),
            })),
            h(Field, { label: t('promptCacheKey') }, h('input', {
              style: S.input,
              value: draft.advanced.promptCacheKey ?? 'auto',
              placeholder: 'auto',
              onChange: (event) => setAdvanced({ promptCacheKey: event.target.value }),
            })),
            h(Field, { label: t('cacheAffinity') }, h('input', {
              type: 'checkbox',
              checked: draft.cache.affinity !== false,
              onChange: (event) => setCache({ affinity: event.target.checked }),
            })),
            h(Field, { label: t('cacheReportUsage'), hint: t('cacheReportUsageHint') }, h('input', {
              type: 'checkbox',
              checked: draft.cache.reportUsage !== false,
              onChange: (event) => setCache({ reportUsage: event.target.checked }),
            })),
            h(Field, { label: t('showCache') }, h('input', {
              type: 'checkbox',
              checked: draft.usage.showCache !== false,
              onChange: (event) => setUsage({ showCache: event.target.checked }),
            })),
            h(Field, { label: t('transport'), hint: t('transportHint') },
              h('select', {
                style: S.input,
                value: draft.advanced.transport ?? 'https',
                onChange: (event) => setAdvanced({ transport: event.target.value }),
              },
                h('option', { value: 'https' }, 'https'),
                h('option', { value: 'fetch' }, 'fetch'),
              ),
            ),
            h(Field, { label: t('displayLabel') },
              h('select', {
                style: S.input,
                value: draft.usage.display,
                onChange: (event) => setUsage({ display: event.target.value }),
              },
                h('option', { value: 'auto' }, t('displayAuto')),
                h('option', { value: 'always' }, t('displayAlways')),
                h('option', { value: 'off' }, t('displayOff')),
              ),
            ),
            h(Field, { label: t('refreshSeconds') }, h('input', {
              style: S.input,
              type: 'number',
              value: draft.usage.refreshSeconds,
              onChange: (event) => setUsage({ refreshSeconds: Number(event.target.value) }),
            })),
            h(Field, { label: t('proxy') }, h('input', {
              style: S.input,
              value: draft.advanced.proxy ?? '',
              placeholder: 'socks5://127.0.0.1:1080',
              onChange: (event) => setAdvanced({ proxy: event.target.value }),
            })),
          ),
          h('p', { style: { ...S.hint, marginTop: 12 } }, t('cookieFallbackHint')),
          h(
            'div',
            { style: { ...S.row } },
            h('span', { style: state.creds[draft.usage.adminCookieEnv]?.configured ? S.ok : S.warn }, state.creds[draft.usage.adminCookieEnv]?.configured ? t('cookieSet') : t('cookieMissing')),
            h('input', {
              style: { ...S.input, flex: '1 1 160px', width: 'auto' },
              value: draft.usage.adminCookieEnv,
              onChange: (event) => setUsage({ adminCookieEnv: event.target.value }),
            }),
            h('input', {
              style: { ...S.input, flex: '1 1 200px', width: 'auto' },
              type: 'password',
              placeholder: 'ory_session_…=…; csrftoken=…',
              value: cookieDraft,
              onChange: (event) => setCookieDraft(event.target.value),
            }),
            h('button', {
              style: S.button,
              disabled: busy || cookieDraft.trim() === '',
              onClick: async () => {
                setBusy(true)
                try {
                  await callRemote(ctx, 'credentials', 'set', draft.usage.adminCookieEnv, cookieDraft.trim())
                  setCookieDraft('')
                  setNotice({ kind: 'ok', text: t('keySaved') })
                  await load()
                } catch (error) {
                  setNotice({ kind: 'error', text: fill(t('saveFailed'), { message: String(error?.message ?? error) }) })
                } finally {
                  setBusy(false)
                }
              },
            }, t('setCookie')),
            h('button', {
              style: S.button,
              disabled: busy,
              onClick: async () => {
                setBusy(true)
                try {
                  await callRemote(ctx, 'credentials', 'unset', draft.usage.adminCookieEnv)
                  await load()
                } finally {
                  setBusy(false)
                }
              },
            }, t('clearCookie')),
          ),
          h('button', { style: S.primary, disabled: busy, onClick: () => void saveAdvanced() }, t('saveAdvanced')),
        ),
      )
    }

    // ── Sidebar usage card + statistics panel ───────────────────────────────

    /**
     * Panel id shared by the `sidebar.footer.action` card and the `main` slot
     * cell, so the card selects this panel and nothing else.
     */
    const PANEL_ID = NS

    /** Stylesheet id; prefixed with the package name so injection is idempotent. */
    const CSS_ID = 'dsh-mistral-pro/usage.module.css'

    /**
     * The card and the panel stylesheet. Every colour is a host theme alias, so
     * both surfaces follow the light/dark theme without a hard-coded palette:
     * the Vibe segment is tertiary text (grey) and the API segment is primary
     * text (white in dark, near-black in light).
     */
    const CSS = `
/* The shell renders footer actions as a flex ROW whose occupants each declare
   a full-width line, so a full-width card would overflow the column. The
   anchor is load-bearing: "footerActions" is not a stem the shell owns alone,
   so the rule is scoped under "footArea", which the sidebar alone declares.
   The descendant combinator survives an extra wrapper appearing. */
[class*="_footArea"] [class*="_footerActions"]{flex-direction:column}
.mp-foot{box-sizing:border-box;flex:0 0 auto;width:100%;min-width:0;font:inherit;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;background:0 0;border:1px solid transparent;border-radius:10px;flex-direction:column;gap:6px;margin:0 0 4px;padding:8px;display:flex}
.mp-foot:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.mp-foot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mp-footTop{align-items:baseline;gap:8px;min-width:0;display:flex}
.mp-footName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;font-size:13px;font-weight:500;line-height:20px}
.mp-footAmount{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
.mp-footPct{flex:none;width:34px;color:var(--dsw-alias-label-secondary);text-align:right;font-size:12px;line-height:16px;font-variant-numeric:tabular-nums}
/* The bar is a row of segment spans inside the track; the track itself paints
   the empty remainder, and overflow:hidden gives the ends their pill shape so
   the two segments meet without a rounded seam. */
.mp-footBar{display:flex;background:var(--dsw-alias-bg-layer-2);border-radius:999px;height:5px;overflow:hidden}
.mp-footSeg{flex:0 0 auto;display:block;height:100%;transition:width .3s ease}
.mp-footSegVibe{background:var(--dsw-alias-label-tertiary)}
.mp-footSegApi{background:var(--dsw-alias-label-primary)}
.mp-spacer{flex:1}

/* The 56px rail: one 36px icon button on the shell's own rail cell. */
.mp-railButton{box-sizing:border-box;width:36px;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid transparent;border-radius:8px;flex:none;justify-content:center;align-items:center;margin:0 0 4px;padding:0;display:inline-flex}
.mp-railButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.mp-railButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mp-glyph{flex:none;justify-content:center;align-items:center;display:inline-flex;color:var(--dsw-alias-label-secondary)}

/* ------------------------------------------------------------ statistics panel */
.mp-main{background:var(--dsw-alias-bg-layer-1);width:100%;height:100%;overflow:auto;display:block}
.mp-mainInner{max-width:760px;margin:0 auto;padding:24px 20px 40px;flex-direction:column;gap:14px;display:flex;color:var(--dsw-alias-label-primary)}
.mp-header{align-items:flex-start;gap:10px;display:flex;flex-wrap:wrap}
.mp-headerText{flex-direction:column;gap:2px;display:flex;min-width:0}
.mp-title{margin:0;font-size:18px;font-weight:600;line-height:1.4}
.mp-subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums}
.mp-close,.mp-refresh{box-sizing:border-box;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 10px;font-size:12px;line-height:18px;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.mp-close:hover,.mp-refresh:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.mp-close:focus-visible,.mp-refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mp-close{min-width:28px;padding:4px 8px}
.mp-refresh:disabled{opacity:.55;cursor:default}
.mp-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.mp-link{color:var(--dsw-alias-brand-primary);font-size:12px}
.mp-notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:12px 14px;flex-direction:column;gap:4px;display:flex}
.mp-noticeError{border-color:var(--dsw-alias-state-error-primary)}
.mp-noticeTitle{margin:0;font-size:13px;font-weight:600;line-height:1.5}
.mp-noticeError .mp-noticeTitle{color:var(--dsw-alias-state-error-primary)}
.mp-noticeHint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}

.mp-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;padding:16px 18px;flex-direction:column;gap:16px;display:flex}
.mp-cardTitle{margin:0;font-size:13px;font-weight:600;line-height:1.4}
.mp-block{flex-direction:column;gap:8px;display:flex}
.mp-blockTitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;line-height:1.5;text-transform:uppercase;letter-spacing:.04em}

.mp-windows{flex-direction:column;gap:14px;display:flex}
.mp-window{flex-direction:column;gap:6px;display:flex}
.mp-windowHead{align-items:baseline;gap:8px;display:flex}
.mp-windowLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:1.5}
.mp-windowValue{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap}
.mp-windowPct{color:var(--dsw-alias-label-primary);min-width:38px;text-align:right;font-size:12px;font-weight:600;line-height:1.5;font-variant-numeric:tabular-nums}
.mp-bar{overflow:hidden;background:var(--dsw-alias-bg-layer-1);border-radius:999px;height:5px}
.mp-barFill{height:100%;border-radius:999px;transition:width .3s ease}
.mp-barFillVibe{background:var(--dsw-alias-label-tertiary)}
.mp-barFillApi{background:var(--dsw-alias-label-primary)}
.mp-windowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}

.mp-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.mp-tile{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;flex-direction:column;gap:2px;display:flex;min-width:0}
.mp-tileLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.mp-tileValue{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4;font-variant-numeric:tabular-nums}
.mp-tileSub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.mp-mix{display:flex;background:var(--dsw-alias-bg-layer-1);border-radius:999px;height:10px;overflow:hidden}
.mp-mixSeg{display:block;height:100%;transition:width .3s ease}
.mp-bucketError{background:var(--dsw-alias-state-error-primary)}
.mp-bucketWarn{background:var(--dsw-alias-state-warn-primary)}
.mp-bucketMid{background:var(--dsw-alias-label-tertiary)}
.mp-bucketHigh{background:var(--dsw-alias-label-primary)}
.mp-bucketFull{background:var(--dsw-alias-brand-primary)}
.mp-legend{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.mp-legendItem{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}
.mp-legendDot{flex:none;width:8px;height:8px;border-radius:2px}
.mp-legendCount{color:var(--dsw-alias-label-tertiary)}
.mp-spark{display:flex;align-items:flex-end;gap:2px;height:28px;padding:2px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mp-sparkBar{flex:1 1 0;min-width:2px;max-width:10px;border-radius:2px 2px 0 0}

.mp-accounts{flex-direction:column;display:flex}
.mp-accountRow{align-items:center;gap:8px;display:flex;flex-wrap:wrap;min-width:0;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mp-accountRow:last-child{border-bottom:0}
.mp-accountName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.mp-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-brand-primary);border-radius:999px;padding:1px 8px;font-size:12px;font-weight:600;line-height:17px}
.mp-badgeMuted{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:12px;font-weight:500;line-height:17px}
.mp-badgeWarn{background:transparent;color:var(--dsw-alias-state-warn-primary)}
.mp-footer{align-items:center;gap:10px;display:flex;flex-wrap:wrap}

@media (prefers-reduced-motion:reduce){.mp-footSeg,.mp-barFill,.mp-mixSeg{transition:none}}
`

    /** Install one stylesheet by id and return a disposer for its owning effect. */
    function injectCss(id, css) {
      if (typeof document === 'undefined') return () => {}
      if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-mistral-pro'
      tag.dataset.pluginCss = id
      tag.textContent = css
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    /** Read one numeric field, accepting numeric strings (the Host payload). */
    function num(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
      return undefined
    }

    function clampPercent(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
      return Math.max(0, Math.min(100, value))
    }

    /** `api` for the API budget, `vibe` for everything else (Vibe, monthly). */
    function windowKind(window) {
      const id = String(window?.id ?? '')
      const labelKey = String(window?.labelKey ?? '')
      const label = String(window?.label ?? '')
      return id === 'api' || /api/i.test(labelKey) || /api/i.test(label) ? 'api' : 'vibe'
    }

    function windowLabel(window, t) {
      if (typeof window?.labelKey === 'string' && window.labelKey !== '') return t(window.labelKey)
      return typeof window?.label === 'string' && window.label !== '' ? window.label : '—'
    }

    /** A window's used amount, derived from percent/total when the Host omits it. */
    function windowUsed(window) {
      const used = num(window?.used)
      if (used !== undefined) return used
      const total = num(window?.total)
      const percent = num(window?.percent)
      if (percent !== undefined && total !== undefined) return (percent / 100) * total
      return undefined
    }

    /**
     * Combine every budget window into one figure: the used amounts and the
     * budgets are summed separately, and the percentage is their ratio. Only
     * windows that carry BOTH a positive total and a resolvable used amount
     * take part, so a window without a budget can never inflate the ratio.
     */
    function combinedUsage(windows) {
      const list = Array.isArray(windows) ? windows : []
      let totalUsed = 0
      let totalBudget = 0
      const segments = []
      for (const window of list) {
        const total = num(window?.total)
        if (total === undefined || total <= 0) continue
        const used = windowUsed(window)
        if (used === undefined) continue
        totalUsed += used
        totalBudget += total
        segments.push({ id: String(window?.id ?? segments.length), kind: windowKind(window), used, total })
      }
      const percent = totalBudget > 0 ? clampPercent((totalUsed / totalBudget) * 100) : undefined
      return { totalUsed, totalBudget, percent, segments }
    }

    /** A segment's share of the combined budget, in percent. */
    function segmentWidth(segment, totalBudget) {
      if (!(totalBudget > 0)) return 0
      return Math.round((segment.used / totalBudget) * 100000) / 1000
    }

    function useMeta() {
      const [meta, setMeta] = useState(null)
      useEffect(() => {
        let cancelled = false
        void getJSON('/meta')
          .then((value) => {
            if (!cancelled) setMeta(value)
          })
          .catch(() => {})
        return () => {
          cancelled = true
        }
      }, [])
      return meta
    }

    /** The quota ring: a faint track plus an arc whose sweep is the consumption. */
    function Ring({ percent, size }) {
      const clamped = clampPercent(percent) ?? 0
      const circumference = 45.55
      const dashoffset = Math.round(circumference * (1 - clamped / 100) * 1000) / 1000
      return h(
        'span',
        { className: 'mp-glyph', 'aria-hidden': 'true' },
        h(
          'svg',
          { viewBox: '0 0 20 20', width: size, height: size, focusable: 'false' },
          h('circle', { cx: 10, cy: 10, r: 7.25, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, opacity: 0.35 }),
          h('circle', {
            cx: 10,
            cy: 10,
            r: 7.25,
            fill: 'none',
            stroke: 'var(--dsw-alias-label-primary)',
            strokeWidth: 2.5,
            strokeLinecap: 'round',
            strokeDasharray: String(circumference),
            strokeDashoffset: String(dashoffset),
            transform: 'rotate(-90 10 10)',
          }),
        ),
      )
    }

    /** A labelled figure. */
    function Tile({ label, value, sub }) {
      return h(
        'div',
        { className: 'mp-tile' },
        h('span', { className: 'mp-tileLabel' }, label),
        h('span', { className: 'mp-tileValue' }, value),
        sub !== undefined && sub !== '' ? h('span', { className: 'mp-tileSub' }, sub) : null,
      )
    }

    /** One budget window: label, used / total, percent, a bar, the reset time. */
    function WindowBlock({ window, t }) {
      const kind = windowKind(window)
      const total = num(window.total)
      const used = windowUsed(window)
      const percent = clampPercent(num(window.percent) ?? (used !== undefined && total !== undefined && total > 0 ? (used / total) * 100 : undefined))
      const value = used !== undefined && total !== undefined ? `${money(used, window.unit)} / ${money(total, window.unit)}` : ''
      const label = windowLabel(window, t)
      return h(
        'div',
        { className: 'mp-window' },
        h(
          'div',
          { className: 'mp-windowHead' },
          h('span', { className: 'mp-windowLabel' }, label),
          h('span', { className: 'mp-spacer' }),
          value !== '' ? h('span', { className: 'mp-windowValue' }, value) : null,
          h('span', { className: 'mp-windowPct' }, percent === undefined ? '—' : `${Math.round(percent)}%`),
        ),
        h(
          'div',
          {
            className: 'mp-bar',
            role: 'progressbar',
            'aria-label': label,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': percent === undefined ? 0 : Math.round(percent),
          },
          h('div', {
            className: `mp-barFill mp-barFill${kind === 'api' ? 'Api' : 'Vibe'}`,
            style: { width: `${percent ?? 0}%` },
          }),
        ),
        typeof window.resetsAt === 'string' && window.resetsAt !== ''
          ? h('p', { className: 'mp-windowReset' }, fill(t('resetsIn'), { when: when(window.resetsAt, t) }))
          : null,
      )
    }

    /** The Host's hit-rate buckets, in display order. */
    const HIT_RATE_BUCKETS = ['0', '1-25', '26-50', '51-75', '76-99', '100']

    /** Severity colour class for one hit-rate bucket. */
    const BUCKET_CLASS = {
      '0': 'mp-bucketError',
      '1-25': 'mp-bucketWarn',
      '26-50': 'mp-bucketWarn',
      '51-75': 'mp-bucketMid',
      '76-99': 'mp-bucketHigh',
      '100': 'mp-bucketFull',
    }

    function bucketClass(bucket) {
      return BUCKET_CLASS[bucket] ?? 'mp-bucketMid'
    }

    /** Bucket a 0-1 hit rate exactly like lib/wire.js does. */
    function bucketForRate(rate) {
      const percent = rate * 100
      if (percent <= 0) return '0'
      if (percent >= 100) return '100'
      if (percent <= 25) return '1-25'
      if (percent <= 50) return '26-50'
      if (percent <= 75) return '51-75'
      return '76-99'
    }

    /** The prompt-cache card: steady-state hit rate, volume, mix, sparkline, last request. */
    function CacheCard({ t, cache, cacheError }) {
      const unavailable = cacheError !== null || (cache !== null && cache.ok === false)
      const steady = cache?.steadyState
      const steadyUsed = typeof steady?.requests === 'number' && steady.requests > 0
      const hitRate = steadyUsed ? steady.hitRate : cache?.hitRate
      const requests = steadyUsed ? steady.requests : cache?.requests
      const promptTokens = steadyUsed ? steady.promptTokens : cache?.promptTokens
      const cachedTokens = steadyUsed ? steady.cachedTokens : cache?.cachedTokens
      const recent = Array.isArray(cache?.recent) ? cache.recent : []
      const lastRequest = recent.length === 0 ? undefined : recent[recent.length - 1]
      const lastRate = lastRequest !== undefined && lastRequest.promptTokens > 0 ? lastRequest.cachedTokens / lastRequest.promptTokens : undefined
      const distribution = cache?.distribution !== null && typeof cache?.distribution === 'object' ? cache.distribution : {}
      // `'0'` and `'100'` are integer-like keys, so plain enumeration would put
      // them first; sort against the Host's bucket order instead.
      const buckets = Object.keys(distribution).sort((left, right) => {
        const leftIndex = HIT_RATE_BUCKETS.indexOf(left)
        const rightIndex = HIT_RATE_BUCKETS.indexOf(right)
        return (leftIndex === -1 ? HIT_RATE_BUCKETS.length : leftIndex) - (rightIndex === -1 ? HIT_RATE_BUCKETS.length : rightIndex)
      })
      const bucketTotal = buckets.reduce((sum, bucket) => sum + (Number.isFinite(distribution[bucket]) ? distribution[bucket] : 0), 0)
      const bucketCount = (bucket) => (Number.isFinite(distribution[bucket]) ? distribution[bucket] : 0)
      const nonEmptyBuckets = buckets.filter((bucket) => bucketCount(bucket) > 0)
      const highRequests = bucketCount('76-99') + bucketCount('100')

      let body
      if (unavailable) body = h('p', { className: 'mp-hint' }, t('cacheUnavailable'))
      else if (cache === null) body = h('p', { className: 'mp-hint' }, t('loading'))
      else if (requests === 0) body = h('p', { className: 'mp-hint' }, t('cacheEmpty'))
      else
        body = [
          h(
            'div',
            { className: 'mp-tiles' },
            h(Tile, { label: t('cacheHitRate'), value: ratePercent(hitRate), sub: steadyUsed ? t('cacheSteady') : undefined }),
            h(Tile, { label: t('cacheRequests'), value: formatCount(requests) }),
            h(Tile, { label: t('cacheFailovers'), value: formatCount(cache.failovers) }),
            h(Tile, { label: t('cacheColdAfterFailover'), value: formatCount(cache.coldAfterFailover) }),
          ),
          h('p', { className: 'mp-hint' }, fill(t('cacheTokens'), { cached: formatCount(cachedTokens), total: formatCount(promptTokens) })),
          // One stacked bar replaces the six near-identical rows: each segment
          // is a bucket's share of the measured requests, coloured by severity.
          bucketTotal === 0
            ? null
            : h(
                'div',
                { className: 'mp-block' },
                h('h4', { className: 'mp-blockTitle' }, t('cacheMix')),
                h(
                  'div',
                  { className: 'mp-mix', role: 'img', 'aria-label': t('cacheMix') },
                  nonEmptyBuckets.map((bucket) =>
                    h('span', {
                      key: bucket,
                      className: `mp-mixSeg ${bucketClass(bucket)}`,
                      style: { width: `${(bucketCount(bucket) / bucketTotal) * 100}%` },
                      title: `${bucket}% · ${formatCount(bucketCount(bucket))}`,
                    }),
                  ),
                ),
                h(
                  'div',
                  { className: 'mp-legend' },
                  nonEmptyBuckets.map((bucket) =>
                    h(
                      'span',
                      { key: bucket, className: 'mp-legendItem' },
                      h('span', { className: `mp-legendDot ${bucketClass(bucket)}` }),
                      h('span', null, `${bucket}%`),
                      h('span', { className: 'mp-legendCount' }, formatCount(bucketCount(bucket))),
                    ),
                  ),
                ),
              ),
          // One thin bar per recent request, height = its hit rate.
          recent.length === 0
            ? null
            : h(
                'div',
                { className: 'mp-block' },
                h('h4', { className: 'mp-blockTitle' }, t('cacheRecent')),
                h(
                  'div',
                  { className: 'mp-spark', role: 'img', 'aria-label': t('cacheRecent') },
                  recent.map((entry, index) => {
                    const rate = typeof entry.hitRate === 'number' && Number.isFinite(entry.hitRate) ? entry.hitRate : null
                    const percent = rate === null ? 0 : Math.max(0, Math.min(100, rate * 100))
                    const bucket = rate === null ? '0' : bucketForRate(rate)
                    return h('span', {
                      key: `${entry.ts ?? 'entry'}-${index}`,
                      className: `mp-sparkBar ${bucketClass(bucket)}`,
                      style: { height: `${percent}%` },
                      title: fill(t('cacheSparkTitle'), {
                        model: entry.model ?? '—',
                        rate: rate === null ? '—' : `${Math.round(percent)}%`,
                      }),
                    })
                  }),
                ),
              ),
          bucketTotal === 0
            ? null
            : h(
                'p',
                { className: 'mp-hint' },
                fill(t('cacheSummary'), {
                  high: formatCount(highRequests),
                  total: formatCount(bucketTotal),
                  cold: formatCount(cache.coldAfterFailover),
                }),
              ),
          lastRequest === undefined
            ? null
            : h('p', { className: 'mp-hint' }, fill(t('cacheLast'), { rate: ratePercent(lastRate), model: lastRequest.model ?? '—' })),
        ]

      return h(
        'section',
        { className: 'mp-card', 'aria-label': t('cacheTitle') },
        h('h3', { className: 'mp-cardTitle' }, t('cacheTitle')),
        body,
      )
    }

    /** The configured accounts and the live model count. */
    function AccountsCard({ t, meta, models }) {
      const accounts = Array.isArray(meta?.accounts) ? meta.accounts : []
      const modelCount = Array.isArray(models) ? models.length : undefined
      return h(
        'section',
        { className: 'mp-card', 'aria-label': t('accountsTitle') },
        h('h3', { className: 'mp-cardTitle' }, t('accountsTitle')),
        accounts.length === 0
          ? h('p', { className: 'mp-hint' }, t('accountsEmpty'))
          : h(
              'div',
              { className: 'mp-accounts' },
              accounts.map((account) =>
                h(
                  'div',
                  { className: 'mp-accountRow', key: account.name },
                  h('span', { className: 'mp-accountName' }, account.name),
                  account.primary === true ? h('span', { className: 'mp-badge' }, t('accountPrimary')) : null,
                  h('span', { className: 'mp-spacer' }),
                  h('span', { className: 'mp-badgeMuted' }, account.enabled === false ? t('accountDisabled') : t('enabledLabel')),
                  h(
                    'span',
                    { className: account.configured === true ? 'mp-badgeMuted' : 'mp-badgeMuted mp-badgeWarn' },
                    account.configured === true ? t('configured') : t('missing'),
                  ),
                ),
              ),
            ),
        h('p', { className: 'mp-hint' }, modelCount === undefined ? '' : fill(t('modelsCount'), { count: modelCount })),
      )
    }

    /**
     * The sidebar footer card, registered into `sidebar.footer.action` — the
     * list the shell renders directly above the Settings seat. The shell wraps
     * nothing here, so this component owns its surface: the button, its chrome
     * and its accessible name. Expanded it draws ONE row (name, combined
     * amount, combined percent) over a 5px bar split into one segment per
     * budget window; collapsed to the 56px rail it is a 36px ring button.
     *
     * Visibility follows `usage.display`: `off` hides it, `auto` shows it once
     * an account is configured, `always` always shows it. The entry stays
     * REGISTERED either way — this is a render decision.
     */
    function SidebarCard({ t, wide, open }) {
      const meta = useMeta()
      const [usage, setUsage] = useState(null)
      const [error, setError] = useState(null)

      const display = meta?.usage?.display ?? 'auto'
      const configured = meta?.accounts?.some((account) => account.configured === true) === true
      const visible = display === 'always' || (display === 'auto' && configured)

      useEffect(() => {
        if (!visible) return undefined
        let cancelled = false
        const tick = async () => {
          try {
            const value = await getJSON('/usage')
            if (!cancelled) {
              setUsage(value)
              setError(null)
            }
          } catch (caught) {
            if (!cancelled) setError(String(caught?.message ?? caught))
          }
        }
        void tick()
        const seconds = Math.max(15, meta?.usage?.refreshSeconds ?? 60)
        const timer = setInterval(() => {
          if (!document.hidden) void tick()
        }, seconds * 1000)
        const onVisibility = () => {
          if (!document.hidden) void tick()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          cancelled = true
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [visible, meta?.usage?.refreshSeconds])

      if (!visible) return null

      const combined = combinedUsage(usage?.windows)
      const failed = error !== null || usage?.ok === false
      const title = `${t('sectionTitle')} · ${t('cardTitle')}`
      let stateText
      if (!configured) stateText = t('cardNoAccount')
      else if (failed) stateText = t('cardUnavailable')
      else if (combined.segments.length === 0) stateText = t('cardNoData')

      if (!wide) {
        return h(
          'button',
          { type: 'button', className: 'mp-railButton', 'aria-label': title, title, onClick: () => open() },
          h(Ring, { percent: combined.percent ?? 0, size: 18 }),
        )
      }

      const unit = usage?.currency ?? usage?.windows?.[0]?.unit
      const amount = combined.percent === undefined ? '' : `${money(combined.totalUsed, unit)} / ${money(combined.totalBudget, unit)}`
      const percentText = combined.percent === undefined ? '' : `${Math.round(combined.percent)}%`

      return h(
        'button',
        { type: 'button', className: 'mp-foot', 'aria-label': title, title, onClick: () => open() },
        h(
          'span',
          { className: 'mp-footTop' },
          h('span', { className: 'mp-footName' }, stateText === undefined ? t('sectionTitle') : `${t('sectionTitle')} · ${stateText}`),
          stateText === undefined ? h('span', { className: 'mp-spacer' }) : null,
          stateText === undefined ? h('span', { className: 'mp-footAmount' }, amount) : null,
          stateText === undefined ? h('span', { className: 'mp-footPct' }, percentText) : null,
        ),
        h(
          'span',
          {
            className: 'mp-footBar',
            role: 'progressbar',
            'aria-label': title,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': combined.percent === undefined ? 0 : Math.round(combined.percent),
          },
          combined.segments.map((segment) =>
            h('span', {
              key: segment.id,
              className: `mp-footSeg mp-footSeg${segment.kind === 'api' ? 'Api' : 'Vibe'}`,
              style: { width: `${segmentWidth(segment, combined.totalBudget)}%` },
            }),
          ),
        ),
      )
    }

    /**
     * The statistics panel, registered into the layout's keyed `main` slot under
     * the same id the footer card selects, so the two are one navigation entry.
     * It reads only the existing Host routes: /meta, /usage, /cache, /models.
     */
    function MistralPanel({ ctx, t, close }) {
      const [meta, setMeta] = useState(null)
      const [usage, setUsage] = useState(null)
      const [usageError, setUsageError] = useState(null)
      const [cache, setCache] = useState(null)
      const [cacheError, setCacheError] = useState(null)
      const [models, setModels] = useState(null)
      const [showCache, setShowCache] = useState(true)
      const [busy, setBusy] = useState(false)

      useEffect(() => {
        let cancelled = false
        void (async () => {
          try {
            const value = await getJSON('/meta')
            if (cancelled) return
            setMeta(value)
            try {
              const described = await callRemote(ctx, 'settings', 'describe')
              const view = described.namespaces.find((entry) => entry.ns === value.settingsNs)
              if (!cancelled) setShowCache(view?.value?.usage?.showCache !== false)
            } catch {
              if (!cancelled) setShowCache(true)
            }
          } catch {
            if (!cancelled) setShowCache(true)
          }
        })()
        void getJSON('/usage?force=1')
          .then((value) => {
            if (!cancelled) {
              setUsage(value)
              setUsageError(null)
            }
          })
          .catch((caught) => {
            if (!cancelled) setUsageError(String(caught?.message ?? caught))
          })
        void getJSON('/cache')
          .then((value) => {
            if (!cancelled) {
              setCache(value)
              setCacheError(null)
            }
          })
          .catch((caught) => {
            if (!cancelled) {
              setCache(null)
              setCacheError(String(caught?.message ?? caught))
            }
          })
        void getJSON('/models')
          .then((value) => {
            if (!cancelled) setModels(Array.isArray(value?.models) ? value.models : [])
          })
          .catch(() => {})
        return () => {
          cancelled = true
        }
      }, [ctx])

      const refresh = async () => {
        setBusy(true)
        try {
          const [nextUsage, nextCache] = await Promise.allSettled([getJSON('/usage?force=1'), getJSON('/cache')])
          if (nextUsage.status === 'fulfilled') {
            setUsage(nextUsage.value)
            setUsageError(null)
          } else {
            setUsageError(String(nextUsage.reason?.message ?? nextUsage.reason))
          }
          if (nextCache.status === 'fulfilled') {
            setCache(nextCache.value)
            setCacheError(null)
          } else {
            setCacheError(String(nextCache.reason?.message ?? nextCache.reason))
          }
        } finally {
          setBusy(false)
        }
      }

      const windows = Array.isArray(usage?.windows) ? usage.windows : []
      const combined = combinedUsage(windows)
      const configured = meta?.accounts?.some((account) => account.configured === true) === true
      const unit = usage?.currency ?? usage?.windows?.[0]?.unit
      const subtitleParts = [usage?.plan, usage?.account ?? meta?.accounts?.[0]?.name].filter(
        (part) => typeof part === 'string' && part !== '',
      )
      const subtitle = subtitleParts.length === 0 ? t('sectionSubtitle') : subtitleParts.join(' · ')
      const cookieIssue = usage?.ok === false && (usage?.error?.code === 'NO_USAGE' || usage?.error?.code === 'NO_COOKIE')

      let notice = null
      if (usageError !== null) {
        notice = h(
          'div',
          { className: 'mp-notice mp-noticeError' },
          h('p', { className: 'mp-noticeTitle' }, t('panelUnavailable')),
          h('p', { className: 'mp-noticeHint' }, usageError),
        )
      } else if (usage?.ok === false && !configured) {
        notice = h('div', { className: 'mp-notice' }, h('p', { className: 'mp-noticeTitle' }, t('panelSetup')))
      } else if (cookieIssue) {
        notice = h(
          'div',
          { className: 'mp-notice' },
          h('p', { className: 'mp-noticeTitle' }, t('panelCookieTitle')),
          h('p', { className: 'mp-noticeHint' }, t('panelCookieBody')),
          h('p', { className: 'mp-noticeHint' }, t('panelCookieSteps')),
          h(
            'a',
            { className: 'mp-link', href: 'https://admin.mistral.ai/organization/usage', target: '_blank', rel: 'noreferrer' },
            t('panelOpenAdmin'),
          ),
        )
      } else if (usage?.ok === false) {
        notice = h(
          'div',
          { className: 'mp-notice' },
          h('p', { className: 'mp-noticeTitle' }, t('panelUnavailable')),
          h('p', { className: 'mp-noticeHint' }, usage?.error?.message ?? ''),
        )
      }

      return h(
        'div',
        { className: 'mp-main', role: 'region', 'aria-label': t('sectionTitle') },
        h(
          'div',
          { className: 'mp-mainInner' },
          h(
            'header',
            { className: 'mp-header' },
            h(
              'div',
              { className: 'mp-headerText' },
              h('h2', { className: 'mp-title' }, t('sectionTitle')),
              h('p', { className: 'mp-subtitle' }, subtitle),
            ),
            h('span', { className: 'mp-spacer' }),
            h(
              'button',
              { type: 'button', className: 'mp-close', 'aria-label': t('panelClose'), title: t('panelClose'), onClick: () => close() },
              h(
                'svg',
                { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true' },
                h('path', { d: 'm6 6 12 12M18 6 6 18' }),
              ),
            ),
          ),
          notice,
          h(
            'section',
            { className: 'mp-card', 'aria-label': t('subscriptionTitle') },
            h('h3', { className: 'mp-cardTitle' }, t('subscriptionTitle')),
            windows.length === 0
              ? h('p', { className: 'mp-hint' }, usage?.ok === true ? t('panelNoData') : t('loading'))
              : h('div', { className: 'mp-windows' }, windows.map((window) => h(WindowBlock, { key: window.id, window, t }))),
            h(
              'div',
              { className: 'mp-tiles' },
              h(Tile, { label: t('credits'), value: usage?.credits ? money(usage.credits.balance, usage.credits.currency) : '—' }),
              h(Tile, { label: t('spend'), value: usage?.spend ? money(usage.spend.amount, usage.spend.currency) : '—' }),
              h(Tile, {
                label: t('combinedTotal'),
                value: combined.percent === undefined ? '—' : `${money(combined.totalUsed, unit)} / ${money(combined.totalBudget, unit)}`,
                sub: combined.percent === undefined ? undefined : `${Math.round(combined.percent)}%`,
              }),
            ),
          ),
          showCache === true ? h(CacheCard, { t, cache, cacheError }) : null,
          h(AccountsCard, { t, meta, models }),
          h(
            'footer',
            { className: 'mp-footer' },
            h('span', { className: 'mp-meta' }, usage?.fetchedAt ? fill(t('updated'), { when: updated(usage.fetchedAt, t) }) : ''),
            h('span', { className: 'mp-spacer' }),
            h('button', { type: 'button', className: 'mp-refresh', disabled: busy, onClick: () => void refresh() }, busy ? t('refreshing') : t('refresh')),
          ),
        ),
      )
    }

    return {
      // `remote` is a Cordis service: reading ctx.remote without declaring it
      // throws "cannot get property \"remote\" without inject".
      inject: ['slots', 'locale', 'remote', 'remote.settings', 'remote.credentials'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', EN))
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH))
        ctx.effect(() => ctx.locale.register(NS, 'ja', JA))
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: NS, order: 22, label: () => t('sectionTitle') },
            (props) => h(SettingsSection, { ...props, ctx, t }),
          ),
        )

        // The card selects the panel, so both share one id. `open`/`close` go
        // through the layout service, which is optional: the card only renders
        // inside the sidebar the layout owns, so it is always there in practice.
        const panelFace = () => ({
          open: () => ctx.get('layout')?.selectPanel(PANEL_ID),
          close: () => ctx.get('layout')?.selectPanel(null),
        })

        ctx.effect(() => injectCss(CSS_ID, CSS), 'dsh-mistral-pro: usage card and panel styles')

        try {
          ctx.slots.inject('main', () =>
            ctx.slots.register(
              { name: 'main', key: PANEL_ID, locale: NS, inject: panelFace },
              (props) => h(MistralPanel, { ...props, ctx, t }),
            ),
          )
        } catch (error) {
          console.error('[dsh-mistral-pro] could not register the usage panel:', error)
        }

        ctx.inject(['layout'], (layoutCtx) => {
          try {
            layoutCtx.slots.inject('sidebar.footer.action', () =>
              layoutCtx.slots.register(
                { name: 'sidebar.footer.action', id: PANEL_ID, order: 1, inject: panelFace },
                (props) => h(SidebarCard, { ...props, ctx, t }),
              ),
            )
          } catch (error) {
            console.error('[dsh-mistral-pro] could not register the sidebar usage card:', error)
          }
        })
      },
    }
  },
})
