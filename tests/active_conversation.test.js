const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function setup({ token, selected = true }) {
  const message = {
    getAttribute: (key) => key === "data-chatgpt-search-unit-key" ? "synthetic:1:user" : "",
    querySelector: () => ({ innerText: "A synthetic message for the active conversation." })
  };
  const scope = {
    innerText: "A synthetic message for the active conversation.",
    querySelector: () => target,
    querySelectorAll: (selector) => selector === "[data-chatgpt-search-unit-key]" ? [message] : []
  };
  const target = {
    getAttribute: (key) => key === "data-chatgpt-conversation-selection-target" ? token : "",
    closest: () => scope
  };
  let clock = 0;
  const context = vm.createContext({
    window: {}, URL, CSS: { escape: (x) => x },
    location: { href: "https://chatgpt.com/c/test-target" },
    Date: { now: () => (clock += 6000) },
    setTimeout: (callback) => callback(),
    document: {
      querySelector: (selector) => selector.startsWith('[data-app-shell-active-page=') ? target : null,
      querySelectorAll: () => selected ? [{ href: "https://chatgpt.com/c/test-target" }] : []
    },
    chrome: { runtime: { onMessage: { addListener() {} } } }
  });
  for (const file of ["lib/providers.js", "lib/prompts.js", "lib/validators.js", "lib/title_rules.js"]) {
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  }
  const source = fs.readFileSync("content_script.js", "utf8");
  const marker = "  init();\n})();";
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker, "  window.testWait = waitForConversationContent;\n})();"), context);
  return context.window;
}

test("does not read a previous conversation while a new page is loading", async () => {
  const window = setup({ token: "old-conversation" });
  const messages = await window.testWait("test-target", "old-conversation");
  assert.equal(messages.length, 0);
});

test("reads the new active conversation after its identity changes", async () => {
  const window = setup({ token: "new-conversation" });
  const messages = await window.testWait("test-target", "old-conversation");
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /synthetic message/);
});

test("does not read an active shell when its sidebar selection is not the target", async () => {
  const window = setup({ token: "new-conversation", selected: false });
  const messages = await window.testWait("test-target");
  assert.equal(messages.length, 0);
});
