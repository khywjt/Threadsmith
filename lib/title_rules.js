// Optional, locally configured [TAG] title mode for Threadsmith.
// Loaded after providers/prompts/validators on ChatGPT pages and after providers
// in the popup. No new network calls, permissions or backend.
(function () {
  const NS = (window.Threadsmith = window.Threadsmith || {});
  const config = NS.config;
  if (!config) return;

  const RULES_KEY = "threadsmith.titleRules";
  const LEGACY_LABELS = "BAO-Fig0\nBAO-Fig1\nBAO-Fig2\nBAO-Fig3\nBAO-Fig4\nBAO-IS-ETS\nBAO-ENV\nAI-Tools\nOther";
  const LEGACY_INSTRUCTIONS = "Use the most specific matching label; use Other only if no label fits. Describe the scientific question or concrete task, not the last user reply.";
  const DEFAULTS = {
    mode: "tagged",
    labelsText: "Fig0\nFig1\nFig2\nFig3\nFig4\nSRM\nISC\nGEOM\nIS-ETS\nENV\nFAM\nBAO\nCCBD\nAI\nBridge\nCodex",
    instructions: ""
  };
  let activeRules = { ...DEFAULTS };

  function parseLabels(input) {
    const raw = String(input || "").split(/[\n,;，；]+/);
    return [...new Set(raw.map((s) => s.trim().replace(/^\[/, "").replace(/\]$/, ""))
      .filter((s) => /^[\p{L}\p{N}_-]{1,32}$/u.test(s)))].slice(0, 40);
  }

  function normalizeRules(raw) {
    const obj = raw && typeof raw === "object" ? raw : {};
    // Replace only the old built-in defaults; preserve a user-edited allowlist
    // and instructions. Loading settings does not rewrite browser storage.
    const labelsText = String(obj.labelsText ?? DEFAULTS.labelsText);
    const instructions = String(obj.instructions ?? DEFAULTS.instructions);
    return {
      mode: obj.mode === "original" ? "original" : DEFAULTS.mode,
      labelsText: (labelsText === LEGACY_LABELS ? DEFAULTS.labelsText : labelsText).slice(0, 2500),
      instructions: (instructions === LEGACY_INSTRUCTIONS ? DEFAULTS.instructions : instructions).slice(0, 2500)
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
  function getAllowedLabel(title) {
    const match = String(title || "").trim().match(/^\[([^\]\n]+)\](?:\s|$)/u);
    return match && parseLabels(activeRules.labelsText).includes(match[1]) ? match[1] : "";
  }
  NS.titleRules = { parseLabels, normalizeRules, getAllowedLabel, getRules: () => ({ ...activeRules }) };

  if (NS.prompts) {
    function excerptMessage(text, limit) {
      const clean = String(text || "").replace(/\s+/g, " ").trim();
      if (clean.length <= limit) return clean;
      const separator = " … ";
      const available = limit - separator.length;
      let head = clean.slice(0, Math.floor(available * 0.7));
      let tail = clean.slice(-(available - head.length));
      // Do not split a Unicode surrogate pair at either cut.
      if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
      if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
      return `${head}${separator}${tail}`;
    }

    const upstreamBuild = NS.prompts.buildTitleMessages;
    NS.prompts.buildTitleMessages = function (params) {
      if (activeRules.mode !== "tagged") return upstreamBuild(params);
      const labels = parseLabels(activeRules.labelsText);
      if (!labels.length) throw new Error("Configure at least one allowed title label first.");
      const messages = Array.isArray(params.messages) ? params.messages : [];
      // Use the start and end of long research threads rather than only the
      // last four turns. Preserve order, without duplicating short threads.
      const selected = messages.length <= 10
        ? messages
        : [...messages.slice(0, 2), ...messages.slice(-8)];
      // Long messages can contain the task at the beginning and its main
      // result or deliverable at the end. Keep both within a bounded excerpt.
      const excerpt = selected.map((message) => ({
        ...message,
        text: excerptMessage(message.text, 1200)
      }));
      const base = upstreamBuild({
        ...params,
        messages: excerpt,
        options: { ...(params.options || {}), messageLimit: Math.max(excerpt.length, 1), charLimit: 1200 }
      });
      const lang = params.language === "en" ? "en" : "zh";
      const allowed = labels.map((x) => `[${x}]`).join(", ");
      const instructions = activeRules.instructions.trim();
      base[0].content = [
        "You propose research conversation titles for reliable retrieval; the user reviews every result.",
        'Return ONLY valid JSON with exactly two fields: {"title":"...","needs_review":false}. needs_review must be a boolean.',
        "Read the conversation first and identify its actual main object, concrete task or deliverable, and distinguishing retrieval terms. The old title is only a hint and may be vague or misleading.",
        "Do not merely prepend a label to a vague title such as 执行任务 or 整理内容 when the excerpt supports a more specific topic. For example, a directory and documentation audit can be titled [CCBD] 项目目录规范与文档盘点 when that label is allowed. Do not invent details; an already specific, accurate old title may be retained.",
        `The only allowed ownership labels are: ${allowed}. Select exactly ONE of them for a confident title.`,
        "A confident title has the format [LABEL] core topic, or [LABEL] purpose·core topic only when the purpose adds clear distinction.",
        "Optional purpose words are 研讨, 验证, 实现, 排障, 审阅, 统筹. Omit the purpose when the topic is already clear; do not add it mechanically.",
        "An ownership label represents a stable research object or work area, not a workflow status. Do not use ACTIVE, PAUSED, FROZEN, REF or CANON as default labels; retain a status in the topic only when it matters to the subject.",
        "Choose based on the main question and intended deliverable, not just the last messages. For a figure's scientific narrative, panel design or evidence organization prefer its Fig0–Fig4 label when available. For independent scientific methods, metrics or analysis prefer the matching research branch, such as SRM, ISC, GEOM, IS-ETS, ENV or FAM, when available.",
        "For BAO scientific work spanning branches, consider BAO; for CCBD directories, shared standards or engineering governance, consider CCBD; for AI tools and automation, consider AI, Bridge or Codex as appropriate. These are examples only: never choose a label outside the editable list above.",
        "When multiple branches are involved, prefer the primary deliverable. Do not assume the ChatGPT Project is known or infer a label solely from the last few messages.",
        'If ownership is genuinely unclear, set needs_review to true. Still summarize the actual topic as specifically as the evidence permits. If the old title starts with a label in the allowed list, retain that label; otherwise do not guess a label: return a short topic without brackets for manual review.',
        "Do not invent or repeat labels. Keep professional terms, technical names and retrieval keywords unchanged.",
        lang === "zh" ? "Write the topic primarily in Simplified Chinese." : "Write the topic in concise English.",
        `Aim for about 16–28 characters for the entire title, but do not pad or distort it; a somewhat longer title is allowed. The topic (excluding the label) must be at most ${lang === "en" ? 56 : 34} characters, and the entire title at most 72 characters. Do not include explanations, markdown, or extra JSON properties.`,
        instructions ? `Additional user naming instructions (do not override the allowed labels, uncertainty handling or length limits): ${instructions}` : ""
      ].filter(Boolean).join("\n");
      if (!params.repair) {
        const prefix = `Old title: ${params.originalTitle}\n\n`;
        if (base[1].content.startsWith(prefix)) {
          base[1].content = base[1].content.slice(prefix.length).replace(
            /\n\nReturn JSON only\.$/,
            `\n\nExisting title (hint only; may be vague): ${params.originalTitle}\n\nReturn JSON only.`
          );
        }
      }
      if (params.repair) {
        base[1].content = base[1].content.replace(
          /Required correction:[^\n]*/,
          `Required correction: If ownership is clear, use exactly one [${labels.join(" | ")}] label followed by a space and concise topic; otherwise set needs_review to true and do not guess. The topic must be at most ${lang === "en" ? 56 : 34} characters, the entire title at most 72 characters.`
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
