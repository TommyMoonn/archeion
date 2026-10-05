// Search owns its dialog, presentation, and keyboard lifecycle.
(() => {
  const searchDialog = document.querySelector("[data-search-dialog]");
  const searchInput = document.querySelector("[data-search-input]");
  const searchResults = document.querySelector("[data-search-results]");
  const searchEmpty = document.querySelector("[data-search-empty]");
  const detailsToggle = document.querySelector("[data-search-details]");
  if (!searchDialog || !searchInput || !searchResults) return;
  const searchStatus = document.createElement("p");
  searchStatus.className = "sr-only";
  searchStatus.dataset.searchStatus = "";
  searchStatus.setAttribute("role", "status");
  searchResults.before(searchStatus);
  const searchEntries = window.ArcheionDocumentationIndex?.entries || [];
  const indexScript = document.querySelector("[data-doc-search-index]");
  const documentationRoot = indexScript ? new URL("../", indexScript.src) : null;
  const normalizeSearch = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
  let detailed = false;
  let opener = null;
  let resultLinks = [];
  let activeIndex = -1;
  let pointerStartedOutside = false;

  function searchRank(entry, query) {
    if (!query) return entry.sectionId ? -1 : 0;
    // A title match points to the page, not every section on that page.
    if (
      !entry.sectionId &&
      [entry.title, entry.pageHeading].some((text) => normalizeSearch(text).includes(query))
    )
      return 0;
    if (entry.sectionId && normalizeSearch(entry.sectionHeading).includes(query)) return 1;
    if (entry.aliases.some((alias) => alias.includes(query))) return 2;
    return entry.text.includes(query) ? 3 : -1;
  }

  function appendHighlighted(element, text, query) {
    if (!query) {
      element.textContent = text;
      return;
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    const pattern = new RegExp(escaped, "giu");
    let end = 0;
    for (const match of text.matchAll(pattern)) {
      element.append(document.createTextNode(text.slice(end, match.index)));
      const mark = document.createElement("mark");
      mark.textContent = match[0];
      element.append(mark);
      end = match.index + match[0].length;
    }
    element.append(document.createTextNode(text.slice(end)));
  }

  function setActive(index, focus = false) {
    activeIndex = index;
    resultLinks.forEach((link, i) => {
      link.dataset.active = String(i === index);
    });
    if (focus && resultLinks[index]) {
      resultLinks[index].focus({ preventScroll: true });
      resultLinks[index].scrollIntoView?.({ block: "nearest" });
    }
  }

  function updateDetails() {
    detailsToggle?.setAttribute("aria-pressed", String(detailed));
    for (const link of resultLinks) {
      const excerpt = link.querySelector("[data-search-excerpt]");
      if (!excerpt) continue;
      excerpt.hidden = !detailed;
      if (detailed) link.setAttribute("aria-describedby", excerpt.id);
      else link.removeAttribute("aria-describedby");
    }
  }

  function followResult(event, link) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const destination = new URL(link.href);
    // Cross-page navigation dismisses with the document; modified clicks stay native.
    if (
      destination.origin !== location.origin ||
      destination.pathname !== location.pathname ||
      destination.search !== location.search
    )
      return;
    const target = destination.hash
      ? document.getElementById(decodeURIComponent(destination.hash.slice(1)))
      : document.querySelector("[data-doc-article] h1");
    searchDialog.close("navigate");
    if (target instanceof HTMLElement) {
      if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }

  function renderSearchResults() {
    if (!documentationRoot) return;
    const query = normalizeSearch(searchInput.value);
    const matches = searchEntries
      .map((entry, order) => ({ entry, order, rank: searchRank(entry, query) }))
      .filter(({ rank }) => rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.order - b.order);
    const fragment = document.createDocumentFragment();
    resultLinks = matches.map(({ entry, order }, index) => {
      const link = document.createElement("a");
      link.className = "docs-search-result";
      link.href = new URL(
        `${entry.route.slice(1)}${entry.sectionId ? `#${entry.sectionId}` : ""}`,
        documentationRoot,
      ).href;
      if (!entry.sectionId && new URL(link.href).pathname === location.pathname)
        link.setAttribute("aria-current", "page");
      const title = document.createElement("strong");
      title.id = `docs-search-title-${order}`;
      appendHighlighted(title, entry.sectionHeading || entry.title, query);
      const context = document.createElement("span");
      context.className = "docs-search-context";
      context.id = `docs-search-context-${order}`;
      appendHighlighted(
        context,
        entry.sectionId ? `${entry.title} · ${entry.groupTitle}` : entry.groupTitle,
        query,
      );
      link.setAttribute("aria-labelledby", `${title.id} ${context.id}`);
      link.append(title, context);
      if (entry.excerpt) {
        const excerpt = document.createElement("span");
        excerpt.className = "docs-search-excerpt";
        excerpt.dataset.searchExcerpt = "";
        excerpt.id = `docs-search-excerpt-${order}`;
        appendHighlighted(excerpt, entry.excerpt, query);
        link.append(excerpt);
      }
      link.addEventListener("focus", () => setActive(index));
      link.addEventListener("click", (event) => followResult(event, link));
      fragment.append(link);
      return link;
    });
    searchResults.replaceChildren(fragment);
    searchResults.scrollTop = 0;
    setActive(resultLinks.length ? 0 : -1);
    updateDetails();
    if (searchEmpty) searchEmpty.hidden = matches.length !== 0;
    searchStatus.textContent = query
      ? matches.length === 0
        ? "No matching results."
        : `${matches.length} ${matches.length === 1 ? "result" : "results"} found.`
      : "";
  }

  function openSearch(origin = document.activeElement) {
    if (typeof searchDialog.showModal !== "function") return;
    if (!searchDialog.open) {
      opener = origin instanceof HTMLElement ? origin : null;
      pointerStartedOutside = false;
      searchDialog.returnValue = "";
      renderSearchResults();
      searchDialog.showModal();
    }
    searchInput.focus();
    searchInput.select();
  }

  document
    .querySelectorAll("[data-search-trigger]")
    .forEach((button) => button.addEventListener("click", () => openSearch(button)));
  searchInput.addEventListener("input", renderSearchResults);
  detailsToggle?.addEventListener("click", () => {
    detailed = !detailed;
    updateDetails();
  });
  function dismissSearch() {
    searchDialog.close();
    // Restore during the dismissal, before later user focus or a rapid reopen.
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  searchDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismissSearch();
  });
  const outsideDialog = (event) => {
    const bounds = searchDialog.getBoundingClientRect();
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
  };
  searchDialog.addEventListener("pointerdown", (event) => {
    pointerStartedOutside = event.target === searchDialog && outsideDialog(event);
  });
  searchDialog.addEventListener("pointercancel", () => {
    pointerStartedOutside = false;
  });
  searchDialog.addEventListener("click", (event) => {
    const dismiss = pointerStartedOutside && event.target === searchDialog && outsideDialog(event);
    pointerStartedOutside = false;
    if (dismiss) dismissSearch();
  });
  searchDialog.addEventListener("keydown", (event) => {
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    // Search inputs otherwise consume the first Escape to clear their value.
    if (event.key === "Escape") {
      event.preventDefault();
      dismissSearch();
      return;
    }
    const inInput = event.target === searchInput;
    const linkIndex = resultLinks.indexOf(event.target);
    if (!inInput && linkIndex < 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!resultLinks.length) return;
      event.preventDefault();
      if (!inInput && linkIndex === 0 && event.key === "ArrowUp") {
        searchInput.focus();
        return;
      }
      const next = inInput
        ? event.key === "ArrowDown"
          ? 0
          : resultLinks.length - 1
        : Math.min(resultLinks.length - 1, linkIndex + (event.key === "ArrowDown" ? 1 : -1));
      setActive(next, true);
    } else if (inInput && event.key === "Enter" && resultLinks[activeIndex]) {
      event.preventDefault();
      resultLinks[activeIndex].click();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (
      !event.defaultPrevented &&
      !event.isComposing &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "k" &&
      !document.body.classList.contains("nav-open")
    ) {
      event.preventDefault();
      openSearch();
    }
  });
})();
