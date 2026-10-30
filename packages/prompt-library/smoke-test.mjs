/**
 * 提示词库 Client 模块的桩测试。
 *
 * 用一个极小的 React 运行时替身（useState/useEffect/useRef/useMemo + 重渲染循环）
 * 真正跑组件，因此可以驱动交互：点按钮、改输入框、看落盘结果。
 * 这验证了语法检查抓不到的部分——注册契约、增删改查、搜索、以及
 * 「面板写意图 → 会话中继插入」这条跨作用域链路。
 *
 * 它**不能**证明 DSH 会渲染它，也不能证明真实的 Lexical 草稿插入成功；
 * 那些只能由 DSH 自己证明。
 *
 * 运行：node packages/prompt-library/smoke-test.mjs
 */

import { readFileSync } from 'node:fs';

/** package.json 的版本，用于断言面板自报的版本没有漂移。 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
/** client.js 源码：用于锁住"编辑弹窗必须固定定位"这条样式契约。 */
const clientSource = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

/** 让出一个宏任务边界，用于验证"写意图被延后到消费 token 之后"的时序契约。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
}

//#region 运行环境替身

const memory = new Map();
const captured = [];

globalThis.window = {
  localStorage: {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  },
  __ModuleLoader__: { load: (spec) => captured.push(spec) },
};

/** 当前正在渲染的实例；React 替身按它派发钩子（同 React 的 dispatcher 模型）。 */
let current = null;

const React = {
  createElement(type, props, ...children) {
    return {
      type,
      props: props ?? {},
      children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
    };
  },
  useState: (initial) => current.useState(initial),
  useEffect: (fn, deps) => current.useEffect(fn, deps),
  useRef: (initial) => current.useRef(initial),
  useMemo: (factory, deps) => current.useMemo(factory, deps),
};

const requireStub = (name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require: ${name}`);
};

function sameDeps(prev, next) {
  if (prev === undefined || next === undefined) return false;
  if (prev.length !== next.length) return false;
  return prev.every((value, index) => Object.is(value, next[index]));
}

/**
 * 挂载一个组件实例。返回的 render() 会一直重渲染到状态稳定
 * （与真实 React 一样，effect 在渲染后运行，新状态触发下一轮）。
 */
function mount(Component, initialProps) {
  const hooks = [];
  let props = initialProps ?? {};
  let dirty = false;
  let cursor = 0;
  let pendingEffects = [];
  let tree = null;

  const runtime = {
    useState(initial) {
      const index = cursor++;
      if (hooks[index] === undefined) {
        hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      }
      const slot = hooks[index];
      return [
        slot.value,
        (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next;
          if (Object.is(value, slot.value)) return;
          slot.value = value;
          dirty = true;
        },
      ];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const prev = hooks[index];
      if (prev !== undefined && sameDeps(prev.deps, deps)) return;
      if (prev !== undefined && typeof prev.cleanup === 'function') {
        try {
          prev.cleanup();
        } catch (error) {
          console.error('cleanup failed:', error);
        }
      }
      hooks[index] = { deps, cleanup: undefined };
      pendingEffects.push(() => {
        hooks[index].cleanup = fn();
      });
    },
    useRef(initial) {
      const index = cursor++;
      if (hooks[index] === undefined) hooks[index] = { current: initial };
      return hooks[index];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      const prev = hooks[index];
      if (prev === undefined || !sameDeps(prev.deps, deps)) {
        hooks[index] = { deps, value: factory() };
      }
      return hooks[index].value;
    },
  };

  return {
    get tree() {
      return tree;
    },
    render(nextProps) {
      if (nextProps !== undefined) props = nextProps;
      let pass = 0;
      do {
        dirty = false;
        cursor = 0;
        pendingEffects = [];
        current = runtime;
        try {
          tree = Component(props);
        } finally {
          current = null;
        }
        const effects = pendingEffects;
        pendingEffects = [];
        for (const run of effects) run();
        pass += 1;
      } while (dirty && pass < 25);
      return tree;
    },
  };
}

//#endregion

//#region 元素树工具

function collect(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  collect(node.children, out);
  return out;
}

function textOf(node) {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!node || typeof node !== 'object') return '';
  return textOf(node.children);
}

function buttons(tree, label, exact = false) {
  return collect(tree).filter(
    (node) =>
      node.type === 'button' && (exact ? textOf(node) === label : textOf(node).includes(label)),
  );
}

function fields(tree) {
  return collect(tree).filter((node) => node.type === 'input' || node.type === 'textarea');
}

/** 按可访问名/占位文字定位字段，而不是位置下标——搜索框的存在会顶掉下标。 */
const searchFieldOf = (tree) =>
  fields(tree).find((node) => node.props['aria-label'] === '搜索提示词');
const titleFieldOf = (tree) =>
  fields(tree).find((node) => node.props.placeholder === '留空则取正文首行');
const bodyFieldOf = (tree) => fields(tree).find((node) => node.type === 'textarea');

/** 模态对话框及其遮罩层。 */
const dialogOf = (tree) => collect(tree).find((node) => node.props?.role === 'dialog');
const modalOf = (tree) => collect(tree).find((node) => node.props?.className === 'pl-modal');

function rowWith(tree, title) {
  return collect(tree).find((node) => node.type === 'li' && textOf(node).includes(title));
}

/** 模拟一次输入：调用受控组件的 onChange。 */
function typeInto(field, value) {
  field.props.onChange({ target: { value } });
}

function click(button) {
  button.props.onClick();
}

function storedPrompts() {
  const raw = memory.get('dsh.prompt-library.v1');
  if (raw === undefined) return null;
  return JSON.parse(raw).prompts;
}

//#endregion

//#region 装载被测模块

console.log('提示词库 — 桩测试');
await import(new URL('./client.js', import.meta.url).href);

section('1. 模块契约');
check('模块加载器被调用一次', captured.length === 1, `got ${captured.length}`);
const spec = captured[0] ?? {};
check('factory id 等于包名', spec.id === '@local/dsh-prompt-library', `got ${JSON.stringify(spec.id)}`);
check('factory 是函数', typeof spec.factory === 'function');

const plugin = typeof spec.factory === 'function' ? spec.factory(requireStub) : {};
check('插件声明 inject: [slots]', Array.isArray(plugin.inject) && plugin.inject.includes('slots'));
check('插件暴露 apply()', typeof plugin.apply === 'function');

section('2. 注册契约');
const injections = [];
const registrations = [];
const effects = [];
const commandInjections = [];
const commandRegistrations = [];
const commandUi = {
  register: (spec) => {
    commandRegistrations.push(spec);
    return () => {};
  },
};
// sessions 服务替身：s1 是主会话（retainedBy.mainView = 1），s2 不是。
const sessionRows = {
  s1: { id: 's1', retainedBy: { mainView: 1 } },
  s2: { id: 's2', retainedBy: { mainView: 0 } },
};
const sessionsService = {
  list: { getSnapshot: () => ({ byId: sessionRows }) },
};
plugin.apply({
  effect: (fn) => {
    effects.push(fn);
    return fn();
  },
  inject: (names, callback) => {
    commandInjections.push(names.join(','));
    return callback({
      get: (name) =>
        name === 'commandUi' ? commandUi : name === 'sessions' ? sessionsService : undefined,
      effect: (fn) => fn(),
    });
  },
  slots: {
    inject: (name, callback) => {
      injections.push(name);
      return callback();
    },
    register: (options, component) => {
      registrations.push({ options, component });
      return () => {};
    },
  },
});

check(
  '注入了四个槽位',
  injections.join(',') ===
    'sidebar.panellist,main,conversation.composer.dock,conversation.input.left',
  injections.join(','),
);
check('注册了四条', registrations.length === 4, `got ${registrations.length}`);

const [panelEntry, mainEntry, relayEntry, heroRelayEntry] = registrations;
check('侧栏入口名称正确', panelEntry?.options.name === 'sidebar.panellist');
check('侧栏入口 id 为 prompts', panelEntry?.options.id === 'prompts', String(panelEntry?.options.id));
check('侧栏入口标签为「提示词」', panelEntry?.options.label === '提示词');
check(
  '侧栏 order 大于 0（才能排在【插件】order 0 之后）',
  typeof panelEntry?.options.order === 'number' && panelEntry.options.order > 0,
  String(panelEntry?.options.order),
);
check(
  'main 用 key 与侧栏 id 对齐（keyed slot 用 key 而非 id）',
  mainEntry?.options.name === 'main' && mainEntry.options.key === panelEntry?.options.id,
  `key=${JSON.stringify(mainEntry?.options.key)}`,
);
check(
  'main 注册没有误用 id',
  mainEntry?.options.id === undefined,
  `id=${JSON.stringify(mainEntry?.options.id)}`,
);
check(
  '中继注册进 session 作用域的 composer dock',
  relayEntry?.options.name === 'conversation.composer.dock',
);
check(
  '另有备用中继注册进 input.left（覆盖空白 hero 会话）',
  heroRelayEntry?.options.name === 'conversation.input.left',
);
check('样式通过 ctx.effect 注入', effects.length === 1, `got ${effects.length}`);
check(
  '模态遮罩使用 position:fixed（不随列表滚动，旧版内联编辑器回归守卫）',
  /\.pl-modal\{[^}]*position:fixed/.test(clientSource),
);

// 侧栏入口只提供图标：验证它按请求的边长画出来。
const icon = mount(panelEntry.component);
const iconTree = icon.render({ size: 20 });
check('侧栏图标渲染为 20px 的 SVG', iconTree?.type === 'svg' && iconTree.props.width === 20);
check('侧栏图标对读屏隐藏', iconTree?.props['aria-hidden'] === true);

// 从这里开始全部走真实交互路径。
const panel = mount(mainEntry.component);
const relay = mount(relayEntry.component);

section('3. 空态');
panel.render();
check('空库时提示新增', textOf(panel.tree).includes('还没有提示词'));
check('未写入任何持久化数据', storedPrompts() === null, JSON.stringify(storedPrompts()));
check(
  '面板底部自报版本，且与 package.json 一致',
  textOf(panel.tree).includes(`提示词库 v${pkg.version}`),
  `package.json=${pkg.version}`,
);

section('4. 新增');
click(buttons(panel.tree, '新增', true)[0]);
panel.render();
check(
  '新增打开的是 role=dialog 的模态层',
  dialogOf(panel.tree)?.props['aria-modal'] === true && modalOf(panel.tree) !== undefined,
);
check(
  '新增对话框标题为「新增提示词」',
  textOf(dialogOf(panel.tree)).includes('新增提示词'),
  textOf(dialogOf(panel.tree)),
);
// 回归：旧实现的编辑器内联在搜索框下面，列表一长就出现在视口外；现在必须是
// 固定定位的模态层，无论列表滚到哪里都可见（桩测试只能锁结构，视觉由 CSS 保证）。
const addDialog = dialogOf(panel.tree);
addDialog.props.onKeyDown({
  key: 'Escape',
  shiftKey: false,
  preventDefault: () => {},
});
panel.render();
check('Esc 关闭对话框', dialogOf(panel.tree) === undefined && titleFieldOf(panel.tree) === undefined);

click(buttons(panel.tree, '新增', true)[0]);
panel.render();
check(
  '编辑器出现标题与正文两个字段',
  titleFieldOf(panel.tree) !== undefined && bodyFieldOf(panel.tree) !== undefined,
  `inputs=${fields(panel.tree).length}`,
);
check('保存按钮在正文为空时禁用', buttons(panel.tree, '保存', true)[0]?.props.disabled === true);

typeInto(titleFieldOf(panel.tree), '代码审查');
typeInto(bodyFieldOf(panel.tree), '请审查这段代码，重点看边界条件。');
panel.render();
click(buttons(panel.tree, '保存', true)[0]);
panel.render();

const afterAdd = storedPrompts();
check('落盘一条', Array.isArray(afterAdd) && afterAdd.length === 1, JSON.stringify(afterAdd));
check('落盘标题正确', afterAdd?.[0]?.title === '代码审查', String(afterAdd?.[0]?.title));
check(
  '落盘正文正确',
  afterAdd?.[0]?.body === '请审查这段代码，重点看边界条件。',
  String(afterAdd?.[0]?.body),
);
check('列表显示该条目', textOf(panel.tree).includes('代码审查'));
check('编辑器已关闭', titleFieldOf(panel.tree) === undefined);

section('5. 标题留空时取正文首行');
click(buttons(panel.tree, '新增', true)[0]);
panel.render();
typeInto(bodyFieldOf(panel.tree), '第二行才是重点\n其余内容');
panel.render();
click(buttons(panel.tree, '保存', true)[0]);
panel.render();
check(
  '标题派生自正文首行',
  storedPrompts()?.[1]?.title === '第二行才是重点',
  String(storedPrompts()?.[1]?.title),
);

section('6. 搜索');
typeInto(searchFieldOf(panel.tree), '边界条件');
panel.render();
check('命中时只显示匹配项', textOf(panel.tree).includes('代码审查') && !textOf(panel.tree).includes('第二行才是重点'));
typeInto(searchFieldOf(panel.tree), '不存在的关键词');
panel.render();
check('未命中时给出空态', textOf(panel.tree).includes('没有匹配的提示词'));
typeInto(searchFieldOf(panel.tree), '');
panel.render();
check('清空查询后恢复全部', textOf(panel.tree).includes('第二行才是重点'));

section('7. 编辑');
const row1 = rowWith(panel.tree, '代码审查');
click(buttons(row1, '编辑', true)[0]);
panel.render();
check(
  '编辑对话框标题为「编辑提示词」',
  textOf(dialogOf(panel.tree)).includes('编辑提示词'),
  textOf(dialogOf(panel.tree)),
);
check(
  '编辑器不再是列表上方的内联区块（.pl-editor 已移除）',
  collect(panel.tree).every((node) => node.props?.className !== 'pl-editor'),
);
typeInto(titleFieldOf(panel.tree), '代码审查（改）');
typeInto(bodyFieldOf(panel.tree), '改过的正文');
panel.render();
click(buttons(panel.tree, '保存', true)[0]);
panel.render();
check('编辑已落盘', storedPrompts()?.[0]?.body === '改过的正文', String(storedPrompts()?.[0]?.body));
check('标题已更新', storedPrompts()?.[0]?.title === '代码审查（改）');
check('条目数未变', storedPrompts()?.length === 2, String(storedPrompts()?.length));

section('8. 使用 → 中继插入（跨作用域链路）');
click(buttons(rowWith(panel.tree, '第二行才是重点'), '使用', true)[0]);
panel.render();
check('面板显示已排队', textOf(panel.tree).includes('已排队：切回对话后插入'));

const calls = [];
let accept = true;
const span = { anchor: 3, focus: 3, draftRev: 11 };
const inputActions = {
  captureInsertion: () => span,
  insertText: (text, receivedSpan) => {
    calls.push({ text, span: receivedSpan });
    return accept;
  },
};

// 关键回归：面板写下的意图带目标会话 s1。另一个会话（s2）的中继即使同时挂载，
// 也不能抢走这份意图——否则就会出现"提示词插到另一个对话"的 bug。
const otherRelay = mount(relayEntry.component);
otherRelay.render({ inputActions, sessionId: 's2' });
check('非目标会话的中继不会认领（不会插到别的对话）', calls.length === 0, `got ${calls.length}`);

relay.render({ inputActions, sessionId: 's1' });
check('中继不渲染任何内容', relay.tree === null, String(relay.tree));
check('insertText 被调用一次', calls.length === 1, `got ${calls.length}`);
check('插入的是正文原文', calls[0]?.text === '第二行才是重点\n其余内容', JSON.stringify(calls[0]?.text));
check('传入了 captureInsertion 返回的 span（含 draftRev）', calls[0]?.span === span);

panel.render();
check('面板显示插入成功', textOf(panel.tree).includes('已插入到当前草稿'));

relay.render({ inputActions, sessionId: 's1' });
check('重复渲染不会二次插入', calls.length === 1, `got ${calls.length}`);

section('9. 插入被拒时的回执');
click(buttons(rowWith(panel.tree, '代码审查（改）'), '使用', true)[0]);
panel.render();
accept = false;
relay.render({ inputActions, sessionId: 's1' });
check('失败也调用了 insertText', calls.length === 2, `got ${calls.length}`);
panel.render();
check('面板显示失败原因', textOf(panel.tree).includes('未插入：草稿正忙或已被改动'));
accept = true;

section('10. 中继的防御性');
let threw = false;
try {
  relay.render({ inputActions: undefined, sessionId: 's1' });
} catch (error) {
  threw = true;
  console.log(`        threw: ${error.message}`);
}
check('inputActions 缺失时不抛异常', threw === false);

section('11. 删除');
const rowToDelete = rowWith(panel.tree, '代码审查（改）');
click(buttons(rowToDelete, '删除', true)[0]);
panel.render();
check('删除需要二次确认', buttons(panel.tree, '确认删除', true).length === 1);
click(buttons(panel.tree, '确认删除', true)[0]);
panel.render();
check('删除已落盘', storedPrompts()?.length === 1, String(storedPrompts()?.length));
check('列表不再显示该条目', !textOf(panel.tree).includes('代码审查（改）'));

section('12. /prompt 命令');
check(
  '通过嵌套 inject 等待 sessions 与 commandUi',
  commandInjections.join(',') === 'sessions,commandUi',
  commandInjections.join(','),
);
check('注册了一个命令', commandRegistrations.length === 1, `got ${commandRegistrations.length}`);
const cmd = commandRegistrations[0] ?? { ui: {} };
check('命令名为 prompt', cmd.name === 'prompt', String(cmd.name));
check('UI 规格是 popupSelect', cmd.ui?.kind === 'popupSelect', String(cmd.ui?.kind));
check('label 返回「提示词」', cmd.label?.() === '提示词', String(cmd.label?.()));
check('available 为真', cmd.available?.({ sessionId: 's1' }) === true);
const searchLabels = cmd.ui?.searchLabels?.() ?? {};
check(
  'searchLabels 提供三段文案',
  typeof searchLabels.placeholder === 'string' &&
    typeof searchLabels.empty === 'string' &&
    typeof searchLabels.noResults === 'string',
);

// 再添一条，用来验证「最新在前」的顺序与选项映射。
click(buttons(panel.tree, '新增', true)[0]);
panel.render();
typeInto(titleFieldOf(panel.tree), '最新一条');
typeInto(bodyFieldOf(panel.tree), '来自命令测试的正文');
panel.render();
click(buttons(panel.tree, '保存', true)[0]);
panel.render();

const options = await cmd.ui.options({ sessionId: 's1' });
check(
  '选项条数与库一致',
  options.length === storedPrompts().length,
  `${options.length} vs ${storedPrompts().length}`,
);
check('最新一条排在最前', options[0]?.label === '最新一条', String(options[0]?.label));
check(
  '选项 label 取标题、detail 取正文预览',
  options[0]?.label === '最新一条' && options[0]?.detail.includes('来自命令测试的正文'),
  JSON.stringify(options[0]),
);
check(
  '选项 id 指向对应条目（onSelect 靠它回库取正文）',
  options[0]?.id === storedPrompts().find((item) => item.title === '最新一条')?.id,
);

const callsBeforeSelect = calls.length;
cmd.ui.onSelect(options[0], { sessionId: 's1' });
panel.render();
check(
  '选中当刻不写意图（把草稿让给框架消费 token）',
  !textOf(panel.tree).includes('已排队'),
  '若这里就排队，ui-commands 的 span CAS guard 会因 rev 已推进而失配，/pro 会留在草稿里',
);

await tick();
panel.render();
check('下一个宏任务之后才写意图', textOf(panel.tree).includes('已排队：切回对话后插入'));

relay.render({ inputActions, sessionId: 's1' });
check(
  '选中后经中继插入恰一次',
  calls.length === callsBeforeSelect + 1,
  `got ${calls.length - callsBeforeSelect}`,
);
check(
  '插入的是该条正文原文',
  calls[calls.length - 1]?.text === '来自命令测试的正文',
  JSON.stringify(calls[calls.length - 1]?.text),
);

// 命令路径也必须带目标会话：用 s2 右键选中，s1 的中继不得认领。
const beforeCommandTarget = calls.length;
cmd.ui.onSelect(options[0], { sessionId: 's2' });
await tick();
relay.render({ inputActions, sessionId: 's1' });
check(
  '命令路径：非目标会话的中继不会认领',
  calls.length === beforeCommandTarget,
  `got ${calls.length - beforeCommandTarget}`,
);
relay.render({ inputActions, sessionId: 's2' });
check(
  '命令路径：目标会话的中继才插入',
  calls.length === beforeCommandTarget + 1,
  `got ${calls.length - beforeCommandTarget}`,
);

section('13. 空白会话（hero）的备用中继');
const heroRelay = mount(heroRelayEntry.component);
const beforeHero = calls.length;
click(buttons(rowWith(panel.tree, '第二行才是重点'), '使用', true)[0]);
panel.render();
heroRelay.render({ inputActions, sessionId: 's1' });
panel.render();
check(
  '空白会话下 input.left 中继也能插入',
  calls.length === beforeHero + 1,
  `got ${calls.length - beforeHero}`,
);
check(
  '插入的是该条正文原文',
  calls[calls.length - 1]?.text === '第二行才是重点\n其余内容',
  JSON.stringify(calls[calls.length - 1]?.text),
);

console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
