const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

test("DeepSeek requests use deepseek-flash and non-thinking JSON mode", async () => {
  let sent;
  const context = vm.createContext({
    window: {}, URL, AbortController, setTimeout, clearTimeout,
    chrome: { runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} } } },
    fetch: async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"[BAO-Fig3] 时间组织与发展效应"}' } }] }) };
    }
  });
  vm.runInContext(fs.readFileSync("lib/providers.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("service_worker.js", "utf8"), context);
  const model = context.window.Threadsmith.config.PROVIDERS.deepseek.defaultModel;
  assert.equal(model, "deepseek-flash");
  const result = await context.requestChatJson({
    transport: { baseURL: "https://api.deepseek.com", apiKey: "synthetic-test-value" },
    payload: { model, messages: [{ role: "user", content: "Synthetic test." }], jsonMode: true },
    label: "Test"
  });
  assert.equal(sent.url, "https://api.deepseek.com/chat/completions");
  assert.equal(sent.body.model, "deepseek-flash");
  assert.equal(sent.body.thinking.type, "disabled");
  assert.equal(sent.body.response_format.type, "json_object");
  assert.equal(result.parsed.title, "[BAO-Fig3] 时间组织与发展效应");
});
