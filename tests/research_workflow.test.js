const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

// Hand-written examples and canned provider replies. No real chats or network.
const examples = [
  ["Fig3 scientific discussion", "Fig3 的科学问题是时间组织如何随年龄发展，交付为论文图3的叙事。", "[Fig3] 时间组织与发展效应"],
  ["Fig1 PPTX review", "请审阅 Fig1 的 PPTX 面板标注和图例排版。", "[Fig1] 审阅·PPTX面板标注"],
  ["GEOM W/ANI validation", "验证 GEOM 的 W/ANI 指标定义和数值是否一致。", "[GEOM] 验证·W/ANI指标一致性"],
  ["FAM family measurement", "讨论 FAM 的家庭环境量表编码和家庭测量方案。", "[FAM] 家庭环境量表编码"],
  ["ENV family measurement", "讨论如何在 ENV 分析中关联家庭测量与环境指标。", "[ENV] 家庭测量与环境指标关联"],
  ["CCBD management", "统筹 CCBD 项目公共目录结构和共享规范。", "[CCBD] 统筹·公共目录与规范"],
  ["Bridge development", "为 Bridge 开发结果上传接口并实现基本传输流程。", "[Bridge] 实现·结果上传接口"],
  ["Fig2 and Fig3 with Fig3 deliverable", "讨论 Fig2 与 Fig3 的证据衔接，主要交付是 Fig3 的论文叙事。", "[Fig3] 图2与图3证据衔接"]
];

async function setup(replies, messages) {
  const data = {};
  const sent = [];
  const storage = {
    async get(keys) {
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(values) { Object.assign(data, values); },
    async remove(key) { delete data[key]; }
  };
  const context = vm.createContext({
    window: {}, URL,
    location: { href: "https://chatgpt.com/c/synthetic-test" },
    chrome: {
      storage: { local: storage },
      runtime: {
        onMessage: { addListener() {} },
        async sendMessage(message) {
          sent.push(message);
          if (!replies.length) throw new Error("No canned provider reply remains.");
          const parsed = replies.shift();
          return { ok: true, parsed, content: JSON.stringify(parsed) };
        }
      }
    }
  });
  for (const file of ["lib/providers.js", "lib/prompts.js", "lib/validators.js", "lib/title_rules.js"]) {
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  }
  const source = fs.readFileSync("content_script.js", "utf8");
  const marker = "  init();\n})();";
  assert.ok(source.includes(marker));
  const expose = `
  openConversation = async () => window.syntheticMessages;
  window.syntheticHarness = {
    generateTitleSuggestion, generatePreview, handleTitleInput,
    useSettings: (value) => { settings = value; }
  };
})();`;
  vm.runInContext(source.replace(marker, expose), context, { filename: "content_script.js" });
  const ns = context.window.Threadsmith;
  const settings = ns.config.normalizeSettings(null);
  settings.providers.deepseek.apiKey = "offline-synthetic-value";
  const saved = await ns.config.saveSettings(settings);
  context.window.syntheticHarness.useSettings(saved);
  context.window.syntheticMessages = messages;
  return { ns, harness: context.window.syntheticHarness, sent };
}

function makeRow(oldTitle) {
  const title = { value: "" };
  const checkbox = { checked: true, disabled: false };
  const badge = { className: "", textContent: "", title: "" };
  const detail = { textContent: "", classList: { toggle() {} } };
  const row = {
    dataset: {}, _target: { id: "synthetic-test", url: "https://chatgpt.com/c/synthetic-test", title: oldTitle },
    classList: { add() {}, toggle() {} },
    querySelector(selector) {
      return ({ ".title": title, 'input[type="checkbox"]': checkbox, ".row-status": badge, ".row-detail": detail })[selector];
    }
  };
  title.matches = (selector) => selector === ".title";
  title.closest = (selector) => selector === ".row" ? row : null;
  const controls = Object.fromEntries([".wf-stop", ".wf-generate", ".back-btn", ".refresh-btn", ".wf-apply", ".wf-summary"].map((key) => [key, { style: {} }]));
  const root = {
    querySelector: (selector) => controls[selector],
    querySelectorAll: (selector) => selector === ".session-list .row" ? [row] : []
  };
  return { row, root, title, checkbox, badge, detail, controls };
}

for (const [name, message, candidate] of examples) {
  test(`hand-written ${name} example reaches a valid preview`, async () => {
    const { ns, harness, sent } = await setup([{ title: candidate, needs_review: false }], [{ role: "user", text: message }]);
    const view = makeRow("待整理的测试主题");
    await harness.generatePreview([view.row], view.root);
    assert.equal(view.title.value, candidate);
    assert.equal(view.badge.textContent, "Ready");
    assert.equal(view.row._target.title, "待整理的测试主题");
    assert.equal(ns.validators.isBadTitle(view.title.value, "zh"), false);
    assert.match(sent[0].payload.messages[1].content, new RegExp(message));
    assert.match(sent[0].payload.messages[0].content, /needs_review/);
  });
}

for (const badTitle of ["[UNKNOWN] 时间组织与发展", "[Fig2][Fig3] 论文证据衔接"]) {
  test(`invalid candidate ${badTitle} is repaired before preview`, async () => {
    const replies = [
      { title: badTitle, needs_review: false },
      { title: "[Fig3] 时间组织与发展效应", needs_review: false }
    ];
    const { harness, sent } = await setup(replies, [{ role: "user", text: "Fig3 的时间组织与发展效应。" }]);
    const result = await harness.generateTitleSuggestion({ id: "synthetic-test", title: "旧测试标题" });
    assert.equal(result.title, "[Fig3] 时间组织与发展效应");
    assert.equal(result.repaired, true);
    assert.equal(sent.length, 2);
    assert.match(sent[1].payload.messages[1].content, /Required correction/);
    assert.match(sent[1].payload.messages[0].content, /needs_review/);
  });
}

test("uncertain ownership without an existing label is shown for manual review", async () => {
  const { harness, sent } = await setup(
    [{ title: "研究方向梳理", needs_review: true }],
    [{ role: "user", text: "讨论一个暂时无法归属的研究方向。" }]
  );
  const view = makeRow("旧测试对话");
  await harness.generatePreview([view.row], view.root);
  assert.equal(sent.length, 1, "uncertainty must not trigger a repair that guesses a label");
  assert.equal(view.title.value, "研究方向梳理");
  assert.equal(view.row.dataset.review, "true");
  assert.equal(view.checkbox.checked, false);
  assert.equal(view.checkbox.disabled, true);
  assert.equal(view.controls[".wf-apply"].disabled, true);
  assert.equal(view.badge.textContent, "Needs review");

  view.title.value = "[UNKNOWN] 研究方向梳理";
  harness.handleTitleInput({ target: view.title }, view.root);
  assert.equal(view.row.dataset.review, "true", "an invalid edit must stay in review");
  assert.equal(view.checkbox.disabled, true);

  view.title.value = "[BAO] 研究方向梳理";
  harness.handleTitleInput({ target: view.title }, view.root);
  assert.equal(view.row.dataset.review, undefined);
  assert.equal(view.badge.textContent, "Edited");
  assert.equal(view.checkbox.disabled, false);
  assert.equal(view.checkbox.checked, true);
  assert.equal(view.controls[".wf-apply"].disabled, false);
});

test("uncertain ownership preserves the valid original label for manual review", async () => {
  const { harness, sent } = await setup(
    [{ title: "[Fig3] 模型猜测的标签", needs_review: true }],
    [{ role: "user", text: "同时提到多个主题，但主要归属尚不明确。" }]
  );
  const view = makeRow("[ENV] 现有环境讨论标题");
  await harness.generatePreview([view.row], view.root);
  assert.equal(sent.length, 1);
  assert.equal(view.title.value, "[ENV] 现有环境讨论标题");
  assert.equal(view.row.dataset.review, "true");
  assert.equal(view.checkbox.disabled, true);
});

test("a missing certainty indicator cannot silently make a guessed label ready", async () => {
  const { harness, sent } = await setup(
    [{ title: "[Fig3] 时间组织与发展效应" }],
    [{ role: "user", text: "这是一段无法确定主要归属的测试文本。" }]
  );
  const view = makeRow("待整理的测试主题");
  await harness.generatePreview([view.row], view.root);
  assert.equal(sent.length, 1);
  assert.equal(view.row.dataset.review, "true");
  assert.match(view.detail.textContent, /did not confirm label certainty/);
});

test("an uncertain repair goes to review without another repair or invented label", async () => {
  const { harness, sent } = await setup(
    [{ title: "[UNKNOWN] 研究主题讨论", needs_review: false }, { title: "研究主题讨论", needs_review: true }],
    [{ role: "user", text: "多个研究问题同时出现，主要归属不确定。" }]
  );
  const view = makeRow("待整理的测试主题");
  await harness.generatePreview([view.row], view.root);
  assert.equal(sent.length, 2);
  assert.equal(view.title.value, "研究主题讨论");
  assert.equal(view.row.dataset.review, "true");
  assert.equal(view.controls[".wf-apply"].disabled, true);
});

test("an invalid repair remains in review and cannot be applied", async () => {
  const { harness, sent } = await setup(
    [{ title: "[UNKNOWN] 研究主题讨论", needs_review: false },
      { title: "[Fig2][Fig3] 论文证据衔接", needs_review: false }],
    [{ role: "user", text: "研究多个论文图之间的证据衔接。" }]
  );
  const view = makeRow("待整理的测试主题");
  await harness.generatePreview([view.row], view.root);
  assert.equal(sent.length, 2);
  assert.equal(view.title.value, "[Fig2][Fig3] 论文证据衔接");
  assert.equal(view.row.dataset.review, "true");
  assert.equal(view.checkbox.disabled, true);
  assert.equal(view.controls[".wf-apply"].disabled, true);
});
