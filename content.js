const HS_COLORS = [
  { name: "Yellow", hex: "#fde68a" },
  { name: "Blue", hex: "#93c5fd" },
  { name: "Green", hex: "#6ee7b7" },
  { name: "Pink", hex: "#f9a8d4" },
  { name: "Orange", hex: "#fdba74" }
];

const VALID_COLORS = new Set(HS_COLORS.map((color) => color.hex));
const MIN_SELECTION_LENGTH = 3;
const LOCAL_CACHE_PREFIX = "__highlight_saver_pro__";
const CURRENT_PAGE_KEY = getPageKey(location.href);

const store = {
  get(defaults) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(defaults, (result) => {
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

let tooltipElement = null;
let tooltipOutsideListener = null;
let editorElement = null;
let editorOutsideListener = null;
let pageHighlights = [];
let isSyncingPage = false;

init().catch(() => {
  // The content script should fail quietly on unsupported pages.
});

async function init() {
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("scroll", handleViewportChange, true);
  window.addEventListener("resize", handleViewportChange);

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(handleStorageChange);
  }

  await syncPageHighlights();
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local" || !changes.highlights) {
    return;
  }

  syncPageHighlights().catch(() => {
    // Ignore storage sync errors inside the page.
  });
}

function handleViewportChange() {
  removeTooltip();
  removeHighlightEditor();
}

function handleKeyDown(event) {
  if (event.key === "Escape") {
    removeTooltip();
    removeHighlightEditor();
    return;
  }

  const target = event.target;
  if (
    (event.key === "Enter" || event.key === " ") &&
    target instanceof Element &&
    target.classList.contains("hs-inline-highlight")
  ) {
    event.preventDefault();
    removeTooltip();
    showHighlightEditor(target.dataset.hsId, target);
  }
}

function handleDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const highlightNode = target.closest(".hs-inline-highlight");
  if (!highlightNode) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  removeTooltip();
  showHighlightEditor(highlightNode.dataset.hsId, highlightNode);
}

function handleMouseUp(event) {
  if (
    event.button !== 0 ||
    isOwnedElement(event.target) ||
    isEditableTarget(event.target)
  ) {
    return;
  }

  let selection;
  let range;

  try {
    selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      removeTooltip();
      return;
    }

    range = selection.getRangeAt(0).cloneRange();
    if (isRangeInsideHighlight(range)) {
      removeTooltip();
      return;
    }

    const selectedText = selection.toString().trim();
    if (selectedText.length < MIN_SELECTION_LENGTH) {
      removeTooltip();
      return;
    }

    const selectionRect = getSelectionRect(range);
    if (!selectionRect) {
      removeTooltip();
      return;
    }

    removeHighlightEditor();
    removeTooltip();
    createTooltip(selectedText, range, selectionRect);
  } catch (error) {
    removeTooltip();
  }
}

async function syncPageHighlights() {
  if (isSyncingPage) {
    return;
  }

  isSyncingPage = true;

  try {
    const mergedHighlights = await loadMergedHighlights();
    pageHighlights = mergedHighlights.filter(matchesCurrentPage);
    syncPageLocalCache(pageHighlights);
    renderPageHighlights(pageHighlights);
  } finally {
    isSyncingPage = false;
  }
}

async function loadMergedHighlights() {
  const { highlights = [] } = await store.get({ highlights: [] });
  const normalizedStored = normalizeHighlights(highlights);
  const mergedHighlights = normalizedStored.items;
  const shouldWriteBack = normalizedStored.migrated;

  if (shouldWriteBack) {
    await store.set({ highlights: mergedHighlights });
  }

  return mergedHighlights;
}

function normalizeHighlights(items) {
  let migrated = false;
  const normalizedItems = [];

  if (!Array.isArray(items)) {
    return { items: [], migrated: true };
  }

  items.forEach((item) => {
    const normalized = normalizeHighlight(item);
    if (!normalized) {
      migrated = true;
      return;
    }

    if (
      normalized.id !== item.id ||
      normalized.color !== item.color ||
      normalized.note !== item.note ||
      normalized.pageKey !== item.pageKey ||
      normalized.favicon !== item.favicon ||
      !anchorsMatch(normalized.anchor, item.anchor)
    ) {
      migrated = true;
    }

    normalizedItems.push(normalized);
  });

  return { items: normalizedItems, migrated };
}

function normalizeHighlight(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const text = typeof item.text === "string" ? item.text.trim() : "";
  if (!text) {
    return null;
  }

  const url = typeof item.url === "string" ? item.url : "";
  const pageKey = item.pageKey || getPageKey(url);
  const hostname = getHostname(url) || location.hostname || "page";
  const title =
    typeof item.title === "string" && item.title.trim()
      ? item.title.trim()
      : document.title || hostname;
  const color = VALID_COLORS.has(item.color) ? item.color : HS_COLORS[0].hex;
  const time = Number.isFinite(item.time) ? item.time : Date.now();
  const note = typeof item.note === "string" ? item.note : "";
  const id =
    typeof item.id === "string" && item.id.trim() ? item.id : crypto.randomUUID();
  const favicon =
    typeof item.favicon === "string" && item.favicon.trim()
      ? item.favicon
      : buildFaviconUrl(hostname);
  const anchor = normalizeAnchor(item.anchor, text);

  return {
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

function matchesCurrentPage(highlight) {
  return (highlight.pageKey || getPageKey(highlight.url)) === CURRENT_PAGE_KEY;
}

function getPageKey(url) {
  try {
    const parsed = new URL(url, location.href);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch (error) {
    return url.split("#")[0] || location.href.split("#")[0];
  }
}

function getHostname(url) {
  try {
    const parsed = new URL(url, location.href);
    return parsed.hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

function getRootNode() {
  return document.body || document.documentElement;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isEditableTarget(target) {
  return Boolean(
    target instanceof Element &&
      target.closest(
        "input, textarea, select, option, [contenteditable=''], [contenteditable='true']"
      )
  );
}

function isOwnedElement(target) {
  return Boolean(
    target instanceof Element &&
      target.closest("#hs-tooltip, #hs-highlight-editor, .hs-inline-highlight")
  );
}

function isRangeInsideHighlight(range) {
  const startElement =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const endElement =
    range.endContainer instanceof Element
      ? range.endContainer
      : range.endContainer.parentElement;

  return Boolean(
    startElement?.closest(".hs-inline-highlight") ||
      endElement?.closest(".hs-inline-highlight")
  );
}

function getSelectionRect(range) {
  try {
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) {
      return rect;
    }

    const rects = range.getClientRects();
    if (rects.length > 0) {
      return rects[0];
    }
  } catch (error) {
    return null;
  }

  return null;
}

function positionFloatingElement(element, anchorRect, options = {}) {
  const { mode = "absolute", gap = 12 } = options;
  const padding = 8;
  const rect = element.getBoundingClientRect();
  const viewportTop = mode === "fixed" ? 0 : window.scrollY;
  const viewportLeft = mode === "fixed" ? 0 : window.scrollX;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const anchorTop = mode === "fixed" ? anchorRect.top : anchorRect.top + window.scrollY;
  const anchorBottom =
    mode === "fixed" ? anchorRect.bottom : anchorRect.bottom + window.scrollY;
  const anchorLeft =
    mode === "fixed" ? anchorRect.left : anchorRect.left + window.scrollX;
  const centeredLeft = anchorLeft + anchorRect.width / 2 - rect.width / 2;

  const minLeft = viewportLeft + padding;
  const maxLeft = viewportLeft + viewportWidth - rect.width - padding;
  const minTop = viewportTop + padding;
  const maxTop = viewportTop + viewportHeight - rect.height - padding;

  let top = anchorTop - rect.height - gap;
  if (top < minTop) {
    top = anchorBottom + gap;
  }

  element.style.left = `${clamp(centeredLeft, minLeft, Math.max(minLeft, maxLeft))}px`;
  element.style.top = `${clamp(top, minTop, Math.max(minTop, maxTop))}px`;
}

function removeTooltip() {
  if (tooltipOutsideListener) {
    document.removeEventListener("mousedown", tooltipOutsideListener, true);
    tooltipOutsideListener = null;
  }

  if (tooltipElement) {
    tooltipElement.remove();
    tooltipElement = null;
  }
}

function removeHighlightEditor() {
  if (editorOutsideListener) {
    document.removeEventListener("mousedown", editorOutsideListener, true);
    editorOutsideListener = null;
  }

  document
    .querySelectorAll(".hs-inline-highlight.is-active")
    .forEach((node) => node.classList.remove("is-active"));

  if (editorElement) {
    editorElement.remove();
    editorElement = null;
  }
}

function showFlash(message, anchorRect, background) {
  const host = getRootNode();
  if (!host) {
    return;
  }

  const flash = document.createElement("div");
  flash.className = "hs-saved-flash";
  flash.textContent = message;

  if (background) {
    flash.style.background = background;
  }

  host.appendChild(flash);
  positionFloatingElement(flash, anchorRect, { mode: "absolute", gap: 4 });

  window.setTimeout(() => {
    flash.remove();
  }, 1200);
}

function createTooltip(selectedText, range, selectionRect) {
  let selectedColor = HS_COLORS[0].hex;

  const tooltip = document.createElement("div");
  tooltip.id = "hs-tooltip";
  tooltip.setAttribute("role", "dialog");
  tooltip.setAttribute("aria-label", "Save selected highlight");

  const label = document.createElement("span");
  label.className = "hs-label";

  const labelIcon = document.createElement("span");
  labelIcon.className = "hs-label-icon";
  labelIcon.textContent = "✦";

  const labelText = document.createElement("span");
  labelText.textContent = "Save highlight";

  label.append(labelIcon, labelText);

  const divider = document.createElement("span");
  divider.className = "hs-divider";
  divider.setAttribute("aria-hidden", "true");

  const colors = document.createElement("div");
  colors.className = "hs-colors";
  colors.setAttribute("role", "radiogroup");
  colors.setAttribute("aria-label", "Highlight color");

  HS_COLORS.forEach((color, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "hs-dot";
    dot.dataset.color = color.hex;
    dot.title = color.name;
    dot.setAttribute("aria-label", `${color.name} highlight`);
    dot.style.background = color.hex;
    dot.setAttribute("aria-pressed", String(index === 0));

    if (index === 0) {
      dot.classList.add("active");
    }

    dot.addEventListener("click", () => {
      selectedColor = color.hex;
      colors.querySelectorAll(".hs-dot").forEach((item) => {
        item.classList.toggle("active", item === dot);
        item.setAttribute("aria-pressed", String(item === dot));
      });
    });

    colors.appendChild(dot);
  });

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "hs-btn hs-btn-save";
  saveButton.textContent = "Save";

  saveButton.addEventListener("click", async () => {
    const tooltipRect = tooltip.getBoundingClientRect();

    try {
      await saveHighlight(selectedText, selectedColor, range.cloneRange(), tooltipRect);
    } catch (error) {
      removeTooltip();
      showFlash("Could not save", tooltipRect, "#ef4444");
    }
  });

  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "hs-btn hs-btn-dismiss";
  dismissButton.textContent = "✕";
  dismissButton.setAttribute("aria-label", "Dismiss highlight saver");
  dismissButton.addEventListener("click", removeTooltip);

  tooltip.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  tooltip.append(label, divider, colors, saveButton, dismissButton);

  getRootNode()?.appendChild(tooltip);
  positionFloatingElement(tooltip, selectionRect, { mode: "absolute" });

  tooltipOutsideListener = (event) => {
    if (tooltip.contains(event.target)) {
      return;
    }

    removeTooltip();
  };

  document.addEventListener("mousedown", tooltipOutsideListener, true);
  tooltipElement = tooltip;
}

async function saveHighlight(selectedText, selectedColor, range, anchorRect) {
  const hostname = location.hostname || "page";
  const highlight = {
    id: crypto.randomUUID(),
    text: selectedText,
    url: location.href,
    pageKey: CURRENT_PAGE_KEY,
    title: document.title,
    favicon: buildFaviconUrl(hostname),
    color: selectedColor,
    time: Date.now(),
    note: "",
    anchor: captureAnchor(range, selectedText)
  };

  const mergedHighlights = await loadMergedHighlights();
  mergedHighlights.push(highlight);
  await store.set({ highlights: mergedHighlights });
  syncPageLocalCache(mergedHighlights.filter(matchesCurrentPage));
  removeTooltip();
  await syncPageHighlights();
  showFlash("Saved! ✓", anchorRect, "#22c55e");
}

function captureAnchor(range, selectedText) {
  const startNode = range.startContainer;
  const endNode = range.endContainer;

  return {
    exact: selectedText,
    prefix: getRangeContext(range, "before", 40),
    suffix: getRangeContext(range, "after", 40),
    startXPath:
      startNode?.nodeType === Node.TEXT_NODE ? serializeNodePath(startNode) : "",
    startOffset:
      startNode?.nodeType === Node.TEXT_NODE ? range.startOffset : 0,
    endXPath:
      endNode?.nodeType === Node.TEXT_NODE ? serializeNodePath(endNode) : "",
    endOffset: endNode?.nodeType === Node.TEXT_NODE ? range.endOffset : 0
  };
}

function getRangeContext(range, direction, maxLength) {
  try {
    const clone = document.createRange();

    if (!document.body) {
      return "";
    }

    if (direction === "before") {
      clone.selectNodeContents(document.body);
      clone.setEnd(range.startContainer, range.startOffset);
      return clone.toString().slice(-maxLength);
    }

    clone.selectNodeContents(document.body);
    clone.setStart(range.endContainer, range.endOffset);
    return clone.toString().slice(0, maxLength);
  } catch (error) {
    return "";
  }
}

function serializeNodePath(node) {
  const segments = [];
  let current = node;

  while (current && current !== document) {
    if (current.nodeType === Node.TEXT_NODE) {
      const parent = current.parentNode;
      if (!parent) {
        break;
      }

      const textSiblings = Array.from(parent.childNodes).filter(
        (child) => child.nodeType === Node.TEXT_NODE
      );
      const index = textSiblings.indexOf(current) + 1;
      segments.unshift(`text()[${index}]`);
      current = parent;
      continue;
    }

    if (current.nodeType === Node.ELEMENT_NODE) {
      const parent = current.parentNode;
      const tagName = current.nodeName.toLowerCase();

      if (!parent) {
        segments.unshift(tagName);
        break;
      }

      const sameTagSiblings = Array.from(parent.children).filter(
        (child) => child.nodeName === current.nodeName
      );
      const index = sameTagSiblings.indexOf(current) + 1;
      segments.unshift(`${tagName}[${index}]`);
    }

    current = current.parentNode;
  }

  return `/${segments.join("/")}`;
}

function resolveNodePath(path) {
  if (!path) {
    return null;
  }

  try {
    return document.evaluate(
      path,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
  } catch (error) {
    return null;
  }
}

function renderPageHighlights(highlights) {
  removeHighlightEditor();
  clearRenderedHighlights();

  if (!highlights.length) {
    return;
  }

  const resolvedHighlights = [];

  highlights.forEach((highlight) => {
    const range = resolveHighlightRange(highlight);
    if (range) {
      resolvedHighlights.push({ highlight, range });
    }
  });

  resolvedHighlights.sort((left, right) => {
    const startCompare = left.range.compareBoundaryPoints(
      Range.START_TO_START,
      right.range
    );

    if (startCompare !== 0) {
      return -startCompare;
    }

    return -left.range.compareBoundaryPoints(Range.END_TO_END, right.range);
  });

  resolvedHighlights.forEach(({ highlight, range }) => {
    applyHighlightRange(range, highlight);
  });
}

function clearRenderedHighlights() {
  document.querySelectorAll(".hs-inline-highlight").forEach((node) => {
    unwrapHighlightNode(node);
  });
}

function unwrapHighlightNode(node) {
  const parent = node.parentNode;
  if (!parent) {
    return;
  }

  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }

  parent.removeChild(node);
  parent.normalize();
}

function resolveHighlightRange(highlight) {
  return (
    resolveRangeFromAnchor(highlight.anchor) ||
    resolveRangeFromQuote(highlight.anchor?.exact || highlight.text, highlight.anchor)
  );
}

function resolveRangeFromAnchor(anchor) {
  if (!anchor?.startXPath || !anchor?.endXPath) {
    return null;
  }

  const startNode = resolveNodePath(anchor.startXPath);
  const endNode = resolveNodePath(anchor.endXPath);

  if (
    !startNode ||
    !endNode ||
    startNode.nodeType !== Node.TEXT_NODE ||
    endNode.nodeType !== Node.TEXT_NODE
  ) {
    return null;
  }

  try {
    const range = document.createRange();
    const startOffset = clamp(anchor.startOffset || 0, 0, startNode.nodeValue.length);
    const endOffset = clamp(anchor.endOffset || 0, 0, endNode.nodeValue.length);

    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    if (range.collapsed || !rangeMatchesText(range, anchor.exact)) {
      return null;
    }

    return range;
  } catch (error) {
    return null;
  }
}

function resolveRangeFromQuote(exactText, anchor = {}) {
  const quote = typeof exactText === "string" ? exactText.trim() : "";
  if (!quote) {
    return null;
  }

  const snapshot = createTextSnapshot();
  if (!snapshot.text) {
    return null;
  }

  const candidates = [];
  let searchIndex = snapshot.text.indexOf(quote);

  while (searchIndex !== -1) {
    const endIndex = searchIndex + quote.length;
    let score = 0;

    if (anchor.prefix) {
      const prefix = snapshot.text.slice(
        Math.max(0, searchIndex - anchor.prefix.length),
        searchIndex
      );

      if (prefix.endsWith(anchor.prefix)) {
        score += 2;
      }
    }

    if (anchor.suffix) {
      const suffix = snapshot.text.slice(endIndex, endIndex + anchor.suffix.length);
      if (suffix.startsWith(anchor.suffix)) {
        score += 2;
      }
    }

    candidates.push({ start: searchIndex, end: endIndex, score });
    searchIndex = snapshot.text.indexOf(quote, searchIndex + 1);
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score || left.start - right.start);
  return createRangeFromSnapshot(snapshot, candidates[0].start, candidates[0].end);
}

function createTextSnapshot() {
  const segments = [];
  let text = "";

  if (!document.body) {
    return { text, segments };
  }

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return shouldIndexTextNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const value = node.nodeValue;
    const start = text.length;
    text += value;
    segments.push({ node, start, end: text.length });
  }

  return { text, segments };
}

function shouldIndexTextNode(node) {
  if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue || !node.nodeValue.trim()) {
    return false;
  }

  const parent = node.parentElement;
  if (!parent) {
    return false;
  }

  if (parent.closest("#hs-tooltip, #hs-highlight-editor, .hs-inline-highlight")) {
    return false;
  }

  return !parent.closest("script, style, noscript, textarea, input, select, option");
}

function createRangeFromSnapshot(snapshot, start, end) {
  const startSegment = snapshot.segments.find(
    (segment) => start >= segment.start && start < segment.end
  );
  const endSegment = snapshot.segments.find(
    (segment) => end > segment.start && end <= segment.end
  );

  if (!startSegment || !endSegment) {
    return null;
  }

  try {
    const range = document.createRange();
    range.setStart(startSegment.node, start - startSegment.start);
    range.setEnd(endSegment.node, end - endSegment.start);

    return range.collapsed ? null : range;
  } catch (error) {
    return null;
  }
}

function rangeMatchesText(range, expectedText) {
  return normalizeText(range.toString()) === normalizeText(expectedText);
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function applyHighlightRange(range, highlight) {
  const segments = getRangeSegments(range);
  if (!segments.length) {
    return;
  }

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    wrapTextSegment(segments[index], highlight);
  }
}

function getRangeSegments(range) {
  const segments = [];
  const root =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentNode;

  if (!root) {
    return segments;
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!shouldIndexTextNode(node)) {
          return NodeFilter.FILTER_REJECT;
        }

        try {
          return range.intersectsNode(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        } catch (error) {
          return NodeFilter.FILTER_REJECT;
        }
      }
    }
  );

  if (
    range.startContainer.nodeType === Node.TEXT_NODE &&
    shouldIndexTextNode(range.startContainer) &&
    range.intersectsNode(range.startContainer)
  ) {
    segments.push(buildRangeSegment(range, range.startContainer));
  }

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node === range.startContainer) {
      continue;
    }

    segments.push(buildRangeSegment(range, node));
  }

  return segments.filter(Boolean);
}

function buildRangeSegment(range, node) {
  let start = 0;
  let end = node.nodeValue.length;

  if (node === range.startContainer) {
    start = range.startOffset;
  }

  if (node === range.endContainer) {
    end = range.endOffset;
  }

  if (end <= start) {
    return null;
  }

  return { node, start, end };
}

function wrapTextSegment(segment, highlight) {
  const node = segment.node;
  if (!node.parentNode) {
    return;
  }

  let targetNode = node;
  const selectedLength = segment.end - segment.start;

  if (segment.start > 0) {
    targetNode = targetNode.splitText(segment.start);
  }

  if (selectedLength < targetNode.nodeValue.length) {
    targetNode.splitText(selectedLength);
  }

  const wrapper = document.createElement("mark");
  wrapper.className = "hs-inline-highlight";
  wrapper.dataset.hsId = highlight.id;
  wrapper.dataset.hsColor = highlight.color;
  wrapper.setAttribute("tabindex", "0");
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute("aria-label", "Edit saved highlight");
  applyHighlightColor(wrapper, highlight.color);

  targetNode.parentNode.insertBefore(wrapper, targetNode);
  wrapper.appendChild(targetNode);
}

function applyHighlightColor(node, color) {
  node.style.setProperty("--hs-highlight-color", color);
  node.style.setProperty("--hs-highlight-fill", hexToRgba(color, 0.34));
  node.style.setProperty("--hs-highlight-fill-hover", hexToRgba(color, 0.5));
}

function hexToRgba(hex, alpha) {
  const cleanHex = hex.replace("#", "");
  const normalizedHex =
    cleanHex.length === 3
      ? cleanHex
          .split("")
          .map((char) => char + char)
          .join("")
      : cleanHex;

  const red = Number.parseInt(normalizedHex.slice(0, 2), 16);
  const green = Number.parseInt(normalizedHex.slice(2, 4), 16);
  const blue = Number.parseInt(normalizedHex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function showHighlightEditor(highlightId, anchorNode) {
  const highlight = pageHighlights.find((item) => item.id === highlightId);
  if (!highlight || !(anchorNode instanceof HTMLElement)) {
    return;
  }

  removeHighlightEditor();

  document
    .querySelectorAll(`.hs-inline-highlight[data-hs-id="${highlightId}"]`)
    .forEach((node) => node.classList.add("is-active"));

  const editor = document.createElement("div");
  editor.id = "hs-highlight-editor";
  editor.setAttribute("role", "dialog");
  editor.setAttribute("aria-label", "Edit saved highlight");

  const title = document.createElement("span");
  title.className = "hs-editor-title";
  title.textContent = "Edit highlight";

  const actions = document.createElement("div");
  actions.className = "hs-editor-actions";

  const colors = document.createElement("div");
  colors.className = "hs-colors";

  HS_COLORS.forEach((color) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "hs-dot";
    dot.title = color.name;
    dot.setAttribute("aria-label", `Switch to ${color.name.toLowerCase()}`);
    dot.style.background = color.hex;
    dot.classList.toggle("active", highlight.color === color.hex);

    dot.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await updateHighlightColor(highlight.id, color.hex, anchorNode.getBoundingClientRect());
    });

    colors.appendChild(dot);
  });

  const summarizeButton = document.createElement("button");
  summarizeButton.type = "button";
  summarizeButton.className = "hs-btn hs-btn-secondary";
  summarizeButton.textContent = "Summarize";
  summarizeButton.setAttribute("aria-label", "Summarize highlight");

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "hs-btn hs-btn-danger";
  removeButton.textContent = "Remove";
  removeButton.setAttribute("aria-label", "Remove highlight");
  removeButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await removeHighlightById(highlight.id, anchorNode.getBoundingClientRect());
  });

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "hs-btn hs-btn-dismiss";
  closeButton.textContent = "✕";
  closeButton.setAttribute("aria-label", "Close highlight editor");
  closeButton.addEventListener("click", removeHighlightEditor);

  const status = document.createElement("div");
  status.className = "hs-editor-status";
  status.hidden = true;

  const summary = document.createElement("div");
  summary.className = "hs-editor-summary";
  summary.hidden = true;

  summarizeButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await summarizeHighlightInEditor(highlight, summarizeButton, status, summary);
  });

  actions.append(colors, summarizeButton, removeButton, closeButton);
  editor.append(title, actions, status, summary);
  editor.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  getRootNode()?.appendChild(editor);
  positionFloatingElement(editor, anchorNode.getBoundingClientRect(), { mode: "fixed" });

  editorOutsideListener = (event) => {
    if (editor.contains(event.target)) {
      return;
    }

    removeHighlightEditor();
  };

  document.addEventListener("mousedown", editorOutsideListener, true);
  editorElement = editor;
}

async function summarizeHighlightInEditor(highlight, button, statusNode, summaryNode) {
  setEditorStatus(statusNode, "Preparing summary...", "info");
  summaryNode.hidden = true;
  summaryNode.textContent = "";
  button.disabled = true;

  try {
    const result = await summarizeText({
      builtInText: highlight.text,
      builtInContext: "Summarize this saved highlight in 1-2 clear sentences.",
      builtInLength: "short",
      openAiPrompt: `Summarize this in 1-2 sentences: ${highlight.text}`,
      onStatus: (message) => setEditorStatus(statusNode, message, "info")
    });

    summaryNode.hidden = false;
    summaryNode.textContent = result.summary;
    setEditorStatus(statusNode, `${result.provider} summary ready.`, "success");
  } catch (error) {
    setEditorStatus(statusNode, error.message || "Summary failed.", "error");
  } finally {
    button.disabled = false;
  }
}

function setEditorStatus(node, message, tone) {
  if (!message) {
    node.hidden = true;
    node.textContent = "";
    node.className = "hs-editor-status";
    return;
  }

  node.hidden = false;
  node.textContent = message;
  node.className = `hs-editor-status is-${tone}`;
}

async function summarizeText({
  builtInText,
  builtInContext,
  builtInLength,
  openAiPrompt,
  onStatus
}) {
  let builtInError = null;
  const availability = await getBuiltInSummaryAvailability();

  if (availability !== "unsupported" && availability !== "unavailable") {
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

  if (availability === "unavailable") {
    throw new Error(
      "Chrome built-in AI isn't available on this device, and no OpenAI API key is saved."
    );
  }

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

async function getStoredApiKey() {
  try {
    const { openaiKey = "" } = await store.get({ openaiKey: "" });
    return openaiKey.trim();
  } catch (error) {
    return "";
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
        "Your OpenAI account has no remaining API quota right now. Add billing or use another key."
      );
    }

    if (response.status === 401) {
      throw new Error("The saved OpenAI API key looks invalid.");
    }

    if (response.status === 429) {
      throw new Error("OpenAI rate limited that request. Wait a moment and try again.");
    }

    throw new Error(data?.error?.message || "We couldn't generate a summary right now.");
  }

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty response. Please try again.");
  }

  return content;
}

async function updateHighlightColor(highlightId, nextColor, anchorRect) {
  if (!VALID_COLORS.has(nextColor)) {
    return;
  }

  const mergedHighlights = await loadMergedHighlights();
  const updatedHighlights = mergedHighlights.map((highlight) =>
    highlight.id === highlightId ? { ...highlight, color: nextColor } : highlight
  );

  await store.set({ highlights: updatedHighlights });
  syncPageLocalCache(updatedHighlights.filter(matchesCurrentPage));
  await syncPageHighlights();
  showFlash("Color updated", anchorRect, "#6C63FF");
}

async function removeHighlightById(highlightId, anchorRect) {
  const mergedHighlights = await loadMergedHighlights();
  const updatedHighlights = mergedHighlights.filter(
    (highlight) => highlight.id !== highlightId
  );

  await store.set({ highlights: updatedHighlights });
  syncPageLocalCache(updatedHighlights.filter(matchesCurrentPage));
  removeHighlightEditor();
  await syncPageHighlights();
  showFlash("Removed", anchorRect, "#ef4444");
}

function buildFaviconUrl(hostname) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
    hostname
  )}&sz=32`;
}

function syncPageLocalCache(items) {
  try {
    const key = `${LOCAL_CACHE_PREFIX}${CURRENT_PAGE_KEY}`;

    if (!items.length) {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, JSON.stringify(items));
  } catch (error) {
    // Local cache is a best-effort mirror only.
  }
}
