const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function setup({ fallback = false } = {}) {
  const data = {};
  const lines = Array.from({ length: 25 }, (_, i) => `synthetic conversation message number ${i}`);
  const nodes = lines.map((text) => ({
    getAttribute: (key) => key === "data-message-author-role" ? "user" : "",
    querySelector: () => ({ innerText: text })
  }));
  const scope = {
    innerText: lines.join("\n"),
    querySelectorAll: (selector) => selector === "[data-message-author-role]" && !fallback ? nodes : []
  };
  const context = vm.createContext({
    window: {}, URL,
    location: { href: "https://chatgpt.com/c/test-conversation" },
    CSS: { escape: (text) => text },
    document: { querySelector: () => ({ closest: () => scope }) },
    chrome: {
      storage: { local: {
        async get(keys) {
          const wanted = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, data[key]]));
        },
        async set(values) { Object.assign(data, values); },
        async remove(key) { delete data[key]; }
      } },
      runtime: { onMessage: { addListener() {} } }
    }
  });
  for (const file of ["lib/providers.js", "lib/prompts.js", "lib/validators.js", "lib/title_rules.js"]) {
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  }
  let script = fs.readFileSync("content_script.js", "utf8");
  const finalInit = "  init();\n})();";
  assert.ok(script.includes(finalInit));
  script = script.replace(finalInit, "  window.testExtractConversation = extractConversationText;\n})();");
  vm.runInContext(script, context, { filename: "content_script.js" });
  return context.window;
}

for (const fallback of [false, true]) {
  test(`tagged mode retains the beginning and end through extraction${fallback ? " fallback" : ""}`, async () => {
    const window = setup({ fallback });
    const ns = window.Threadsmith;
    await ns.config.loadSettings();
    assert.equal(ns.titleRules.getRules().mode, "tagged");
    const messages = window.testExtractConversation();
    const prompt = ns.prompts.buildTitleMessages({ language: "zh", originalTitle: "test", messages });
    assert.match(prompt[1].content, /message number 0\b/);
    assert.match(prompt[1].content, /message number 1\b/);
    assert.doesNotMatch(prompt[1].content, /message number 2\b/);
    assert.match(prompt[1].content, /message number 24\b/);
  });
}

test("original mode keeps the upstream last-14 extraction", async () => {
  const window = setup();
  const ns = window.Threadsmith;
  await ns.config.saveSettings({ ...ns.config.normalizeSettings(null), titleRules: { mode: "original" } });
  const messages = window.testExtractConversation();
  assert.equal(messages.length, 14);
  assert.match(messages[0].text, /message number 11\b/);
  assert.match(messages.at(-1).text, /message number 24\b/);
});
