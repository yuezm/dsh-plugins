/**
 * 提示词库 — Client 半侧。
 *
 * 三块注册：
 *   1. `sidebar.panellist`  左侧栏【提示词】入口（图标）
 *   2. `main`（keyed）      面板本体：增删改查 + 搜索 + 「使用」
 *   3. `conversation.composer.dock`（session 作用域）  插入中继
 *
 * 为什么需要第 3 块：`inputActions` 是 **session 作用域**的标准 props
 * （ui-conversation 通过 `ctx.uiSession.provide({ props: ['inputActions'] })` 发布），
 * 而面板是 root 作用域的全局页面，拿不到它。更关键的是 ui-layout 按 key 渲染 `main`：
 *
 *     renderSlot("main", {}, { entryKey: activePanelId ?? "conversation" })
 *
 * 打开面板时会话界面被卸载，composer 也随之卸载。所以插入必须交给一个
 * 在会话挂载时才会出现的 session 作用域组件来做——面板只写"待插入"意图。
 *
 * 本文件刻意不引入任何未经验证的导入：
 *   - 只 `require('react')`（基线模块，官方模板与本仓库探针均已实证）。
 *   - 不用 `@deepseek-ai/dsh-client-store` 的 store 席位，因为它在
 *     `dsh.client.external` 里的声明形状没有证据；持久化直接用 `localStorage`
 *     ——这正是 `defineStore.persist` 的实现（`localStorage.setItem`），
 *     且已由 A1 探针实测落盘到 profile 并跨重启存活。
 *   - 样式只用官方编译产物里出现过的 `--dsw-*` / `--dsh-*` token 真名。
 *   - 文案为中文硬编码，未走 Client locale 服务（本插件单语言；locale 字典格式无证据）。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-prompt-library',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    //#region 常量

    /** 侧栏入口 id，同时是 `main` keyed slot 的 key —— 两者必须一致。 */
    const PANEL_ID = 'prompts';
    /** `/` 命令名。与宿主命令同名会明确抛错，撞名时改这里。 */
    const COMMAND_NAME = 'prompt';
    /**
     * 插件版本，必须与 package.json 的 `version` 一致。
     *
     * 浏览器侧读不到 package.json，所以只能内联；`smoke-test.mjs` 会断言两者相等，
     * 防止升级时漏改。面板底部会显示它——DSH 的插件管理器没有版本选择器，
     * 你只能靠"跑着的代码自己报出版本"来确认装的是哪一版。
     */
    const PLUGIN_VERSION = '1.1.0';
    /** 持久化键，沿用 `dsh.<feature>.<version>` 约定。 */
    const STORAGE_KEY = 'dsh.prompt-library.v1';
    /** 样式标签身份，用于幂等注入与卸载移除。 */
    const STYLE_TAG_ID = '@local/dsh-prompt-library/PromptLibrary.css';

    //#endregion

    //#region 数据层

    /** 生成一个本地唯一 id；仅用于 React key 与增删改查定位。 */
    function newId() {
      return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    /** 从 localStorage 读取提示词；任何异常都退化为空库，绝不让面板挂掉。 */
    function readPrompts() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return [];
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.prompts)) return [];
        return parsed.prompts.filter(
          (item) => item && typeof item.id === 'string' && typeof item.body === 'string',
        );
      } catch (error) {
        console.error('[prompt-library] 读取失败：', error);
        return [];
      }
    }

    /**
     * 极简可订阅存储。
     *
     * 只持久化 `prompts`：`pending` / `result` 是跨组件的一次性意图与回执，
     * 落盘会导致下次启动误触发插入。
     */
    function createLibrary() {
      let state = {
        /** 持久数据：{ id, title, body, createdAt }[] */
        prompts: readPrompts(),
        /** 待插入意图：面板写，中继消费。 */
        pending: null,
        /** 最近一次插入回执：{ ok, reason, text, at }。 */
        result: null,
      };
      const listeners = new Set();

      const emit = () => {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            console.error('[prompt-library] 订阅者失败：', error);
          }
        }
      };

      const persist = () => {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ prompts: state.prompts }));
        } catch (error) {
          console.error('[prompt-library] 写入失败：', error);
        }
      };

      const update = (patch) => {
        state = { ...state, ...patch };
        emit();
      };

      return {
        getState: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        /** 新增一条，返回新 id。标题留空时取正文首行。 */
        add(title, body) {
          const prompt = {
            id: newId(),
            title: title.trim() || deriveTitle(body),
            body,
            createdAt: new Date().toISOString(),
          };
          update({ prompts: [...state.prompts, prompt] });
          persist();
          return prompt.id;
        },
        edit(id, title, body) {
          update({
            prompts: state.prompts.map((item) =>
              item.id === id
                ? { ...item, title: title.trim() || deriveTitle(body), body }
                : item,
            ),
          });
          persist();
        },
        remove(id) {
          update({ prompts: state.prompts.filter((item) => item.id !== id) });
          persist();
        },
        /** 面板的「使用」：写下意图，由 session 作用域的中继执行插入。 */
        requestInsert(text) {
          update({ pending: { text, at: Date.now() }, result: null });
        },
        /** 中继的回执：清掉意图并记录结果，供面板显示。 */
        reportResult(ok, reason, text) {
          update({ pending: null, result: { ok, reason, text, at: Date.now() } });
        },
      };
    }

    const library = createLibrary();

    /** 标题缺省值：正文首个非空行的前 40 字符。 */
    function deriveTitle(body) {
      const first = body.split('\n').find((line) => line.trim() !== '') ?? '';
      return first.trim().slice(0, 40) || '未命名提示词';
    }

    /** 搜索：标题或正文的大小写不敏感子串匹配；空查询保留全部。 */
    function filterPrompts(prompts, query) {
      const needle = query.trim().toLowerCase();
      if (needle === '') return prompts;
      return prompts.filter(
        (item) =>
          item.title.toLowerCase().includes(needle) || item.body.toLowerCase().includes(needle),
      );
    }

    /** 订阅存储的钩子：store 是模块级单例，两个组件共享同一份状态。 */
    function useLibrary() {
      const [snapshot, setSnapshot] = React.useState(library.getState);
      React.useEffect(() => library.subscribe(() => setSnapshot(library.getState())));
      return snapshot;
    }

    //#endregion

    //#region 侧栏图标

    /**
     * 侧栏入口图标。自己画内联 SVG——插件规范禁止导入 Harness Client 包，
     * 因此不能复用 `ui-primitives` 的图标。
     * @param props.size - 侧栏请求的边长。
     */
    function PromptsPanelIcon({ size }) {
      const edge = typeof size === 'number' ? size : 16;
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: edge,
          height: edge,
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M2.5 3.5h11M2.5 8h11M2.5 12.5h7',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      );
    }

    //#endregion

    //#region 面板

    /**
     * 提示词面板：列表 + 搜索 + 新增/编辑/删除 + 使用。
     * 全局页面，不属于任何 Session，因此只拿到全局标准 props。
     */
    function PromptsPage() {
      const state = useLibrary();
      const [query, setQuery] = React.useState('');
      // null = 未在编辑；{ id: null } = 新增；{ id } = 编辑既有条目
      const [editing, setEditing] = React.useState(null);
      const [confirmingId, setConfirmingId] = React.useState(null);

      const visible = filterPrompts(state.prompts, query);

      const startAdd = () => {
        setConfirmingId(null);
        setEditing({ id: null, title: '', body: '' });
      };

      const startEdit = (prompt) => {
        setConfirmingId(null);
        setEditing({ id: prompt.id, title: prompt.title, body: prompt.body });
      };

      const save = () => {
        if (editing === null) return;
        const body = editing.body.trim();
        if (body === '') return;
        if (editing.id === null) library.add(editing.title, body);
        else library.edit(editing.id, editing.title, body);
        setEditing(null);
      };

      const status =
        state.pending !== null
          ? '已排队：切回对话后插入'
          : state.result === null
            ? null
            : state.result.ok
              ? '已插入到当前草稿'
              : '未插入：草稿正忙或已被改动，请重试';

      return h('div', { className: 'pl-page' }, [
        h('header', { key: 'head', className: 'pl-head' }, [
          h('div', { key: 'titles' }, [
            h('h1', { key: 'title', className: 'pl-title' }, '提示词'),
            h(
              'p',
              { key: 'intro', className: 'pl-intro' },
              `共 ${state.prompts.length} 条${query.trim() === '' ? '' : `，匹配 ${visible.length} 条`}`,
            ),
          ]),
          h(
            'button',
            { key: 'add', type: 'button', className: 'pl-btn pl-btn-primary', onClick: startAdd },
            '新增',
          ),
        ]),

        h('div', { key: 'search', className: 'pl-search' }, [
          h('input', {
            key: 'input',
            type: 'text',
            className: 'pl-input',
            value: query,
            placeholder: '搜索标题或正文',
            'aria-label': '搜索提示词',
            onChange: (event) => setQuery(event.target.value),
          }),
        ]),

        status === null
          ? null
          : h('p', { key: 'status', className: 'pl-status', role: 'status' }, status),

        editing === null
          ? null
          : h('section', { key: 'editor', className: 'pl-editor' }, [
              h(
                'label',
                { key: 'titleField', className: 'pl-field' },
                h('span', { className: 'pl-label' }, '标题'),
                h('input', {
                  type: 'text',
                  className: 'pl-input',
                  value: editing.title,
                  placeholder: '留空则取正文首行',
                  onChange: (event) =>
                    setEditing((prev) => ({ ...prev, title: event.target.value })),
                }),
              ),
              h(
                'label',
                { key: 'bodyField', className: 'pl-field' },
                h('span', { className: 'pl-label' }, '正文'),
                h('textarea', {
                  className: 'pl-textarea',
                  value: editing.body,
                  rows: 8,
                  placeholder: '提示词正文',
                  onChange: (event) => setEditing((prev) => ({ ...prev, body: event.target.value })),
                }),
              ),
              h('div', { key: 'actions', className: 'pl-editor-actions' }, [
                h(
                  'button',
                  {
                    key: 'save',
                    type: 'button',
                    className: 'pl-btn pl-btn-primary',
                    disabled: editing.body.trim() === '',
                    onClick: save,
                  },
                  '保存',
                ),
                h(
                  'button',
                  {
                    key: 'cancel',
                    type: 'button',
                    className: 'pl-btn',
                    onClick: () => setEditing(null),
                  },
                  '取消',
                ),
              ]),
            ]),

        visible.length === 0
          ? h(
              'p',
              { key: 'empty', className: 'pl-empty' },
              state.prompts.length === 0
                ? '还没有提示词。点「新增」记下第一条。'
                : '没有匹配的提示词。',
            )
          : h(
              'ul',
              { key: 'list', className: 'pl-list' },
              // 最新在前：刚添加的条目就在视线处。
              [...visible].reverse().map((prompt) =>
                h('li', { key: prompt.id, className: 'pl-row' }, [
                  h('div', { key: 'main', className: 'pl-row-main' }, [
                    h('div', { key: 'title', className: 'pl-row-title' }, prompt.title),
                    h('div', { key: 'body', className: 'pl-row-body' }, preview(prompt.body)),
                  ]),
                  h('div', { key: 'actions', className: 'pl-row-actions' }, [
                    h(
                      'button',
                      {
                        key: 'use',
                        type: 'button',
                        className: 'pl-btn pl-btn-use',
                        onClick: () => library.requestInsert(prompt.body),
                      },
                      '使用',
                    ),
                    h(
                      'button',
                      {
                        key: 'edit',
                        type: 'button',
                        className: 'pl-btn',
                        onClick: () => startEdit(prompt),
                      },
                      '编辑',
                    ),
                    confirmingId === prompt.id
                      ? h(
                          'button',
                          {
                            key: 'confirm',
                            type: 'button',
                            className: 'pl-btn pl-btn-danger',
                            onClick: () => {
                              library.remove(prompt.id);
                              setConfirmingId(null);
                            },
                          },
                          '确认删除',
                        )
                      : h(
                          'button',
                          {
                            key: 'delete',
                            type: 'button',
                            className: 'pl-btn pl-btn-danger-ghost',
                            onClick: () => setConfirmingId(prompt.id),
                          },
                          '删除',
                        ),
                  ]),
                ]),
              ),
            ),

        // 版本自报。DSH 的插件管理器没有版本选择器，也读不到运行中代码的版本；
        // 加上硬链接会让 profile 里的副本静默停留在旧版，所以"跑着的代码自己说出版本"
        // 是唯一可靠的确认方式。
        h('footer', { key: 'footer', className: 'pl-footer' }, `提示词库 v${PLUGIN_VERSION}`),
      ]);
    }

    /** 列表行的正文预览：折叠空白后截断到 120 字符。 */
    function preview(body) {
      const flat = body.replace(/\s+/g, ' ').trim();
      return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
    }

    //#endregion

    //#region 插入中继

    /**
     * 插入中继。注册在 `conversation.composer.dock`（`scope: session`），
     * 因此可以拿到 `inputActions` 并真正落笔到草稿；自身不渲染任何可见内容。
     *
     * 时序：面板写 pending → 用户切回对话 → composer 挂载 → 本组件挂载 →
     * effect 读到 pending → captureInsertion() 取选区与草稿版本 →
     * insertText() 插入一次可撤销的纯文本编辑 → 写回执并清掉 pending。
     *
     * 不做自动重试：`insertText` 在草稿处于 adjudicating/submitting 或版本已变时
     * 返回 false。此时按规范"保留结果等待用户操作"，我们只记录失败让面板提示，
     * 由用户再点一次——比静默重试更可预期。
     */
    function InsertRelay(props) {
      const { inputActions } = props;
      const state = useLibrary();
      const pending = state.pending;

      React.useEffect(() => {
        if (pending === null || inputActions === undefined) return;
        let span;
        try {
          span = inputActions.captureInsertion();
        } catch (error) {
          console.error('[prompt-library] 取草稿选区失败：', error);
          library.reportResult(false, 'capture-failed', pending.text);
          return;
        }
        let ok = false;
        try {
          ok = inputActions.insertText(pending.text, span) === true;
        } catch (error) {
          console.error('[prompt-library] 插入失败：', error);
        }
        library.reportResult(ok, ok ? null : 'rejected', pending.text);
      }, [pending, inputActions]);

      return null;
    }

    //#endregion

    //#region 样式

    /**
     * 面板样式。全部使用官方编译产物中出现的 token 真名；没有猜任何一个名字。
     * 通过 `ctx.effect` 注入并在卸载时移除。
     */
    const CSS = `
.pl-page{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:20px;padding:28px clamp(24px,4vw,48px) 48px;overflow:auto;align-items:center}
.pl-page>*{width:100%;max-width:960px}
[data-platform=darwin] .pl-page{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.pl-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.pl-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.pl-intro{color:var(--dsw-alias-label-secondary);margin:4px 0 0;font-size:13px;line-height:20px}
.pl-search{display:flex}
.pl-status{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:20px}
.pl-input,.pl-textarea{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none;padding:0 14px}
.pl-input{height:40px;width:100%}
.pl-textarea{min-height:160px;padding:10px 14px;line-height:20px;resize:vertical;width:100%}
.pl-input:focus,.pl-textarea:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}
.pl-editor{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px;padding:14px}
.pl-field{display:flex;flex-direction:column;gap:6px;font-size:13px}
.pl-label{color:var(--dsw-alias-label-secondary)}
.pl-editor-actions{display:flex;gap:8px;justify-content:flex-end}
.pl-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.pl-row{display:flex;align-items:center;gap:16px;border-bottom:.5px solid var(--dsw-alias-border-l2);padding:12px 2px}
.pl-row:last-child{border-bottom:0}
.pl-row-main{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.pl-row-title{font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
.pl-row-body{color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:18px;overflow-wrap:anywhere}
.pl-row-actions{display:flex;align-items:center;gap:8px;flex:none}
.pl-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.pl-footer{color:var(--dsw-alias-label-caption);margin:8px 0 0;font-size:12px;line-height:18px;margin-top:auto;padding-top:12px}
.pl-btn{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:transparent;cursor:pointer}
.pl-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.pl-btn:disabled{opacity:.5;cursor:default}
.pl-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.pl-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.pl-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill))}
.pl-btn-use{color:var(--dsw-alias-state-business-primary)}
.pl-btn-danger,.pl-btn-danger-ghost{color:var(--dsw-alias-state-error-primary)}
.pl-btn-danger{border-color:var(--dsw-alias-state-error-primary)}
.pl-btn-danger:hover:not(:disabled),.pl-btn-danger-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover))}
`;

    /** 幂等注入样式，返回移除函数（交给 `ctx.effect`）。 */
    function mountStyles() {
      if (typeof document === 'undefined') return () => {};
      const selector = `style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`;
      if (document.querySelector(selector) !== null) return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/dsh-prompt-library';
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }

    //#endregion

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => mountStyles(), 'prompt-library: styles');

        // 左侧栏入口：与【插件】（order 0）同级，排在它正下方。
        // list slot 按 priority 再按 order 升序，因此这里必须大于 0。
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 1, label: '提示词' },
            PromptsPanelIcon,
          ),
        );

        // 面板本体：`main` 是 keyed slot，用 key 与上面的 id 对齐（不是 id）。
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, PromptsPage),
        );

        // 插入中继：session 作用域，是唯一能拿到 inputActions 的位置。
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'prompt-library-insert', order: 900 },
            InsertRelay,
          ),
        );

        // 键盘流入口 `/prompt`。
        //
        // 用嵌套的 ctx.inject，而不是把 commandUi 加进顶层 inject：顶层 inject 会闸住
        // 整个插件的激活，而面板已经验收通过，不想为一个附加入口改变它的激活条件。
        //
        // onSelect 与面板走**同一条**意图通道，插入仍由上面那个 session 作用域中继执行：
        // 不重复实现插入逻辑，也就不会踩到"面板拿不到 inputActions"那个坑。
        ctx.inject(['commandUi'], (scope) => {
          const command = scope.get('commandUi');
          scope.effect(
            () =>
              command.register({
                name: COMMAND_NAME,
                label: () => '提示词',
                description: () => '把一段提示词插入草稿',
                icon: PromptsPanelIcon,
                available: () => true,
                ui: {
                  kind: 'popupSelect',
                  searchLabels: () => ({
                    placeholder: '搜索提示词',
                    empty: '还没有提示词，先去左侧【提示词】面板添加',
                    noResults: '没有匹配的提示词',
                  }),
                  // 最新在前，与面板列表顺序一致。
                  options: async () =>
                    [...library.getState().prompts].reverse().map((prompt) => ({
                      id: prompt.id,
                      label: prompt.title,
                      detail: preview(prompt.body),
                    })),
                  onSelect: (option) => {
                    // 只认 id，再回库里取正文：不依赖框架是否透传自定义字段。
                    const prompt = library
                      .getState()
                      .prompts.find((item) => item.id === option.id);
                    if (prompt === undefined) return;
                    // 延到下一个宏任务再写意图——**这是必需的，不是保险**。
                    //
                    // ui-commands 的顺序是：await onSelect(...) → 再用
                    // `consume(binding.segment)` 删掉你键入的 `/pro`。那个删除走的是
                    // 带 draftRev 的 CAS guard：
                    //
                    //     if (guard.span.draftRev !== this.rev) return false
                    //
                    // 若我们在 onSelect 里同步写意图，中继会在消费之前插入文本、推进 rev，
                    // guard 随即失配 → `/pro` 永远留在草稿里（实测就是这个现象）。
                    // 延后一个宏任务，消费已经在微任务链里完成，rev 也随之推进——
                    // 中继到那时才 captureInsertion()，拿到的是**新的** rev 与消费后的光标。
                    setTimeout(() => library.requestInsert(prompt.body), 0);
                  },
                },
              }),
            'prompt-library: /prompt command',
          );
        });
      },
    };
  },
});
