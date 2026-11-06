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
  id: 'dsh-prompt-library',
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
    const PLUGIN_VERSION = '1.3.1';
    /** 持久化键，沿用 `dsh.<feature>.<version>` 约定。 */
    const STORAGE_KEY = 'dsh.prompt-library.v1';
    /** 样式标签身份，用于幂等注入与卸载移除。 */
    const STYLE_TAG_ID = 'dsh-prompt-library/PromptLibrary.css';

    //#endregion

    //#region 数据层

    /**
     * 当前会话查询端口。面板是 root 作用域的全局页面，拿不到 session 绑定，
     * 只能在写「待插入」意图时向 sessions 服务查询"哪个是主会话"。
     *
     * 默认实现保守：查不到服务时 `currentId()` 返回 undefined、`isMain()` 恒真，
     * 行为退化为旧版（意图不带目标），但不会让插件挂掉。
     */
    const sessionQuery = {
      currentId: () => undefined,
      isMain: () => true,
    };

    /** 生成一个本地唯一 id；仅用于 React key 与增删改查定位。 */
    function newId() {
      return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    /** 生成一个分组 id。前缀与提示词 id 区分开，避免肉眼混淆。 */
    function newGroupId() {
      return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    /**
     * 从 localStorage 读取整份数据；任何异常都退化为空库，绝不让面板挂掉。
     *
     * 兼容旧版（≤1.2.x）只有 `{ prompts: [...] }`、没有 `groups` 字段的格式。
     * 当「有提示词、但整份数据里没有 groups 字段」时，标记为需要一次性自动分组迁移：
     * 新版第一次加载就会把已有提示词按内容归类。一旦落盘过带 groups 的数据，
     * 这个标记就消失——用户之后清空分组也不会被重新自动分类。
     */
    function readState() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return { prompts: [], groups: [], needsGroupMigration: false };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
          return { prompts: [], groups: [], needsGroupMigration: false };
        }
        const prompts = Array.isArray(parsed.prompts)
          ? parsed.prompts.filter(
              (item) => item && typeof item.id === 'string' && typeof item.body === 'string',
            )
          : [];
        const hasGroups = Array.isArray(parsed.groups);
        const groups = hasGroups
          ? parsed.groups.filter(
              (item) => item && typeof item.id === 'string' && typeof item.name === 'string',
            )
          : [];
        return { prompts, groups, needsGroupMigration: !hasGroups && prompts.length > 0 };
      } catch (error) {
        console.error('[prompt-library] 读取失败：', error);
        return { prompts: [], groups: [], needsGroupMigration: false };
      }
    }

    /**
     * 自动分组规则（纯启发式，全部在本地跑，不依赖模型）。
     *
     * 每个分类的得分 = 命中关键词的长度之和（越具体的关键词越长，权重越高），
     * 取得分最高的分类。比对所有分类都不命中时返回 null（保持未分组）。
     * 规则只作用于「未分组」的提示词；用户手动指定的分组不会被覆盖。
     */
    const CATEGORY_RULES = [
      {
        name: '测试与质量',
        keywords: [
          '单元测试', '测试用例', '测试', '断言', '覆盖率', '变异测试', '质量审计',
          'jest', 'vitest', 'mocha', 'pytest', 'junit', 'mock', 'test',
        ],
      },
      {
        name: '代码审查与重构',
        keywords: ['代码审查', '代码评审', 'code review', '重构', 'refactor', '坏味道', '整洁代码', '边界条件', 'review'],
      },
      {
        name: '图像与设计',
        keywords: [
          'generate an image', 'text-to-image', 'svg', '图片', '图像', '插画', '海报',
          '图标', '配色', '视觉', '设计', 'mockup', 'wireframe', 'image', 'images', 'draw', 'logo', 'banner',
        ],
      },
      {
        name: '写作与文案',
        keywords: ['文案', '写作', '撰写', '总结', '摘要', '报告', '邮件', '公众号', '润色', '改写', '周报', 'article', 'blog', '文章'],
      },
      {
        name: '翻译与本地化',
        keywords: ['翻译', 'translate', 'localization', '本地化', '多语言', '英文', '中文'],
      },
      {
        name: '数据分析',
        keywords: ['数据分析', '数据清洗', '数据', 'sql', 'pandas', 'excel', '报表', '指标', '可视化', 'dashboard', '统计'],
      },
      {
        name: '产品与需求',
        keywords: ['产品需求', '需求分析', '用户故事', '竞品', '调研', '原型', 'prd', 'mvp', '产品'],
      },
      {
        name: '架构与技术方案',
        keywords: ['技术方案', '系统设计', '设计文档', '架构', '数据库', '微服务', 'schema', 'api', '接口'],
      },
      {
        name: '运维与部署',
        keywords: ['部署', '运维', 'docker', 'kubernetes', 'k8s', '监控', '告警', '日志', '发布上线'],
      },
      {
        name: '教学与解释',
        keywords: ['解释', '讲解', '教学', '科普', '入门', '学习', '通俗'],
      },
      {
        name: '提示词工程',
        keywords: ['提示词', 'prompt', 'prompts', '角色设定', '扮演', 'system prompt'],
      },
    ];

    /** 纯 ASCII 关键词用「词边界」匹配，避免 review 命中 preview、test 命中 latest 这类误判。 */
    function isAsciiKeyword(keyword) {
      return /^[\x20-\x7e]+$/.test(keyword);
    }

    /** 统计 ASCII 关键词作为独立词出现的次数；最多计 2 次，避免长文重复刷分。 */
    function countAsciiWord(text, keyword) {
      const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g');
      const matches = text.match(pattern);
      return matches === null ? 0 : Math.min(matches.length, 2);
    }

    /** 给单条提示词推断分组名；没有明显分类时返回 null。 */
    function classifyPrompt(prompt) {
      const text = `${prompt.title ?? ''}\n${prompt.body ?? ''}`.toLowerCase();
      let best = null;
      let bestScore = 0;
      for (const rule of CATEGORY_RULES) {
        let score = 0;
        const matched = [];
        // 先长后短：长关键词已命中时，跳过被它包含的短关键词，避免「单元测试」+「测试」重复累加。
        const keywords = [...rule.keywords].sort((a, b) => b.length - a.length);
        for (const keyword of keywords) {
          const lower = keyword.toLowerCase();
          if (matched.some((longer) => longer !== lower && longer.includes(lower))) continue;
          let hits = 0;
          if (isAsciiKeyword(keyword)) hits = countAsciiWord(text, keyword);
          else if (text.includes(lower)) hits = 1;
          if (hits > 0) {
            score += keyword.length * hits;
            matched.push(lower);
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = rule.name;
        }
      }
      return best;
    }

    /**
     * 把「未分组」的提示词自动归类：按分类名找已有分组，没有就新建一个。
     * 纯函数，不改动传入数组，返回新的 prompts/groups 与统计。
     */
    function autoAssign(prompts, groups) {
      const nextGroups = groups.map((group) => ({ ...group }));
      const byName = new Map(nextGroups.map((group) => [group.name, group]));
      const validIds = new Set(nextGroups.map((group) => group.id));
      let created = 0;
      let assigned = 0;
      let unmatched = 0;
      const nextPrompts = prompts.map((prompt) => {
        // 已有有效分组的不动；groupId 缺失或指向已删除分组的，视为未分组。
        if (typeof prompt.groupId === 'string' && validIds.has(prompt.groupId)) return prompt;
        const name = classifyPrompt(prompt);
        if (name === null) {
          unmatched += 1;
          return prompt;
        }
        let group = byName.get(name);
        if (group === undefined) {
          group = { id: newGroupId(), name, createdAt: new Date().toISOString() };
          byName.set(name, group);
          nextGroups.push(group);
          created += 1;
        }
        assigned += 1;
        return { ...prompt, groupId: group.id };
      });
      return { prompts: nextPrompts, groups: nextGroups, created, assigned, unmatched };
    }

    /** 把自动分组统计格式化成面板提示；没有可报告的内容时返回 null。 */
    function formatAutoSummary(result) {
      if (result === null || result === undefined) return null;
      if (result.assigned === 0) {
        return result.unmatched > 0
          ? `没有可自动归类的提示词（${result.unmatched} 条未匹配）`
          : null;
      }
      return `已自动分组：新建 ${result.created} 组，归类 ${result.assigned} 条${
        result.unmatched > 0 ? `，${result.unmatched} 条未匹配` : ''
      }`;
    }

    /**
     * 极简可订阅存储。
     *
     * 持久化 `prompts` 与 `groups`；`pending` / `result` / `autoGroupResult`
     * 是一次性意图与回执，不落盘（落盘会导致下次启动误触发插入）。
     */
    function createLibrary() {
      const initial = readState();
      let state = {
        /** 持久数据：{ id, title, body, createdAt, groupId? }[] */
        prompts: initial.prompts,
        /** 持久数据：{ id, name, createdAt }[] */
        groups: initial.groups,
        /** 待插入意图：面板/命令写，目标会话的中继消费。{ text, sessionId, at } */
        pending: null,
        /** 最近一次插入回执：{ ok, reason, text, at }。 */
        result: null,
        /** 最近一次自动分组的回执：{ created, assigned, unmatched }（不持久化）。 */
        autoGroupResult: null,
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
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ prompts: state.prompts, groups: state.groups }),
          );
        } catch (error) {
          console.error('[prompt-library] 写入失败：', error);
        }
      };

      // 旧数据一次性迁移：新版第一次加载就把已有提示词按内容自动归类。
      // 只做一次——迁移后数据里就带 groups 字段，下次加载不再触发。
      if (initial.needsGroupMigration) {
        const migrated = autoAssign(state.prompts, state.groups);
        state = {
          ...state,
          prompts: migrated.prompts,
          groups: migrated.groups,
          autoGroupResult: {
            created: migrated.created,
            assigned: migrated.assigned,
            unmatched: migrated.unmatched,
          },
        };
        persist();
      }

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
        /** 新增一条，返回新 id。标题留空时取正文首行；groupId 为空表示未分组。 */
        add(title, body, groupId) {
          const prompt = {
            id: newId(),
            title: title.trim() || deriveTitle(body),
            body,
            createdAt: new Date().toISOString(),
            ...(typeof groupId === 'string' && groupId !== '' ? { groupId } : {}),
          };
          update({ prompts: [...state.prompts, prompt] });
          persist();
          return prompt.id;
        },
        edit(id, title, body, groupId) {
          update({
            prompts: state.prompts.map((item) =>
              item.id === id
                ? {
                    ...item,
                    title: title.trim() || deriveTitle(body),
                    body,
                    groupId:
                      typeof groupId === 'string' && groupId !== '' ? groupId : undefined,
                  }
                : item,
            ),
          });
          persist();
        },
        remove(id) {
          update({ prompts: state.prompts.filter((item) => item.id !== id) });
          persist();
        },
        /** 新建分组；重名时复用已有分组。返回 { id, created }（名称空则返回 null）。 */
        addGroup(name) {
          const clean = name.trim();
          if (clean === '') return null;
          const existing = state.groups.find((group) => group.name === clean);
          if (existing !== undefined) return { id: existing.id, created: false };
          const group = { id: newGroupId(), name: clean, createdAt: new Date().toISOString() };
          update({ groups: [...state.groups, group] });
          persist();
          return { id: group.id, created: true };
        },
        /** 重命名分组。成功返回 true；名称为空、或与其它分组重名时返回 false。 */
        renameGroup(id, name) {
          const clean = name.trim();
          if (clean === '') return false;
          if (state.groups.some((group) => group.id !== id && group.name === clean)) return false;
          update({
            groups: state.groups.map((group) =>
              group.id === id ? { ...group, name: clean } : group,
            ),
          });
          persist();
          return true;
        },
        /** 删除分组：组内提示词回到「未分组」，不连带删除提示词。 */
        removeGroup(id) {
          update({
            groups: state.groups.filter((group) => group.id !== id),
            prompts: state.prompts.map((prompt) =>
              prompt.groupId === id ? { ...prompt, groupId: undefined } : prompt,
            ),
          });
          persist();
        },
        /** 把「未分组」的提示词按内容自动归类。返回 { created, assigned, unmatched }。 */
        autoGroup() {
          const result = autoAssign(state.prompts, state.groups);
          const summary = {
            created: result.created,
            assigned: result.assigned,
            unmatched: result.unmatched,
          };
          if (result.assigned === 0) {
            update({ autoGroupResult: summary });
            return summary;
          }
          update({
            prompts: result.prompts,
            groups: result.groups,
            autoGroupResult: summary,
          });
          persist();
          return summary;
        },
        /** 面板/命令的「使用」：写下意图（含目标会话），由该会话的中继执行插入。 */
        requestInsert(text, sessionId) {
          update({ pending: { text, sessionId, at: Date.now() }, result: null });
        },
        /**
         * 中继认领：原子地取出并清空意图，只有目标会话能认领。
         *
         * 为什么必须按 sessionId 认领：`pending` 是模块级单例，而当前 DSH 里
         * 同一时刻可能挂载多个 composer（主会话 + 嵌入式子代理对话 + 侧栏 chat
         * 标签等）。旧版「谁先跑 effect 谁插入」会让第一个挂载的会话抢走意图，
         * 结果提示词被插进另一个对话（用户报的"插到 sa_protocol_library 里第一个对话"）。
         * 现在意图带上目标会话，只有目标会话的中继会认领；并且认领是原子的，
         * 同一份意图最多落笔一次（即使同一会话有多个 composer 实例）。
         *
         * @returns 被认领的意图，或 null（没有意图 / 目标不匹配）。
         */
        claimPending(sessionId) {
          const pending = state.pending;
          if (pending === null) return null;
          if (pending.sessionId !== undefined) {
            if (pending.sessionId !== sessionId) return null;
          } else if (!sessionQuery.isMain(sessionId)) {
            // 未指定目标的旧式意图：只允许主会话认领，避免被隐藏/嵌入的其它会话抢走。
            return null;
          }
          state = { ...state, pending: null };
          emit();
          return pending;
        },
        /** 中继的回执：记录结果，供面板显示。意图已在认领时清空，这里不再改 pending。 */
        reportResult(ok, reason, text) {
          update({ result: { ok, reason, text, at: Date.now() } });
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
          String(item.title ?? '')
            .toLowerCase()
            .includes(needle) ||
          String(item.body ?? '')
            .toLowerCase()
            .includes(needle),
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
      // 统一对话框：null / { kind:'prompt', id, title, body, groupId } / { kind:'group', id, name }
      const [dialog, setDialog] = React.useState(null);
      const [confirmingId, setConfirmingId] = React.useState(null);
      const [confirmingGroupId, setConfirmingGroupId] = React.useState(null);
      const [collapsed, setCollapsed] = React.useState({});
      // 迁移/自动分组的结果存在 state.autoGroupResult 里；面板挂载时消费一次，让用户看到发生了什么。
      const [notice, setNotice] = React.useState(() => formatAutoSummary(state.autoGroupResult));
      const dialogRef = React.useRef(null);
      const titleInputRef = React.useRef(null);
      const bodyInputRef = React.useRef(null);
      const groupNameInputRef = React.useRef(null);
      /** 对话框以模态层呈现；只有它的打开/关闭才需要移动焦点。 */
      const dialogOpen = dialog !== null;

      /**
       * 弹窗打开时把焦点送进表单：新增先填标题，编辑优先正文（点【编辑】通常就是改正文）。
       * 关闭时把焦点归还给原来的触发按钮，键盘用户不会丢失位置。
       *
       * 依赖只写 `dialogOpen`：每输入一个字都会生成新的 editing 对象，若把它放进依赖，
       * 光标会被重新聚焦到末尾。
       */
      React.useEffect(() => {
        if (!dialogOpen) return undefined;
        const previous = typeof document === 'undefined' ? null : document.activeElement;
        let target = null;
        if (dialog.kind === 'group') target = groupNameInputRef.current;
        else if (dialog.id === null) target = titleInputRef.current;
        else target = bodyInputRef.current;
        if (target !== null && target !== undefined && typeof target.focus === 'function') {
          target.focus();
          if (typeof target.setSelectionRange === 'function') {
            try {
              target.setSelectionRange(target.value.length, target.value.length);
            } catch (error) {
              // 个别 input 类型不支持 setSelectionRange；聚焦成功即可。
            }
          }
        }
        return () => {
          if (
            previous !== null &&
            previous !== undefined &&
            typeof previous.focus === 'function' &&
            previous.isConnected !== false
          ) {
            previous.focus();
          }
        };
      }, [dialogOpen]);

      /** 弹窗打开期间 Esc 随时可取消：焦点偶尔离开弹层（例如点了遮罩内的空白）也不失效。 */
      React.useEffect(() => {
        if (!dialogOpen || typeof document === 'undefined') return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.isComposing) return;
          event.preventDefault();
          setDialog(null);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [dialogOpen]);

      /** 模态层键盘规则：Esc 取消；Tab 在弹窗内循环，不跑到背后的列表上。 */
      const handleDialogKeyDown = (event) => {
        // 中文输入法正在组词时，Esc 是取消候选，不应该顺手关掉弹窗。
        if (event.nativeEvent !== undefined && event.nativeEvent.isComposing === true) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          setDialog(null);
          return;
        }
        if (event.key !== 'Tab') return;
        const root = dialogRef.current;
        if (root === null || root === undefined || typeof root.querySelectorAll !== 'function') return;
        if (typeof document === 'undefined') return;
        const focusables = Array.from(
          root.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        // 点击标题/空白等非可聚焦区域后 activeElement 可能落到 body：先把焦点拉回弹窗。
        if (typeof root.contains === 'function' && !root.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
          return;
        }
        // 弹窗本体的 tabIndex=-1 也可能被点中：Tab 从它出发时同样回到第一个/最后一个控件。
        if (active === root) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
          return;
        }
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      };

      const visible = filterPrompts(state.prompts, query);
      const groupById = new Map(state.groups.map((group) => [group.id, group]));
      const sections = [];
      for (const group of state.groups) {
        const items = visible.filter((prompt) => prompt.groupId === group.id);
        // 搜索时只保留有命中的分组；无搜索时保留空分组，方便看见刚建好的新组。
        if (items.length > 0 || query.trim() === '') sections.push({ key: group.id, group, items });
      }
      const ungrouped = visible.filter(
        (prompt) => typeof prompt.groupId !== 'string' || !groupById.has(prompt.groupId),
      );
      if (ungrouped.length > 0) sections.push({ key: '__ungrouped__', group: null, items: ungrouped });

      const startAdd = () => {
        setConfirmingId(null);
        setConfirmingGroupId(null);
        setNotice(null);
        setDialog({ kind: 'prompt', id: null, title: '', body: '', groupId: '' });
      };

      const startEdit = (prompt) => {
        setConfirmingId(null);
        setConfirmingGroupId(null);
        setNotice(null);
        setDialog({
          kind: 'prompt',
          id: prompt.id,
          title: prompt.title,
          body: prompt.body,
          groupId:
            typeof prompt.groupId === 'string' && groupById.has(prompt.groupId)
              ? prompt.groupId
              : '',
        });
      };

      const startAddGroup = () => {
        setConfirmingId(null);
        setConfirmingGroupId(null);
        setNotice(null);
        setDialog({ kind: 'group', id: null, name: '' });
      };

      const startRenameGroup = (group) => {
        setConfirmingId(null);
        setConfirmingGroupId(null);
        setNotice(null);
        setDialog({ kind: 'group', id: group.id, name: group.name });
      };

      const save = () => {
        if (dialog === null) return;
        if (dialog.kind === 'group') {
          const name = dialog.name.trim();
          if (name === '') return;
          if (dialog.id === null) {
            const result = library.addGroup(name);
            if (result !== null && result.created === false) {
              setNotice('已存在同名分组，直接复用');
            }
            setDialog(null);
            return;
          }
          if (library.renameGroup(dialog.id, name) === false) {
            // 撞名/空名不关闭对话框，给出提示，避免"点了没反应"。
            setNotice('该分组名已存在，请换一个');
            return;
          }
          setDialog(null);
          return;
        }
        const body = dialog.body.trim();
        if (body === '') return;
        if (dialog.id === null) library.add(dialog.title, body, dialog.groupId);
        else library.edit(dialog.id, dialog.title, body, dialog.groupId);
        setDialog(null);
      };

      const runAutoGroup = () => {
        if (state.prompts.length === 0) {
          setNotice('还没有提示词');
          return;
        }
        const result = library.autoGroup();
        if (result.assigned === 0 && result.unmatched === 0) {
          setNotice('所有提示词都已在分组中');
          return;
        }
        setNotice(formatAutoSummary(result) ?? '所有提示词都已在分组中');
      };

      const renderRow = (prompt) =>
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
                onClick: () => library.requestInsert(prompt.body, sessionQuery.currentId()),
              },
              '使用',
            ),
            h(
              'button',
              { key: 'edit', type: 'button', className: 'pl-btn', onClick: () => startEdit(prompt) },
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
        ]);

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
              `共 ${state.prompts.length} 条 · ${state.groups.length} 组${
                query.trim() === '' ? '' : `，匹配 ${visible.length} 条`
              }`,
            ),
          ]),
          h('div', { key: 'actions', className: 'pl-head-actions' }, [
            h(
              'button',
              { key: 'auto', type: 'button', className: 'pl-btn', onClick: runAutoGroup },
              '自动分组',
            ),
            h(
              'button',
              { key: 'newGroup', type: 'button', className: 'pl-btn', onClick: startAddGroup },
              '新建分组',
            ),
            h(
              'button',
              { key: 'add', type: 'button', className: 'pl-btn pl-btn-primary', onClick: startAdd },
              '新增',
            ),
          ]),
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

        notice === null
          ? null
          : h('p', { key: 'notice', className: 'pl-notice', role: 'status' }, notice),

        status === null
          ? null
          : h('p', { key: 'status', className: 'pl-status', role: 'status' }, status),

        // 弹出规则：新增/编辑提示词与新建/重命名分组统一使用「视口居中的模态层」。
        dialog === null
          ? null
          : h(
              'div',
              {
                key: 'editor',
                className: 'pl-modal',
                // 点遮罩空白处取消；点弹窗本体（含输入框）不会误关。
                onMouseDown: (event) => {
                  if (event.button !== 0) return;
                  if (event.target === event.currentTarget) setDialog(null);
                },
              },
              h(
                'div',
                {
                  ref: dialogRef,
                  className: 'pl-dialog',
                  role: 'dialog',
                  'aria-modal': true,
                  'aria-labelledby': 'pl-dialog-title',
                  tabIndex: -1,
                  onKeyDown: handleDialogKeyDown,
                },
                [
                  h('header', { key: 'head', className: 'pl-dialog-head' }, [
                    h(
                      'h2',
                      { key: 'title', id: 'pl-dialog-title', className: 'pl-dialog-title' },
                      dialog.kind === 'group'
                        ? dialog.id === null
                          ? '新建分组'
                          : '重命名分组'
                        : dialog.id === null
                          ? '新增提示词'
                          : '编辑提示词',
                    ),
                    h(
                      'p',
                      { key: 'hint', className: 'pl-dialog-hint' },
                      dialog.kind === 'group'
                        ? '把同一类的提示词归到一起。'
                        : dialog.id === null
                          ? '标题可留空，默认取正文首行。'
                          : '保存后立即生效。',
                    ),
                  ]),
                  dialog.kind === 'group'
                    ? h(
                        'label',
                        { key: 'nameField', className: 'pl-field' },
                        h('span', { className: 'pl-label' }, '分组名称'),
                        h('input', {
                          ref: groupNameInputRef,
                          type: 'text',
                          className: 'pl-input',
                          value: dialog.name,
                          placeholder: '分组名称',
                          onChange: (event) =>
                            setDialog((prev) => ({ ...prev, name: event.target.value })),
                        }),
                      )
                    : [
                        h(
                          'label',
                          { key: 'titleField', className: 'pl-field' },
                          h('span', { className: 'pl-label' }, '标题'),
                          h('input', {
                            ref: titleInputRef,
                            type: 'text',
                            className: 'pl-input',
                            value: dialog.title,
                            placeholder: '留空则取正文首行',
                            onChange: (event) =>
                              setDialog((prev) => ({ ...prev, title: event.target.value })),
                          }),
                        ),
                        h(
                          'label',
                          { key: 'bodyField', className: 'pl-field' },
                          h('span', { className: 'pl-label' }, '正文'),
                          h('textarea', {
                            ref: bodyInputRef,
                            className: 'pl-textarea',
                            value: dialog.body,
                            rows: 8,
                            placeholder: '提示词正文',
                            onChange: (event) =>
                              setDialog((prev) => ({ ...prev, body: event.target.value })),
                          }),
                        ),
                        h(
                          'label',
                          { key: 'groupField', className: 'pl-field' },
                          h('span', { className: 'pl-label' }, '分组'),
                          h(
                            'select',
                            {
                              className: 'pl-input pl-select',
                              value: dialog.groupId,
                              onChange: (event) =>
                                setDialog((prev) => ({ ...prev, groupId: event.target.value })),
                            },
                            [
                              h('option', { key: 'none', value: '' }, '未分组'),
                              ...state.groups.map((group) =>
                                h('option', { key: group.id, value: group.id }, group.name),
                              ),
                            ],
                          ),
                        ),
                      ],
                  h('div', { key: 'actions', className: 'pl-editor-actions' }, [
                    h(
                      'button',
                      {
                        key: 'save',
                        type: 'button',
                        className: 'pl-btn pl-btn-primary',
                        disabled:
                          dialog.kind === 'group'
                            ? dialog.name.trim() === ''
                            : dialog.body.trim() === '',
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
                        onClick: () => setDialog(null),
                      },
                      '取消',
                    ),
                  ]),
                ],
              ),
            ),

        sections.length === 0
          ? h(
              'p',
              { key: 'empty', className: 'pl-empty' },
              state.prompts.length === 0
                ? '还没有提示词。点「新增」记下第一条。'
                : '没有匹配的提示词。',
            )
          : h(
              'div',
              { key: 'list', className: 'pl-groups' },
              sections.map((section) => {
                const group = section.group;
                // 搜索时强制展开命中分组，否则用户会把"折叠隐藏"误判成"没搜到"。
                const isCollapsed =
                  query.trim() === '' && group !== null && collapsed[group.id] === true;
                return h('section', { key: section.key, className: 'pl-group' }, [
                  h('header', { key: 'head', className: 'pl-group-head' }, [
                    group === null
                      ? h(
                          'span',
                          { key: 'toggle', className: 'pl-group-toggle pl-group-toggle-static' },
                          [
                            h('span', { key: 'name', className: 'pl-group-name' }, '未分组'),
                            h(
                              'span',
                              { key: 'count', className: 'pl-group-count' },
                              String(section.items.length),
                            ),
                          ],
                        )
                      : h(
                          'button',
                          {
                            key: 'toggle',
                            type: 'button',
                            className: 'pl-group-toggle',
                            'aria-expanded': !isCollapsed,
                            onClick: () =>
                              setCollapsed((prev) => ({ ...prev, [group.id]: !prev[group.id] })),
                          },
                          [
                            h('span', { key: 'caret', className: 'pl-caret' }, isCollapsed ? '▸' : '▾'),
                            h('span', { key: 'name', className: 'pl-group-name' }, group.name),
                            h(
                              'span',
                              { key: 'count', className: 'pl-group-count' },
                              String(section.items.length),
                            ),
                          ],
                        ),
                    group === null
                      ? null
                      : h('div', { key: 'actions', className: 'pl-group-actions' }, [
                          confirmingGroupId === group.id
                            ? h(
                                'button',
                                {
                                  key: 'confirmGroup',
                                  type: 'button',
                                  className: 'pl-btn pl-btn-danger',
                                  onClick: () => {
                                    library.removeGroup(group.id);
                                    setConfirmingGroupId(null);
                                  },
                                },
                                '确认删除分组',
                              )
                            : h(
                                'button',
                                {
                                  key: 'deleteGroup',
                                  type: 'button',
                                  className: 'pl-btn pl-btn-danger-ghost',
                                  onClick: () => {
                                    setConfirmingId(null);
                                    setConfirmingGroupId(group.id);
                                  },
                                },
                                '删除分组',
                              ),
                          h(
                            'button',
                            {
                              key: 'renameGroup',
                              type: 'button',
                              className: 'pl-btn',
                              onClick: () => startRenameGroup(group),
                            },
                            '重命名',
                          ),
                        ]),
                  ]),
                  isCollapsed
                    ? null
                    : h(
                        'ul',
                        { key: 'list', className: 'pl-list' },
                        [...section.items].reverse().map(renderRow),
                      ),
                ]);
              }),
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
     * 因此可以拿到 `inputActions` 与 `sessionId`，并且**只认领属于本会话的意图**。
     *
     * 时序：面板/命令写 pending（带目标 sessionId）→ 目标会话的 composer 挂载 →
     * 本组件 effect 原子认领 → captureInsertion() 取选区与草稿版本 →
     * insertText() 插入一次可撤销的纯文本编辑 → 写回执。
     *
     * 关键点：当前 DSH 允许同一时刻存在多个 composer（主会话、嵌入式子代理对话、
     * 侧栏 chat 标签）。因此不能"谁先挂载谁插"，必须按 sessionId 认领，否则会插错对话。
     *
     * 不做自动重试：`insertText` 在草稿处于 adjudicating/submitting 或版本已变时
     * 返回 false。此时按规范"保留结果等待用户操作"，我们只记录失败让面板提示，
     * 由用户再点一次——比静默重试更可预期。
     */
    function InsertRelay(props) {
      const { inputActions, sessionId } = props;
      const state = useLibrary();
      const pending = state.pending;

      React.useEffect(() => {
        if (pending === null || inputActions === undefined) return;
        // 先原子认领：只有目标会话能拿到这份意图，且同一意图只会落笔一次。
        const claimed = library.claimPending(sessionId);
        if (claimed === null) return;
        let span;
        try {
          span = inputActions.captureInsertion();
        } catch (error) {
          console.error('[prompt-library] 取草稿选区失败：', error);
          library.reportResult(false, 'capture-failed', claimed.text);
          return;
        }
        let ok = false;
        try {
          ok = inputActions.insertText(claimed.text, span) === true;
        } catch (error) {
          console.error('[prompt-library] 插入失败：', error);
        }
        library.reportResult(ok, ok ? null : 'rejected', claimed.text);
      }, [pending, inputActions, sessionId]);

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
.pl-modal{position:fixed;z-index:1000;top:var(--dsh-frame-chrome-top,0px);right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--dsw-static-neutral-1000,#000) 36%,transparent);max-width:none;width:auto;margin:0;overscroll-behavior:contain}
.pl-dialog{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;width:min(640px,100%);max-height:100%;overflow:auto;padding:20px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);overscroll-behavior:contain}
.pl-dialog-head{display:flex;flex-direction:column;gap:2px}
.pl-dialog-title{margin:0;font-size:17px;font-weight:600;line-height:24px}
.pl-dialog-hint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12.5px;line-height:18px}
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
.pl-head-actions{display:flex;gap:8px;flex:none;align-items:center}
.pl-notice{color:var(--dsw-alias-state-business-primary);margin:0;font-size:13px;line-height:20px}
.pl-select{height:40px;width:100%;padding:0 10px}
.pl-groups{display:flex;flex-direction:column;gap:18px}
.pl-group{display:flex;flex-direction:column;gap:2px}
.pl-group-head{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:.5px solid var(--dsw-alias-border-l2);padding:6px 2px}
.pl-group-toggle{display:inline-flex;align-items:center;gap:8px;background:transparent;border:0;padding:2px 4px;margin:0;cursor:pointer;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;border-radius:var(--dsw-radius-sm)}
.pl-group-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pl-group-toggle-static{cursor:default}
.pl-group-toggle-static:hover{background:transparent}
.pl-caret{width:12px;display:inline-block;color:var(--dsw-alias-label-tertiary)}
.pl-group-name{font-weight:600}
.pl-group-count{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400}
.pl-group-actions{display:flex;align-items:center;gap:8px;flex:none}
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
      tag.dataset.plugin = 'dsh-prompt-library';
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

        // 主会话查询端口：面板是 root 作用域的全局页面，写插入意图时必须知道
        // "用户原本在哪个会话"，才能让意图只被那个会话的中继认领。
        // 用嵌套 ctx.inject，理由同下面的 commandUi：不改变插件整体激活条件。
        ctx.inject(['sessions'], (scope) => {
          const sessions = scope.get('sessions');
          if (sessions === undefined) return;
          const readById = () => {
            const list = sessions.list;
            const snapshot =
              list !== undefined && typeof list.getSnapshot === 'function' ? list.getSnapshot() : undefined;
            return snapshot && snapshot.byId ? snapshot.byId : {};
          };
          sessionQuery.currentId = () => {
            const rows = readById();
            return Object.values(rows).find((row) => (row?.retainedBy?.mainView ?? 0) > 0)?.id;
          };
          sessionQuery.isMain = (sessionId) =>
            (readById()[sessionId]?.retainedBy?.mainView ?? 0) > 0;
        });

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
        //
        // 主注册放在 `conversation.composer.dock`（会话已有消息时的 composer dock）。
        // 备用注册放在 `conversation.input.left`——它在**新建/空白会话（hero）**的
        // composer 里也会渲染，而 `conversation.composer.dock` 只在 variant === "composer"
        // 时渲染。两处都挂同一个中继；认领是原子的，所以同一意图只会落笔一次。
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'prompt-library-insert', order: 900 },
            InsertRelay,
          ),
        );
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: 'prompt-library-insert-hero', order: 900 },
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
                  // 按分组顺序输出，组内最新在前；未分组垫底。
                  // popupSelect 支持 option.group = { name, label }，会渲染成吸顶分组标题。
                  options: async () => {
                    const { prompts, groups } = library.getState();
                    const groupById = new Map(groups.map((group) => [group.id, group]));
                    const buckets = new Map();
                    for (const group of groups) buckets.set(group.id, []);
                    const ungrouped = [];
                    for (const prompt of prompts) {
                      if (typeof prompt.groupId === 'string' && groupById.has(prompt.groupId)) {
                        buckets.get(prompt.groupId).push(prompt);
                      } else {
                        ungrouped.push(prompt);
                      }
                    }
                    const options = [];
                    const emit = (items, group) => {
                      const meta =
                        group === null
                          ? { name: '__ungrouped__', label: '未分组' }
                          : { name: group.id, label: group.name };
                      for (const prompt of [...items].reverse()) {
                        options.push({
                          id: prompt.id,
                          label: prompt.title,
                          detail: preview(prompt.body),
                          group: meta,
                        });
                      }
                    };
                    for (const group of groups) emit(buckets.get(group.id), group);
                    if (ungrouped.length > 0) emit(ungrouped, null);
                    return options;
                  },
                  onSelect: (option, context) => {
                    // 只认 id，再回库里取正文：不依赖框架是否透传自定义字段。
                    const prompt = library
                      .getState()
                      .prompts.find((item) => item.id === option.id);
                    if (prompt === undefined) return;
                    // ui-commands 把「打开命令时所在的 session」原样作为 context 传给 onSelect，
                    // 必须带上它——否则多挂载的其它 composer 会抢走意图，插到别的对话。
                    const targetSessionId =
                      context !== null && typeof context === 'object' ? context.sessionId : undefined;
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
                    setTimeout(() => library.requestInsert(prompt.body, targetSessionId), 0);
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
