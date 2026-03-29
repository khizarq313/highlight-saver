# Highlight Saver Pro

Highlight Saver Pro is a polished Manifest V3 Chrome extension for saving, organizing, and AI-summarizing text highlights from any webpage.

## Features

- Precision selection tooltip with five highlight colors and one-click save
- Persistent in-page highlights that stay visible after refresh
- Inline webpage editor for recoloring, summarizing, or removing a saved highlight
- Premium dark popup UI with search, filters, hover states, and smooth micro-interactions
- "This Page" filter that narrows results to the active tab's hostname
- Notes on every highlight with inline editing and auto-save on blur
- Relative timestamps like `just now`, `2m ago`, `3h ago`, and `Yesterday`
- AI summaries with Chrome built-in Summarizer API when supported
- OpenAI API fallback for summaries when a key is saved in settings
- Per-card AI summary, webpage highlight summary, and "Summarize All"
- Markdown export grouped by source site
- Local-only API key storage with a dedicated settings panel
- Highlight count badge on the extension action icon
- Smart card expansion with truncated previews and full-text reveal

## Installation

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `Highlight-Extension` folder.
5. Pin `Highlight Saver Pro` to the Chrome toolbar for quick access.

## How To Use

1. Select text on any webpage.
2. Choose a highlight color from the floating tooltip.
3. Click `Save`.
4. Refreshing the page keeps saved highlights visible in their chosen color.
5. Click a highlighted passage on the webpage to recolor it, summarize it, or remove it.
6. Open the popup to search, filter, annotate, summarize, export, or delete highlights.

Keyboard hint shown in the UI: `Press Alt+H to open`.

## AI Summaries

Highlight Saver Pro uses two summary modes:

- `Chrome built-in AI`: free local summarization using Chrome's Summarizer API when available on the user's browser/device
- `OpenAI fallback`: optional remote summarization if you save an API key in settings

If Chrome built-in AI is unavailable on a machine, the extension can still summarize through OpenAI.

## Add An OpenAI Key

1. Open the popup.
2. Click the settings gear in the top-right corner.
3. Paste your OpenAI API key into the `OpenAI API Key` field.
4. Click `Save Key`.

Your key is stored in `chrome.storage.local` and is only used when you explicitly trigger AI summaries.

## Privacy And Security

- No API keys or tokens should be committed to the repository.
- Saved OpenAI keys live in the browser's extension storage, not in the codebase.
- Page-specific highlight mirrors are stored locally in the page's `localStorage` for fast restore, while extension data is managed in `chrome.storage.local`.
- Before publishing or screen-sharing, remove any personal key from the extension settings if needed.

## Before Pushing To GitHub

1. Reload the unpacked extension so the latest source is what you are testing.
2. Open the extension settings and remove any personal OpenAI key if you do not want it left in local browser storage.
3. Run a quick repo search such as `rg 'sk-'` inside the project folder before pushing.

## Export Format

The export feature creates a `highlights.md` file in Markdown with grouped site sections, source URLs, save dates, and notes when available.

## Files

- `manifest.json`: MV3 configuration
- `content.js`: text-selection detection, persistent page highlights, and webpage editor actions
- `content.css`: injected tooltip, highlight, and webpage editor styling
- `popup.html`: popup structure and settings panel markup
- `popup.js`: popup state, rendering, storage helpers, export, and AI flows
- `styles.css`: popup design system and animations

## Screenshot Descriptions

- Popup overview: dark premium interface with header, search, filters, highlight cards, and footer actions
- Selection tooltip: floating save bar above selected text with color dots and save button
- Webpage editor: inline toolbar attached to a saved highlight with summarize, recolor, and remove actions
- Settings panel: local OpenAI key form with show/hide toggle and trust note
- AI summary panel: slide-up summary drawer above the footer
- Empty state: centered bookmark illustration with a first-use onboarding message

## Notes

- No external JavaScript dependencies are required.
- Everything is loadable directly through `Load unpacked` with no build step.
- Existing saved highlights are normalized on first load so older storage data still works after the upgrade.
- Chrome built-in AI availability depends on the user's Chrome version, platform, and model availability.
