const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

function setup(initialData = {}) {
  const data = { ...initialData };
  const storage = {
    async get(keys) {
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(values) { Object.assign(data, values); },
    async remove(key) { delete data[key]; }
  };
  const context = vm.createContext({ window: {}, chrome: { storage: { local: storage } }, URL });
  for (const file of ["lib/providers.js", "lib/prompts.js", "lib/validators.js", "lib/title_rules.js"]) {
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  }
  const ns = context.window.Threadsmith;
  ns.__testStorage = data;
  return ns;
}

async function enableTags(ns) {
  const cfg = ns.config;
  await cfg.saveSettings({
    ...cfg.normalizeSettings(null),
    titleRules: {
      mode: "tagged",
      labelsText: "[BAO-Fig2]\nBAO-Fig3\nAI-Tools\nOther",
      instructions: "Prefer the exact figure branch."
    }
  });
  await cfg.loadSettings();
}

test("preserves bracketed JSON titles in tagged mode", async () => {
  const ns = setup();
  await enableTags(ns);
  assert.equal(ns.validators.extractTitleCandidate({ title: "[BAO-Fig3] 流形时间组织分析" }),
    "[BAO-Fig3] 流形时间组织分析");
});

test("enforces allowed labels without changing the topic-quality checks", async () => {
  const ns = setup();
  await enableTags(ns);
  assert.equal(ns.validators.isBadTitle("[BAO-Fig3] 时间指标发展效应", "zh"), false);
  assert.equal(ns.validators.isBadTitle("[BAO-Fig9] 时间指标发展效应", "zh"), true);
  assert.equal(ns.validators.isBadTitle("BAO-Fig3] 时间指标发展效应", "zh"), true);
  assert.equal(ns.validators.isBadTitle("[BAO-Fig3][Other] 时间指标发展效应", "zh"), true);
  assert.equal(ns.validators.isBadTitle("[BAO-Fig3] 如何修改这个", "zh"), true);
});

test("prompt uses an exact allowed-label list and head/tail context", async () => {
  const ns = setup();
  await enableTags(ns);
  const messages = Array.from({ length: 12 }, (_, i) => ({ role: "user", text: `distinct-message-${i}` }));
  const out = ns.prompts.buildTitleMessages({
    language: "zh", originalTitle: "进一步分析", messages,
    options: { messageLimit: 4, charLimit: 500 }
  });
  assert.match(out[0].content, /\[BAO-Fig2\]/);
  assert.match(out[0].content, /\[BAO-Fig3\]/);
  assert.match(out[0].content, /Prefer the exact figure branch/);
  assert.match(out[1].content, /distinct-message-0/);
  assert.match(out[1].content, /distinct-message-1/);
  assert.doesNotMatch(out[1].content, /distinct-message-2\b/);
  assert.match(out[1].content, /distinct-message-11/);
});

test("default/original mode stays compatible with upstream", async () => {
  const ns = setup();
  await ns.config.saveSettings({ ...ns.config.normalizeSettings(null), titleRules: { mode: "original" } });
  await ns.config.loadSettings();
  assert.equal(ns.validators.isBadTitle("NUC - 网络迁移", "zh"), false);
  const out = ns.prompts.buildTitleMessages({
    language: "zh", originalTitle: "Old", messages: [{ role: "user", text: "Hello" }]
  });
  assert.match(out[0].content, /specific noun\/object/);
  assert.equal(ns.titleRules.parseLabels("[BAO-Fig3]\nBAO-Fig3\nAI-Tools").join(","),
    "BAO-Fig3,AI-Tools");
});

test("v0.1 defaults and old built-in settings use the requested editable labels", async () => {
  const ns = setup();
  await ns.config.loadSettings();
  const expected = "Fig0,Fig1,Fig2,Fig3,Fig4,SRM,ISC,GEOM,IS-ETS,ENV,FAM,BAO,CCBD,AI,Bridge,Codex";
  assert.equal(ns.titleRules.parseLabels(ns.titleRules.getRules().labelsText).join(","), expected);
  const oldDefaults = {
    mode: "tagged",
    labelsText: "BAO-Fig0\nBAO-Fig1\nBAO-Fig2\nBAO-Fig3\nBAO-Fig4\nBAO-IS-ETS\nBAO-ENV\nAI-Tools\nOther",
    instructions: "Use the most specific matching label; use Other only if no label fits. Describe the scientific question or concrete task, not the last user reply."
  };
  const migrated = ns.titleRules.normalizeRules(oldDefaults);
  assert.equal(ns.titleRules.parseLabels(migrated.labelsText).join(","), expected);
  assert.equal(migrated.instructions, "");
  const existingInstall = setup({ "threadsmith.titleRules": oldDefaults });
  const loaded = await existingInstall.config.loadSettings();
  assert.equal(existingInstall.titleRules.parseLabels(loaded.titleRules.labelsText).join(","), expected);
  assert.equal(existingInstall.__testStorage["threadsmith.titleRules"].labelsText, oldDefaults.labelsText,
    "loading alone should not overwrite saved data");
});

test("custom labels and naming instructions remain editable and are preserved", async () => {
  const ns = setup();
  const custom = { mode: "tagged", labelsText: "MyProject\nBAO-Fig3", instructions: "Keep specific technical names." };
  await ns.config.saveSettings({ ...ns.config.normalizeSettings(null), titleRules: custom });
  const loaded = await ns.config.loadSettings();
  assert.equal(loaded.titleRules.labelsText, custom.labelsText);
  assert.equal(loaded.titleRules.instructions, custom.instructions);
  assert.equal(ns.titleRules.getAllowedLabel("[BAO-Fig3] 原有主题"), "BAO-Fig3");
  assert.equal(ns.titleRules.getAllowedLabel("[Fig3] 原有主题"), "");
});

test("v0.1 prompt describes ownership, optional purposes and uncertain review", async () => {
  const ns = setup();
  await ns.config.loadSettings();
  const out = ns.prompts.buildTitleMessages({ language: "zh", originalTitle: "test", messages: [] });
  const system = out[0].content;
  assert.match(system, /\[Fig3\]/);
  assert.match(system, /研讨, 验证, 实现, 排障, 审阅, 统筹/);
  assert.match(system, /Omit the purpose when the topic is already clear/);
  assert.match(system, /main question and intended deliverable/);
  assert.match(system, /do not guess a label/);
  assert.match(system, /needs_review/);
  assert.match(system, /16–28/);
  assert.match(system, /Do not merely prepend a label/);
  assert.match(system, /Still summarize the actual topic/);
});

test("long messages retain their beginning and end and precede the old title hint", async () => {
  const ns = setup();
  await ns.config.loadSettings();
  const messages = [{ role: "user", text: `TASK_START ${"x".repeat(1600)} DELIVERABLE_END` }];
  const out = ns.prompts.buildTitleMessages({ language: "zh", originalTitle: "模糊旧题", messages });
  assert.match(out[1].content, /TASK_START/);
  assert.match(out[1].content, /DELIVERABLE_END/);
  assert.ok(out[1].content.indexOf("Conversation excerpt:") < out[1].content.indexOf("Existing title (hint only"));
});

test("v0.1 validators accept the requested examples but reject invalid labels and lengths", async () => {
  const ns = setup();
  await ns.config.loadSettings();
  for (const title of [
    "[Fig3] 时间组织与发展效应",
    "[Fig1] 审阅·PPTX面板标注",
    "[GEOM] 验证·W/ANI指标一致性",
    "[FAM] 家庭环境量表编码",
    "[ENV] 家庭测量与环境指标关联",
    "[CCBD] 统筹·公共目录与规范",
    "[Bridge] 实现·结果上传接口",
    "[Fig3] 图2与图3证据衔接",
    "[AI] 模型比较"
  ]) assert.equal(ns.validators.isBadTitle(title, "zh"), false, title);
  assert.equal(ns.validators.isBadTitle("[UNKNOWN] 时间组织分析", "zh"), true);
  assert.equal(ns.validators.isBadTitle("[Fig2][Fig3] 论文证据衔接", "zh"), true);
  assert.equal(ns.validators.isBadTitle("[Fig3] 论文[Fig2]证据衔接", "zh"), true);
  assert.equal(ns.validators.isBadTitle(`[Fig3] ${"长".repeat(35)}`, "zh"), true);
  assert.equal(ns.validators.isBadTitle(`[BAO] ${"研".repeat(30)}`, "zh"), false,
    "the 16–28 character target is not a hard upper limit");
  const extracted = ns.validators.extractTitleCandidate({ title: "[Fig3] 时间组织与发展效应" });
  assert.equal(extracted, "[Fig3] 时间组织与发展效应");
});
