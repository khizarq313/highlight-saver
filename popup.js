const COLOR_OPTIONS = [
  { name: "Yellow", hex: "#fde68a" },
  { name: "Blue", hex: "#93c5fd" },
  { name: "Green", hex: "#6ee7b7" },
  { name: "Pink", hex: "#f9a8d4" },
  { name: "Orange", hex: "#fdba74" }
];

const VALID_COLORS = new Set(COLOR_OPTIONS.map((color) => color.hex));

const store = {
  get(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          const error = chrome.runtime?.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  },
  set(data) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(data, () => {
          const error = chrome.runtime?.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }
};

const tabs = {
  query(queryInfo) {
    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.query(queryInfo, (result) => {
          const error = chrome.runtime?.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  },
  create(createProperties) {
    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.create(createProperties, (result) => {
          const error = chrome.runtime?.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
};

let highlights = [];
let filter = { tab: "all", color: null, search: "" };
let currentPageUrl = "";
let currentPageHostname = "";
let searchDebounceId = 0;
let feedbackTimerId = 0;
let resultHideTimerId = 0;
let clearConfirmationVisible = false;
let pendingDeleteId = null;
let aiRequestInFlight = false;

const expandedCards = new Set();
const openNotes = new Set();

const elements = {
  highlightCount: document.getElementById("highlight-count"),
  headerCountChip: document.getElementById("header-count-chip"),
  searchInput: document.getElementById("search-input"),
  filterBar: document.getElementById("filter-bar"),
  inlineFeedback: document.getElementById("inline-feedback"),
  highlightsList: document.getElementById("highlights-list"),
  emptyState: document.getElementById("empty-state"),
  summarizeAllButton: document.getElementById("summarize-all-btn"),
  exportButton: document.getElementById("export-btn"),
  clearAllButton: document.getElementById("clear-all-btn"),
  clearConfirm: document.getElementById("clear-confirm"),
  clearConfirmYes: document.getElementById("clear-confirm-yes"),
  clearConfirmNo: document.getElementById("clear-confirm-no"),
  aiResult: document.getElementById("ai-result"),
  aiResultContext: document.getElementById("ai-result-context"),
  aiResultText: document.getElementById("ai-result-text"),
  aiResultClose: document.getElementById("ai-result-close"),
  settingsToggle: document.getElementById("settings-toggle"),
  settingsPanel: document.getElementById("settings-panel"),
  settingsClose: document.getElementById("settings-close"),
  settingsMessage: document.getElementById("settings-message"),
  apiKeyInput: document.getElementById("api-key-input"),
  toggleApiKey: document.getElementById("toggle-api-key"),
  saveKeyButton: document.getElementById("save-key-btn"),
  loadingOverlay: document.getElementById("loading-overlay"),
  loadingMessage: document.getElementById("loading-message")
};

const ICONS = {
  copy: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 9.5A2.5 2.5 0 0 1 11.5 7H17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-5.5A2.5 2.5 0 0 1 9 15.5v-6Z" />
      <path d="M6.5 15A2.5 2.5 0 0 1 4 12.5V7a2 2 0 0 1 2-2h7" />
    </svg>
  `,
  visit: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-9 9" />
      <path d="M10 7H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3" />
    </svg>
  `,
  sparkle: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Zm6 11 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z" />
    </svg>
  `,
  note: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15.5 5.5 3 3M6 18l3.25-.75L18 8.5a2.12 2.12 0 0 0-3-3L6.25 14.25 5.5 17.5 6 18Z" />
    </svg>
  `,
  trash: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M8 7l.5-2h7L16 7M7 7l.7 11a2 2 0 0 0 2 1.87h4.6A2 2 0 0 0 16.3 18L17 7" />
    </svg>
  `,
  chevron: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  `,
  reset: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.34 5.66L20 19M20 11h-6" />
    </svg>
  `
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  init().catch(() => {
    showInlineFeedback("The popup could not finish loading. Try reopening it.", "error", 4000);
  });
});

async function init() {
  await loadState();
  render();

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(handleStorageChange);
  }
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    const value = event.target.value;
    window.clearTimeout(searchDebounceId);

    searchDebounceId = window.setTimeout(() => {
      filter.search = value.trim().toLowerCase();
      renderList();
    }, 250);
  });

  elements.filterBar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter-type]");
    if (!button) {
      return;
    }

    const { filterType, filterValue } = button.dataset;

    if (filterType === "tab") {
      if (filterValue === "page" && !currentPageHostname) {
        showInlineFeedback("This Page is unavailable on the current tab.", "info");
        return;
      }

      filter.tab = filterValue;
    }

    if (filterType === "color") {
      filter.color = filter.color === filterValue ? null : filterValue;
    }

    renderFilterBar();
    renderList();
  });

  elements.summarizeAllButton.addEventListener("click", summarizeAllHighlights);
  elements.exportButton.addEventListener("click", exportHighlights);
  elements.clearAllButton.addEventListener("click", () => {
    if (!highlights.length) {
      showInlineFeedback("There are no highlights to clear yet.", "info");
      return;
    }

    toggleClearConfirmation(true);
  });
  elements.clearConfirmYes.addEventListener("click", clearAllHighlights);
  elements.clearConfirmNo.addEventListener("click", () => toggleClearConfirmation(false));
  elements.aiResultClose.addEventListener("click", hideAiResult);
  elements.settingsToggle.addEventListener("click", () => {
    openSettingsPanel().catch(() => {
      showInlineFeedback("Settings could not be opened.", "error");
    });
  });
  elements.settingsClose.addEventListener("click", closeSettingsPanel);
  elements.toggleApiKey.addEventListener("click", toggleApiKeyVisibility);
  elements.saveKeyButton.addEventListener("click", saveApiKey);
}

async function loadState() {
  const [{ highlights: storedHighlights = [] }, activeTab] = await Promise.all([
    store.get({ highlights: [] }),
    getActiveTab()
  ]);

  const normalized = normalizeHighlights(storedHighlights);
  highlights = normalized.items;

  currentPageUrl = activeTab?.url || "";
  currentPageHostname = getHostname(currentPageUrl);

  if (!currentPageHostname && filter.tab === "page") {
    filter.tab = "all";
  }

  if (normalized.migrated) {
    await store.set({ highlights });
  }
}

async function getActiveTab() {
  try {
    const [tab] = await tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (error) {
    return null;
  }
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (changes.highlights) {
    const normalized = normalizeHighlights(changes.highlights.newValue || []);
    highlights = normalized.items;

    if (filter.color && !highlights.some((item) => item.color === filter.color)) {
      filter.color = null;
    }

    if (pendingDeleteId && !highlights.some((item) => item.id === pendingDeleteId)) {
      pendingDeleteId = null;
    }

    if (highlights.length === 0) {
      expandedCards.clear();
      openNotes.clear();
      toggleClearConfirmation(false);
      hideAiResult();
    }

    render();
  }

  if (changes.openaiKey && isSettingsOpen()) {
    elements.apiKeyInput.value = changes.openaiKey.newValue || "";
  }
}

function normalizeHighlights(items) {
  let migrated = false;
  const normalizedItems = [];

  if (!Array.isArray(items)) {
    return { items: [], migrated: true };
  }

  items.forEach((item) => {
    if (!item || typeof item !== "object") {
      migrated = true;
      return;
    }

    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) {
      migrated = true;
      return;
    }

    const url = typeof item.url === "string" ? item.url : "";
    const hostname = getHostname(url);
    const title =
      typeof item.title === "string" && item.title.trim()
        ? item.title.trim()
        : hostname || "Untitled page";
    const color = VALID_COLORS.has(item.color) ? item.color : COLOR_OPTIONS[0].hex;
    const time = Number.isFinite(item.time) ? item.time : Date.now();
    const note = typeof item.note === "string" ? item.note : "";
    const id =
      typeof item.id === "string" && item.id.trim() ? item.id : crypto.randomUUID();
    const favicon =
      typeof item.favicon === "string" && item.favicon.trim()
        ? item.favicon
        : buildFaviconUrl(hostname);
    const pageKey =
      typeof item.pageKey === "string" && item.pageKey.trim()
        ? item.pageKey
        : getPageKey(url);
    const anchor = normalizeAnchor(item.anchor, text);

    if (
      id !== item.id ||
      title !== item.title ||
      color !== item.color ||
      note !== item.note ||
      favicon !== item.favicon ||
      pageKey !== item.pageKey ||
      !anchorsMatch(anchor, item.anchor)
    ) {
      migrated = true;
    }

    normalizedItems.push({
      id,
      text,
      url,
      pageKey,
      title,
      favicon,
      color,
      time,
      note,
      anchor
    });
  });

  return { items: normalizedItems, migrated };
}

function normalizeAnchor(anchor, fallbackText) {
  if (!anchor || typeof anchor !== "object") {
    return {
      exact: fallbackText,
      prefix: "",
      suffix: "",
      startXPath: "",
      startOffset: 0,
      endXPath: "",
      endOffset: 0
    };
  }

  return {
    exact:
      typeof anchor.exact === "string" && anchor.exact.trim()
        ? anchor.exact.trim()
        : fallbackText,
    prefix: typeof anchor.prefix === "string" ? anchor.prefix : "",
    suffix: typeof anchor.suffix === "string" ? anchor.suffix : "",
    startXPath: typeof anchor.startXPath === "string" ? anchor.startXPath : "",
    startOffset: Number.isFinite(anchor.startOffset) ? anchor.startOffset : 0,
    endXPath: typeof anchor.endXPath === "string" ? anchor.endXPath : "",
    endOffset: Number.isFinite(anchor.endOffset) ? anchor.endOffset : 0
  };
}

function anchorsMatch(nextAnchor, currentAnchor) {
  if (!currentAnchor || typeof currentAnchor !== "object") {
    return false;
  }

  return (
    nextAnchor.exact === currentAnchor.exact &&
    nextAnchor.prefix === currentAnchor.prefix &&
    nextAnchor.suffix === currentAnchor.suffix &&
    nextAnchor.startXPath === currentAnchor.startXPath &&
    nextAnchor.startOffset === currentAnchor.startOffset &&
    nextAnchor.endXPath === currentAnchor.endXPath &&
    nextAnchor.endOffset === currentAnchor.endOffset
  );
}

function render() {
  renderHeader();
  renderFilterBar();
  renderList();
  updateBadge();
}

function renderHeader() {
  const total = highlights.length;
  const label = `${total} highlight${total === 1 ? "" : "s"} saved`;
  elements.highlightCount.textContent = label;
  elements.headerCountChip.textContent = `${total} saved`;
}

function renderFilterBar() {
  const activeColors = COLOR_OPTIONS.filter((color) =>
    highlights.some((item) => item.color === color.hex)
  );

  if (filter.color && !activeColors.some((color) => color.hex === filter.color)) {
    filter.color = null;
  }

  elements.filterBar.innerHTML = "";

  const allButton = createFilterChip({
    label: "All",
    active: filter.tab === "all",
    type: "tab",
    value: "all"
  });

  const pageButton = createFilterChip({
    label: "This Page",
    active: filter.tab === "page",
    type: "tab",
    value: "page",
    disabled: !currentPageHostname,
    title: currentPageHostname
      ? `Filter to ${currentPageHostname}`
      : "This filter is unavailable on the current tab"
  });

  elements.filterBar.append(allButton, pageButton);

  activeColors.forEach((color) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "hl-color-filter";
    dot.dataset.filterType = "color";
    dot.dataset.filterValue = color.hex;
    dot.setAttribute("aria-label", `Filter ${color.name.toLowerCase()} highlights`);
    dot.setAttribute("title", color.name);
    dot.setAttribute("aria-pressed", String(filter.color === color.hex));
    dot.style.setProperty("--filter-color", color.hex);
    dot.classList.toggle("is-active", filter.color === color.hex);
    elements.filterBar.appendChild(dot);
  });
}

function createFilterChip({ label, active, type, value, disabled = false, title = "" }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hl-filter-chip";
  button.textContent = label;
  button.dataset.filterType = type;
  button.dataset.filterValue = value;
  button.disabled = disabled;
  button.title = title;
  button.setAttribute("aria-pressed", String(active));
  button.classList.toggle("is-active", active);
  return button;
}

function renderList() {
  const filteredHighlights = getFilteredHighlights();
  elements.highlightsList.innerHTML = "";

  if (highlights.length === 0) {
    elements.emptyState.hidden = false;
    elements.highlightsList.hidden = true;
    return;
  }

  elements.emptyState.hidden = true;
  elements.highlightsList.hidden = false;

  if (filteredHighlights.length === 0) {
    elements.highlightsList.appendChild(createNoResultsState());
    return;
  }

  const fragment = document.createDocumentFragment();

  filteredHighlights.forEach((highlight) => {
    fragment.appendChild(createHighlightCard(highlight));
  });

  elements.highlightsList.appendChild(fragment);
}

function getFilteredHighlights() {
  return [...highlights]
    .filter((highlight) => {
      if (filter.tab === "page" && currentPageHostname) {
        return getHostname(highlight.url) === currentPageHostname;
      }
      return true;
    })
    .filter((highlight) => {
      if (!filter.color) {
        return true;
      }
      return highlight.color === filter.color;
    })
    .filter((highlight) => {
      if (!filter.search) {
        return true;
      }

      const needle = filter.search;
      return [highlight.text, highlight.title, highlight.note, getHostname(highlight.url)]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle));
    })
    .sort((left, right) => right.time - left.time);
}

function createNoResultsState() {
  const wrapper = document.createElement("div");
  wrapper.className = "hl-no-results";

  const title = document.createElement("p");
  title.className = "hl-no-results-title";
  title.textContent = "No highlights match these filters.";

  const copy = document.createElement("p");
  copy.className = "hl-no-results-copy";
  copy.textContent = "Try a different search term or reset the active filters.";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "hl-reset-btn";
  resetButton.innerHTML = `${ICONS.reset}<span>Reset filters</span>`;

  resetButton.addEventListener("click", () => {
    filter = { tab: "all", color: null, search: "" };
    elements.searchInput.value = "";
    render();
  });

  wrapper.append(title, copy, resetButton);
  return wrapper;
}

function createHighlightCard(highlight) {
  const hostname = truncateText(getHostname(highlight.url) || "saved-page", 30);
  const card = document.createElement("article");
  card.className = "hl-card";
  card.style.borderLeftColor = highlight.color;

  if (expandedCards.has(highlight.id)) {
    card.classList.add("is-expanded");
  }

  const body = document.createElement("div");
  body.className = "hl-card-body";
  body.tabIndex = 0;
  body.setAttribute("role", "button");
  body.setAttribute("aria-label", "Expand saved highlight");
  body.setAttribute("aria-expanded", String(expandedCards.has(highlight.id)));

  const preview = document.createElement("p");
  preview.className = "hl-card-preview";
  preview.textContent = createExcerpt(highlight.text);

  const fullText = document.createElement("p");
  fullText.className = "hl-card-full";
  fullText.textContent = highlight.text;

  const sourceRow = document.createElement("div");
  sourceRow.className = "hl-source-row";

  const favicon = document.createElement("img");
  favicon.className = "hl-favicon";
  favicon.width = 14;
  favicon.height = 14;
  favicon.alt = "";
  favicon.src = highlight.favicon || buildFaviconUrl(hostname);
  favicon.addEventListener("error", () => {
    favicon.src = buildFallbackFavicon(hostname);
  });

  const host = document.createElement("span");
  host.className = "hl-host";
  host.textContent = hostname;
  host.title = getHostname(highlight.url) || highlight.title;

  const separator = document.createElement("span");
  separator.className = "hl-separator";
  separator.textContent = "·";

  const time = document.createElement("span");
  time.className = "hl-time";
  time.textContent = timeAgo(highlight.time);
  time.title = formatLongDate(highlight.time);

  sourceRow.append(favicon, host, separator, time);
  body.append(preview, fullText, sourceRow);

  body.addEventListener("click", () => {
    toggleExpandedCard(highlight.id);
  });

  body.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpandedCard(highlight.id);
    }
  });

  const actions = document.createElement("div");
  actions.className = "hl-action-row";

  const copyButton = createActionButton({
    label: "Copy",
    icon: ICONS.copy,
    className: "hl-action-btn"
  });
  copyButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await copyHighlightText(highlight, copyButton);
  });

  const visitButton = createActionButton({
    label: "Visit",
    icon: ICONS.visit,
    className: "hl-action-btn"
  });
  visitButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await tabs.create({ url: highlight.url });
    } catch (error) {
      showInlineFeedback("The source page could not be opened.", "error");
    }
  });

  const summarizeButton = createActionButton({
    label: "",
    icon: ICONS.sparkle,
    className: "hl-action-btn hl-icon-action",
    ariaLabel: "Summarize this highlight",
    title: "Summarize this highlight"
  });
  summarizeButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await summarizeSingleHighlight(highlight, summarizeButton);
  });

  const noteButton = createActionButton({
    label: "",
    icon: ICONS.note,
    className: "hl-action-btn hl-icon-action",
    ariaLabel: "Add or edit note",
    title: "Add note"
  });
  noteButton.classList.toggle(
    "is-active",
    openNotes.has(highlight.id) || Boolean(highlight.note)
  );
  noteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleNote(highlight.id);
  });

  const deleteButton = createActionButton({
    label: "",
    icon: ICONS.trash,
    className: "hl-action-btn hl-icon-action hl-danger-action",
    ariaLabel: "Delete highlight",
    title: "Delete highlight"
  });
  deleteButton.classList.toggle("is-pending", pendingDeleteId === highlight.id);
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    pendingDeleteId = pendingDeleteId === highlight.id ? null : highlight.id;
    renderList();
  });

  actions.append(copyButton, visitButton, summarizeButton, noteButton, deleteButton);

  if (pendingDeleteId === highlight.id) {
    const deleteConfirm = document.createElement("div");
    deleteConfirm.className = "hl-card-delete-confirm";

    const confirmLabel = document.createElement("span");
    confirmLabel.textContent = "Delete this highlight?";

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "hl-chip-btn hl-chip-btn-danger";
    confirmButton.textContent = "Yes";
    confirmButton.setAttribute("aria-label", "Confirm delete highlight");
    confirmButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteHighlight(highlight.id);
    });

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "hl-chip-btn";
    cancelButton.textContent = "Cancel";
    cancelButton.setAttribute("aria-label", "Cancel delete highlight");
    cancelButton.addEventListener("click", (event) => {
      event.stopPropagation();
      pendingDeleteId = null;
      renderList();
    });

    deleteConfirm.append(confirmLabel, confirmButton, cancelButton);
    actions.appendChild(deleteConfirm);
  }

  const noteWrap = document.createElement("div");
  noteWrap.className = "hl-note-wrap";
  const noteIsOpen = openNotes.has(highlight.id);
  noteWrap.classList.toggle("is-open", noteIsOpen);

  const noteLabel = document.createElement("label");
  noteLabel.className = "hl-note-label";
  noteLabel.textContent = "Personal note";
  noteLabel.setAttribute("for", `note-${highlight.id}`);

  const noteInput = document.createElement("textarea");
  noteInput.id = `note-${highlight.id}`;
  noteInput.className = "hl-note-input";
  noteInput.placeholder = "Add context, next steps, or why this matters...";
  noteInput.value = highlight.note;
  noteInput.dataset.noteId = highlight.id;
  noteInput.rows = 3;

  noteInput.addEventListener("click", (event) => event.stopPropagation());
  noteInput.addEventListener("keydown", (event) => event.stopPropagation());
  noteInput.addEventListener("blur", async () => {
    await saveHighlightNote(highlight.id, noteInput.value);
  });

  noteWrap.append(noteLabel, noteInput);
  card.append(body, actions, noteWrap);
  return card;
}

function createActionButton({
  label,
  icon,
  className,
  ariaLabel = "",
  title = ""
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  button.setAttribute("aria-label", ariaLabel || label);
  button.innerHTML = `${icon}${label ? `<span>${label}</span>` : ""}`;
  return button;
}

function toggleExpandedCard(id) {
  if (expandedCards.has(id)) {
    expandedCards.delete(id);
  } else {
    expandedCards.add(id);
  }

  renderList();
}

function toggleNote(id) {
  if (openNotes.has(id)) {
    openNotes.delete(id);
  } else {
    openNotes.add(id);
  }

  renderList();

  const noteInput = elements.highlightsList.querySelector(`[data-note-id="${id}"]`);
  if (noteInput) {
    noteInput.focus();
    noteInput.setSelectionRange(noteInput.value.length, noteInput.value.length);
  }
}

async function saveHighlightNote(id, nextValue) {
  const note = nextValue.trim();
  const updatedHighlights = highlights.map((item) =>
    item.id === id ? { ...item, note } : item
  );

  try {
    await store.set({ highlights: updatedHighlights });
    highlights = updatedHighlights;

    if (!note) {
      openNotes.delete(id);
    }

    render();
    showInlineFeedback("Note saved.", "success", 1500);
  } catch (error) {
    showInlineFeedback("The note could not be saved.", "error");
  }
}

async function copyHighlightText(highlight, button) {
  try {
    await navigator.clipboard.writeText(highlight.text);
    flashButtonState(button, "Copied!", "is-success");
  } catch (error) {
    showInlineFeedback("Clipboard access was blocked. Copy again after focusing the popup.", "error", 3500);
  }
}

async function deleteHighlight(id) {
  const nextHighlights = highlights.filter((item) => item.id !== id);

  try {
    await store.set({ highlights: nextHighlights });
    highlights = nextHighlights;
    pendingDeleteId = null;
    expandedCards.delete(id);
    openNotes.delete(id);
    toggleClearConfirmation(false);
    render();
    showInlineFeedback("Highlight deleted.", "success", 1600);
  } catch (error) {
    showInlineFeedback("The highlight could not be deleted.", "error");
  }
}

async function clearAllHighlights() {
  try {
    await store.set({ highlights: [] });
    highlights = [];
    expandedCards.clear();
    openNotes.clear();
    filter = { ...filter, color: null };
    toggleClearConfirmation(false);
    hideAiResult();
    render();
    showInlineFeedback("All highlights cleared.", "success");
  } catch (error) {
    showInlineFeedback("The highlights could not be cleared.", "error");
  }
}

function toggleClearConfirmation(show) {
  clearConfirmationVisible = show;
  elements.clearConfirm.hidden = !show;
  elements.clearAllButton.hidden = show;
}

async function exportHighlights() {
  if (!highlights.length) {
    showInlineFeedback("Save a few highlights before exporting.", "info");
    return;
  }

  const markdown = buildMarkdownExport();
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "highlights.md";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showInlineFeedback("Markdown export created.", "success", 1800);
}

function buildMarkdownExport() {
  const groups = new Map();
  const exportDate = formatExportDate(Date.now());

  [...highlights]
    .sort((left, right) => {
      const leftHost = getHostname(left.url);
      const rightHost = getHostname(right.url);
      return leftHost.localeCompare(rightHost) || right.time - left.time;
    })
    .forEach((highlight) => {
      const host = getHostname(highlight.url) || "saved-highlights";
      if (!groups.has(host)) {
        groups.set(host, []);
      }
      groups.get(host).push(highlight);
    });

  let output = `# My Highlights — Exported ${exportDate}\n\n`;

  groups.forEach((items, host) => {
    output += `## ${host}\n\n`;

    items.forEach((item) => {
      const cleanText = item.text.replace(/\s+/g, " ").trim();
      const cleanNote = item.note.replace(/\s+/g, " ").trim();
      output += `> "${cleanText}"\n`;
      output += `> Source: ${item.url}\n`;
      output += `> Saved: ${formatExportDate(item.time)}\n`;
      if (cleanNote) {
        output += `> Note: ${cleanNote}\n`;
      }
      output += `---\n\n`;
    });
  });

  return output.trimEnd();
}

async function summarizeAllHighlights() {
  if (aiRequestInFlight) {
    showInlineFeedback("An AI request is already in progress.", "info");
    return;
  }

  if (!highlights.length) {
    showInlineFeedback("Save highlights first, then we can summarize them.", "info");
    return;
  }

  const recentHighlights = [...highlights].sort((left, right) => right.time - left.time).slice(0, 15);
  const prompt = buildAllHighlightsPrompt(recentHighlights);
  const builtInInput = buildAllHighlightsBuiltInInput(recentHighlights);

  aiRequestInFlight = true;
  elements.summarizeAllButton.disabled = true;
  showLoading("Thinking through your highlights...");

  try {
    const result = await summarizeText({
      openAiPrompt: prompt,
      builtInText: builtInInput,
      builtInContext:
        "These are saved web highlights from different pages. Summarize the recurring themes in a concise overview.",
      builtInLength: "medium",
      onStatus: showLoading
    });
    showAiResult(
      result.summary,
      `${result.provider} · Across ${recentHighlights.length} recent highlight${recentHighlights.length === 1 ? "" : "s"}`
    );
    showInlineFeedback("AI summary is ready.", "success", 1800);
  } catch (error) {
    if (error.message) {
      showInlineFeedback(error.message, "error", 4500);
    }
  } finally {
    aiRequestInFlight = false;
    elements.summarizeAllButton.disabled = false;
    hideLoading();
  }
}

async function summarizeSingleHighlight(highlight, button) {
  if (aiRequestInFlight) {
    showInlineFeedback("Please wait for the current AI request to finish.", "info");
    return;
  }

  const prompt = `Summarize this in 1-2 sentences: ${highlight.text}`;
  aiRequestInFlight = true;
  elements.summarizeAllButton.disabled = true;
  showLoading("Summarizing this highlight...");

  try {
    flashButtonState(button, "…", "is-loading", 900);
    const result = await summarizeText({
      openAiPrompt: prompt,
      builtInText: highlight.text,
      builtInContext:
        "Summarize this saved highlight in 1-2 clear sentences.",
      builtInLength: "short",
      onStatus: showLoading
    });
    showAiResult(
      result.summary,
      `${result.provider} · ${truncateText(getHostname(highlight.url) || highlight.title, 28)}`
    );
  } catch (error) {
    if (error.message) {
      showInlineFeedback(error.message, "error", 4500);
    }
  } finally {
    aiRequestInFlight = false;
    elements.summarizeAllButton.disabled = false;
    hideLoading();
  }
}

function buildAllHighlightsPrompt(recentHighlights) {
  return [
    "Summarize the following saved web highlights.",
    "Write a concise thematic overview in 150 words or fewer.",
    "Group related ideas, point out repeating themes, and keep the tone crisp and useful.",
    "",
    recentHighlights
      .map((highlight, index) => {
        const source = getHostname(highlight.url) || highlight.title;
        const text = highlight.text.replace(/\s+/g, " ").trim();
        return `${index + 1}. [${source}] ${text}`;
      })
      .join("\n")
  ].join("\n");
}

function buildAllHighlightsBuiltInInput(recentHighlights) {
  return recentHighlights
    .map((highlight, index) => {
      const source = getHostname(highlight.url) || highlight.title;
      const text = highlight.text.replace(/\s+/g, " ").trim();
      return `Highlight ${index + 1} from ${source}: ${text}`;
    })
    .join("\n\n");
}

async function summarizeText({
  openAiPrompt,
  builtInText,
  builtInContext,
  builtInLength,
  onStatus
}) {
  let builtInError = null;
  const builtInAvailability = await getBuiltInSummaryAvailability();

  if (builtInAvailability !== "unsupported" && builtInAvailability !== "unavailable") {
    try {
      const summary = await requestBuiltInSummary({
        text: builtInText,
        context: builtInContext,
        length: builtInLength,
        onStatus
      });
      return { summary, provider: "Chrome built-in AI" };
    } catch (error) {
      builtInError = error;
    }
  }

  const apiKey = await getStoredApiKey();
  if (apiKey) {
    if (typeof onStatus === "function") {
      onStatus("Contacting OpenAI...");
    }

    const summary = await requestAiSummary(apiKey, openAiPrompt);
    return { summary, provider: "OpenAI" };
  }

  if (builtInError) {
    throw builtInError;
  }

  if (builtInAvailability === "unavailable") {
    throw new Error(
      "Chrome's built-in Summarizer API isn't available on this device, and no OpenAI API key is saved."
    );
  }

  await openSettingsPanel(
    "Save an OpenAI API key, or use Chrome built-in AI on a supported desktop browser.",
    "error"
  );
  throw new Error(
    "No summary provider is available yet. Save an OpenAI API key or use Chrome built-in AI."
  );
}

async function getBuiltInSummaryAvailability() {
  if (
    typeof self.Summarizer === "undefined" ||
    typeof self.Summarizer.availability !== "function"
  ) {
    return "unsupported";
  }

  try {
    return await self.Summarizer.availability();
  } catch (error) {
    return "unsupported";
  }
}

async function requestBuiltInSummary({ text, context, length, onStatus }) {
  if (
    typeof self.Summarizer === "undefined" ||
    typeof self.Summarizer.create !== "function"
  ) {
    throw new Error("Chrome built-in AI summaries aren't supported in this browser.");
  }

  if (typeof onStatus === "function") {
    onStatus("Preparing Chrome built-in AI...");
  }

  const summarizer = await self.Summarizer.create({
    type: "tldr",
    format: "plain-text",
    length,
    sharedContext: context,
    monitor(monitor) {
      if (typeof onStatus !== "function") {
        return;
      }

      monitor.addEventListener("downloadprogress", (event) => {
        const progress = Number.isFinite(event.loaded)
          ? Math.round(event.loaded * 100)
          : null;

        onStatus(
          progress !== null
            ? `Preparing Chrome built-in AI... ${progress}%`
            : "Preparing Chrome built-in AI..."
        );
      });
    }
  });

  try {
    return await summarizer.summarize(text);
  } catch (error) {
    throw new Error(
      "Chrome built-in AI couldn't summarize this yet. Try again or use an OpenAI API key."
    );
  } finally {
    if (typeof summarizer.destroy === "function") {
      summarizer.destroy();
    }
  }
}

async function requestAiSummary(apiKey, prompt) {
  let response;
  let data;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 20000);

  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200
      })
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("OpenAI took too long to respond. Please try again.");
    }

    throw new Error("Network error while contacting OpenAI. Check your connection and try again.");
  } finally {
    window.clearTimeout(timeoutId);
  }

  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    if (data?.error?.code === "insufficient_quota") {
      throw new Error(
        "Your OpenAI account has no remaining API quota right now. Add billing or use another key to enable summaries."
      );
    }

    if (response.status === 401) {
      throw new Error("Your OpenAI API key looks invalid. Update it in Settings and try again.");
    }

    if (response.status === 429) {
      throw new Error("OpenAI rate limited that request. Wait a moment and try again.");
    }

    if (response.status >= 500) {
      throw new Error("OpenAI is having trouble right now. Please try again shortly.");
    }

    throw new Error(
      data?.error?.message || "We couldn't generate a summary right now."
    );
  }

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty response. Please try again.");
  }

  return content;
}

async function getStoredApiKey() {
  try {
    const { openaiKey = "" } = await store.get({ openaiKey: "" });
    return openaiKey.trim();
  } catch (error) {
    return "";
  }
}

async function openSettingsPanel(message = "", tone = "info") {
  try {
    const { openaiKey = "" } = await store.get({ openaiKey: "" });
    elements.apiKeyInput.value = openaiKey;
  } catch (error) {
    elements.apiKeyInput.value = "";
  }

  elements.apiKeyInput.type = "password";
  elements.toggleApiKey.setAttribute("aria-label", "Show API key");
  elements.toggleApiKey.setAttribute("title", "Show API key");
  elements.toggleApiKey.classList.remove("is-active");

  elements.settingsPanel.classList.add("is-open");
  elements.settingsPanel.setAttribute("aria-hidden", "false");

  if (message) {
    showSettingsMessage(message, tone);
  } else {
    clearSettingsMessage();
  }
}

function closeSettingsPanel() {
  elements.settingsPanel.classList.remove("is-open");
  elements.settingsPanel.setAttribute("aria-hidden", "true");
  elements.apiKeyInput.type = "password";
  elements.toggleApiKey.setAttribute("aria-label", "Show API key");
  elements.toggleApiKey.setAttribute("title", "Show API key");
  elements.toggleApiKey.classList.remove("is-active");
  clearSettingsMessage();
}

function isSettingsOpen() {
  return elements.settingsPanel.classList.contains("is-open");
}

function toggleApiKeyVisibility() {
  const nextType = elements.apiKeyInput.type === "password" ? "text" : "password";
  elements.apiKeyInput.type = nextType;

  const show = nextType === "text";
  elements.toggleApiKey.setAttribute("aria-label", show ? "Hide API key" : "Show API key");
  elements.toggleApiKey.setAttribute("title", show ? "Hide API key" : "Show API key");
  elements.toggleApiKey.classList.toggle("is-active", show);
}

async function saveApiKey() {
  const openaiKey = elements.apiKeyInput.value.trim();

  try {
    await store.set({ openaiKey });
    showSettingsMessage(openaiKey ? "Saved locally." : "API key removed.", "success");
    flashButtonState(elements.saveKeyButton, "Saved!", "is-success");
  } catch (error) {
    showSettingsMessage("The API key could not be saved.", "error");
  }
}

function showLoading(message) {
  elements.loadingMessage.textContent = message;
  elements.loadingOverlay.hidden = false;
}

function hideLoading() {
  elements.loadingOverlay.hidden = true;
}

function showAiResult(summary, context = "") {
  window.clearTimeout(resultHideTimerId);
  elements.aiResultContext.textContent = context;
  elements.aiResultText.textContent = summary;
  elements.aiResult.hidden = false;

  requestAnimationFrame(() => {
    elements.aiResult.classList.add("is-visible");
  });
}

function hideAiResult() {
  elements.aiResult.classList.remove("is-visible");
  resultHideTimerId = window.setTimeout(() => {
    if (!elements.aiResult.classList.contains("is-visible")) {
      elements.aiResult.hidden = true;
      elements.aiResultContext.textContent = "";
      elements.aiResultText.textContent = "";
    }
  }, 180);
}

function showInlineFeedback(message, tone = "info", timeout = 2600) {
  window.clearTimeout(feedbackTimerId);
  elements.inlineFeedback.textContent = message;
  elements.inlineFeedback.className = `hl-inline-feedback is-${tone}`;
  elements.inlineFeedback.hidden = false;

  if (timeout > 0) {
    feedbackTimerId = window.setTimeout(() => {
      elements.inlineFeedback.hidden = true;
      elements.inlineFeedback.className = "hl-inline-feedback";
    }, timeout);
  }
}

function showSettingsMessage(message, tone = "info") {
  elements.settingsMessage.textContent = message;
  elements.settingsMessage.className = `hl-settings-message is-${tone}`;
  elements.settingsMessage.hidden = false;
}

function clearSettingsMessage() {
  elements.settingsMessage.hidden = true;
  elements.settingsMessage.textContent = "";
  elements.settingsMessage.className = "hl-settings-message";
}

function flashButtonState(button, text, stateClass, duration = 1500) {
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = button.innerHTML;
  }

  button.classList.add(stateClass);
  button.textContent = text;

  window.setTimeout(() => {
    button.classList.remove(stateClass);
    if (button.dataset.originalLabel) {
      button.innerHTML = button.dataset.originalLabel;
    }
  }, duration);
}

function updateBadge() {
  const count = highlights.length;

  try {
    chrome.action.setBadgeBackgroundColor({ color: "#6C63FF" });
    chrome.action.setBadgeText({ text: count ? (count > 99 ? "99+" : String(count)) : "" });
  } catch (error) {
    return;
  }
}

function createExcerpt(text, maxLength = 180) {
  const compactText = text.replace(/\s+/g, " ").trim();
  return compactText.length > maxLength
    ? `${compactText.slice(0, maxLength).trimEnd()}...`
    : compactText;
}

function truncateText(value, maxLength) {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function getHostname(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

function getPageKey(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch (error) {
    return url.split("#")[0] || "";
  }
}

function buildFaviconUrl(hostname) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
    hostname || "localhost"
  )}&sz=32`;
}

function buildFallbackFavicon(hostname) {
  const initial = encodeURIComponent((hostname || "S").slice(0, 1).toUpperCase());
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="%2322222f"/><text x="16" y="20" text-anchor="middle" font-family="Arial" font-size="14" fill="%23f0f0f5">${initial}</text></svg>`;
}

function timeAgo(timestamp) {
  const elapsed = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) {
    return "just now";
  }

  if (elapsed < hour) {
    return `${Math.max(1, Math.floor(elapsed / minute))}m ago`;
  }

  if (elapsed < day) {
    return `${Math.max(1, Math.floor(elapsed / hour))}h ago`;
  }

  if (elapsed < 2 * day) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(timestamp);
}

function formatExportDate(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(timestamp);
}

function formatLongDate(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp);
}
