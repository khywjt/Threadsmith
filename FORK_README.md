# Threadsmith: tagged-title research workflow (personal customization)

Upstream: https://github.com/jonlai211/Threadsmith (MIT © Jonathan Lai).
This extension customization preserves the upstream license and native ChatGPT
rename/preview/undo workflow. It does not introduce a backend.

## Install / update

1. Open `chrome://extensions`, enable Developer mode, **Load unpacked**, and select this repository directory.
2. In the extension's **toolbar popup > Settings**, select DeepSeek, enter your
   API key **locally**, model `deepseek-flash`, language 中文, and title mode
   `[Label] Topic`. Configure one allowed label per line and optional naming instructions; Save.
3. On `chatgpt.com`, choose a small number of non-sensitive conversations, Generate,
   inspect candidate labels/titles, and only then Apply. Use per-row Undo as needed.

Do **not** put API keys in GitHub, issue reports, source files, or agent prompts.
Text sent to DeepSeek is disclosed to DeepSeek. If a conversation includes
sensitive research/personal data, leave it unchecked (or use a local model).

## What changed

- Defaults to `[LABEL] concise topic` mode with an editable, strict label allowlist; the original style remains available.
- Research title rules v0.1 use an ownership label and optionally a purpose word
  such as `审阅·` when it adds useful distinction. The 16–28 character target
  is guidance; the existing validator's length limits remain mandatory.
- When the provider reports uncertain ownership or does not report certainty,
  the candidate requires a valid manual edit before it can be applied. An
  existing allowed label is retained in the review field in this case.
- The unchanged original built-in label list is upgraded to the v0.1 defaults
  when settings are loaded. Custom label lists and naming instructions remain
  editable and are preserved; loading alone does not rewrite storage.
- Uses a head-two + tail-eight message excerpt for long threads in tagged mode;
  ordinary mode is unchanged.
- Preserves leading square brackets lost in the upstream title recovery step.
- Rejects invalid labels/titles before the Apply action; native preview, manual
  editing and Undo remain available.
- Uses the current `deepseek-flash` default for new settings. Existing saved
  provider choices are not overwritten.
- Removes one upstream-specific private IP from host permissions.
- Leaves all review rows unselected initially; generation and Apply require an explicit selection.

## Terra workflow

Use **ChatGPT Work** with GPT-6.1 Terra and authorized Computer Use to load the
unpacked extension, fill settings, exercise the preview UI with a test chat and
check actual rename/undo behavior. Computer Use availability is session/mode-
dependent; a connected GitHub reader alone cannot operate the live browser.
For code edits in Codex CLI: `codex -m gpt-6.1-terra`.

Suggested operating habit: generate a small batch -> check tag accuracy ->
Apply only the checked rows. Don't auto-apply titles to all historical chats.

## Limitations

This patch has static tests; it cannot substitute for a signed-in ChatGPT UI
smoke test. ChatGPT's sidebar DOM can change. The extension reads the full
conversation page to collect the subset sent to your configured AI provider.
