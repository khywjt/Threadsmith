const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  const data = {};
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
  return context.window.Threadsmith;
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
