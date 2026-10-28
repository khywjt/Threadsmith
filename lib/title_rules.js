// Optional, locally configured [TAG] title mode for Threadsmith.
// Loaded after providers/prompts/validators on ChatGPT pages and after providers
// in the popup. No new network calls, permissions or backend.
(function () {
  const NS = (window.Threadsmith = window.Threadsmith || {});
  const config = NS.config;
  if (!config) return;

  const RULES_KEY = "threadsmith.titleRules";
  const DEFAULTS = {
    mode: "tagged",
    labelsText: "BAO-Fig0\nBAO-Fig1\nBAO-Fig2\nBAO-Fig3\nBAO-Fig4\nBAO-IS-ETS\nBAO-ENV\nAI-Tools\nOther",
    instructions: "Use the most specific matching label; use Other only if no label fits. Describe the scientific question or concrete task, not the last user reply."
  };
  let activeRules = { ...DEFAULTS };

  function parseLabels(input) {
    const raw = String(input || "").split(/[\n,;，；]+/);
    return [...new Set(raw.map((s) => s.trim().replace(/^\[/, "").replace(/\]$/, ""))
      .filter((s) => /^[\p{L}\p{N}_-]{1,32}$/u.test(s)))].slice(0, 40);
  }

  function normalizeRules(raw) {
    const obj = raw && typeof raw === "object" ? raw : {};
    return {
      mode: obj.mode === "original" ? "original" : DEFAULTS.mode,
      labelsText: String(obj.labelsText ?? DEFAULTS.labelsText).slice(0, 2500),
      instructions: String(obj.instructions ?? DEFAULTS.instructions).slice(0, 2500)
    };
  }

  // Keep these settings in their own key. The upstream config's existing
  // normalizeSettings() discards keys it does not know about.
  const upstreamLoad = config.loadSettings;
  const upstreamSave = config.saveSettings;
  config.loadSettings = async function () {
    const settings = await upstreamLoad();
    const stored = await chrome.storage.local.get(RULES_KEY);
    activeRules = normalizeRules(stored[RULES_KEY]);
    return { ...settings, titleRules: { ...activeRules } };
  };
  config.saveSettings = async function (settings) {
    const base = await upstreamSave(settings);
    const rules = normalizeRules(settings?.titleRules || activeRules);
    await chrome.storage.local.set({ [RULES_KEY]: rules });
    activeRules = rules;
    return { ...base, titleRules: { ...rules } };
  };
  config.getTitleRules = () => ({ ...activeRules });
  NS.titleRules = { parseLabels, normalizeRules, getRules: () => ({ ...activeRules }) };

  if (NS.prompts) {
    const upstreamBuild = NS.prompts.buildTitleMessages;
    NS.prompts.buildTitleMessages = function (params) {
      if (activeRules.mode !== "tagged") return upstreamBuild(params);
      const labels = parseLabels(activeRules.labelsText);
      if (!labels.length) throw new Error("Configure at least one allowed title label first.");
      const messages = Array.isArray(params.messages) ? params.messages : [];
      // Use the start and end of long research threads rather than only the
      // last four turns. Preserve order, without duplicating short threads.
      const excerpt = messages.length <= 10
        ? messages
        : [...messages.slice(0, 2), ...messages.slice(-8)];
      const base = upstreamBuild({
        ...params,
        messages: excerpt,
        options: { ...(params.options || {}), messageLimit: Math.max(excerpt.length, 1), charLimit: 600 }
      });
      const lang = params.language === "en" ? "en" : "zh";
      const allowed = labels.map((x) => `[${x}]`).join(", ");
      const instructions = activeRules.instructions.trim();
      base[0].content = [
        "You rename ChatGPT conversations for reliable retrieval.",
        'Return ONLY valid JSON of the form {"title":"[LABEL] concise topic"}.',
        `Choose exactly ONE label from this list: ${allowed}.`,
        "The title MUST begin with the exact selected label in square brackets, followed by one space and a concise, specific topic.",
        "Do not invent labels. Never repeat a label. Keep technical names and project identifiers unchanged.",
        lang === "zh" ? "Write the topic primarily in Simplified Chinese." : "Write the topic in concise English.",
        "Describe the core subject of the conversation, not just the most recent reply.",
        `Limit the topic (excluding the label) to ${lang === "en" ? 56 : 34} characters and the entire title to 72 characters. Do not include explanations, markdown, or extra JSON properties.`,
        instructions ? `Additional user naming instructions: ${instructions}` : ""
      ].filter(Boolean).join("\n");
      if (params.repair) {
        base[1].content = base[1].content.replace(
          /Required correction:[^\n]*/,
          `Required correction: The title MUST have [one of ${labels.join(" | ")}] followed by a space and concise topic. The topic must be at most ${lang === "en" ? 56 : 34} characters, the entire title at most 72 characters.`
        );
      }
      return base;
    };
  }

  if (NS.validators) {
    const origExtract = NS.validators.extractTitleCandidate;
    const origBad = NS.validators.isBadTitle;
    // Upstream strips '[' when recovering JSON strings. In tagged mode,
    // preserve a correctly bracketed value before calling that recovery path.
    NS.validators.extractTitleCandidate = function (parsed, content) {
      if (activeRules.mode === "tagged") {
        const direct = typeof parsed?.title === "string" ? parsed.title.trim() : "";
        if (direct.startsWith("[")) return direct;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const keys = Object.keys(parsed);
          if (keys.length === 1 && keys[0].startsWith("[")) return keys[0].trim();
        }
        if (typeof content === "string") {
          try {
            const obj = JSON.parse(content);
            if (typeof obj?.title === "string" && obj.title.trim().startsWith("[")) return obj.title.trim();
          } catch { /* upstream recovery handles malformed output */ }
        }
      }
      return origExtract(parsed, content);
    };
    NS.validators.isBadTitle = function (title, language) {
      if (activeRules.mode !== "tagged") return origBad(title, language);
      const clean = String(title || "").replace(/\s+/g, " ").trim();
      if (clean.length > 72) return true;
      const match = clean.match(/^\[([^\]\n]+)\] (.+)$/u);
      if (!match) return true;
      const [, label, topic] = match;
      if (!parseLabels(activeRules.labelsText).includes(label)) return true;
      if (/[\[\]]/.test(topic)) return true;
      return origBad(topic, language);
    };
  }
})();
