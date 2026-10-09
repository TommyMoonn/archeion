(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const header = document.querySelector("[data-header]");
  const navToggle = document.querySelector(".nav-toggle");
  const siteNav = document.querySelector(".site-nav");
  const navLinks = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
  const mobileNavigation = window.matchMedia("(max-width: 900px)");

  const setNavigationOpen = (isOpen, restoreFocus = false) => {
    if (!navToggle || !siteNav) return;
    navToggle.setAttribute("aria-expanded", String(isOpen));
    navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
    siteNav.classList.toggle("is-open", isOpen);
    siteNav.inert = mobileNavigation.matches && !isOpen;
    const use = navToggle.querySelector("use");
    use?.setAttribute("href", isOpen ? "#icon-close" : "#icon-menu");

    if (isOpen) navLinks[0]?.focus();
    else if (restoreFocus && navToggle.isConnected) navToggle.focus();
  };

  const closeNavigation = (restoreFocus = false) => {
    if (!siteNav?.classList.contains("is-open")) return;
    setNavigationOpen(false, restoreFocus);
  };

  const syncNavigationMode = () => {
    if (!siteNav) return;
    const restoreFocus = mobileNavigation.matches && siteNav.contains(document.activeElement);
    setNavigationOpen(false, restoreFocus);
  };

  syncNavigationMode();
  mobileNavigation.addEventListener("change", syncNavigationMode);

  navToggle?.addEventListener("click", () => {
    if (!siteNav || !mobileNavigation.matches) return;
    const willOpen = navToggle.getAttribute("aria-expanded") !== "true";
    setNavigationOpen(willOpen, !willOpen && siteNav.contains(document.activeElement));
  });

  siteNav?.querySelectorAll("a[href]").forEach((link) =>
    link.addEventListener("click", (event) => {
      if (
        !mobileNavigation.matches ||
        !siteNav.classList.contains("is-open") ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self")
      )
        return;

      closeNavigation(false);
      const destination = new URL(link.href);
      if (
        destination.origin !== location.origin ||
        destination.pathname !== location.pathname ||
        destination.search !== location.search ||
        !destination.hash
      )
        return;

      let target;
      try {
        target = document.getElementById(decodeURIComponent(destination.hash.slice(1)));
      } catch {
        return;
      }
      if (!(target instanceof HTMLElement)) return;
      if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }),
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !siteNav?.classList.contains("is-open")) return;
    event.preventDefault();
    closeNavigation(true);
  });

  document.addEventListener("click", (event) => {
    if (!siteNav?.classList.contains("is-open") || !navToggle) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!siteNav.contains(target) && !navToggle.contains(target)) {
      closeNavigation(true);
    }
  });

  const revealElements = document.querySelectorAll("[data-reveal]");
  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("is-visible"));
  } else {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -7%" },
    );
    revealElements.forEach((element) => revealObserver.observe(element));
  }

  const sections = Array.from(document.querySelectorAll("main section[id]"));
  const linkedSectionIds = new Set(
    navLinks.map((link) => link.getAttribute("href")?.slice(1)).filter(Boolean),
  );
  let navigationFrame = 0;
  let metricsFrame = 0;
  let headerHeight = 0;
  let sectionBounds = [];

  const refreshNavigationMetrics = () => {
    headerHeight = header?.offsetHeight ?? 0;
    sectionBounds = sections.map((section) => {
      const rect = section.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      return { id: section.id, top, bottom: top + rect.height };
    });
  };

  const updatePageOnScroll = () => {
    navigationFrame = 0;
    header?.classList.toggle("is-scrolled", window.scrollY > 12);

    const activationPosition = window.scrollY + headerHeight + 16;
    const activeSection = sectionBounds.find(
      ({ top, bottom }) => top <= activationPosition && bottom > activationPosition,
    );
    const activeId =
      activeSection && linkedSectionIds.has(activeSection.id) ? activeSection.id : null;

    navLinks.forEach((link) => {
      const isCurrent = activeId !== null && link.getAttribute("href") === `#${activeId}`;
      if (isCurrent) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  };

  const requestPageScrollUpdate = () => {
    if (navigationFrame) return;
    navigationFrame = window.requestAnimationFrame(updatePageOnScroll);
  };

  const refreshPageMetrics = () => {
    refreshNavigationMetrics();
    requestPageScrollUpdate();
  };

  const requestPageMetricsRefresh = () => {
    if (metricsFrame) return;
    metricsFrame = window.requestAnimationFrame(() => {
      metricsFrame = 0;
      refreshPageMetrics();
    });
  };

  if ("ResizeObserver" in window) {
    const sectionResizeObserver = new ResizeObserver(requestPageMetricsRefresh);
    sections.forEach((section) => sectionResizeObserver.observe(section));
  }

  window.addEventListener("scroll", requestPageScrollUpdate, { passive: true });
  window.addEventListener("resize", requestPageMetricsRefresh);
  window.addEventListener("load", refreshPageMetrics, { once: true });
  document
    .querySelectorAll("main details")
    .forEach((details) => details.addEventListener("toggle", requestPageMetricsRefresh));
  document.fonts?.ready.then(refreshPageMetrics).catch(() => undefined);
  refreshPageMetrics();

  const libraryViewButtons = Array.from(document.querySelectorAll("[data-library-view]"));
  const folderButtons = Array.from(document.querySelectorAll("[data-library-folder]"));
  const folderOverviewButtons = Array.from(document.querySelectorAll("[data-library-folder-card]"));
  const bookGrid = document.querySelector("[data-book-grid]");
  const seriesGrid = document.querySelector("[data-series-grid]");
  const folderOverview = document.querySelector("[data-folder-overview]");
  const previewTitle = document.querySelector("[data-preview-title]");
  const previewKicker = document.querySelector("[data-preview-kicker]");
  const previewResults = document.querySelector("[data-preview-results]");
  const librarySearch = document.querySelector("[data-library-search]");
  const librarySort = document.querySelector("[data-library-sort]");
  const libraryFilter = document.querySelector('[data-library-filter="in-progress"]');
  const bookCards = Array.from(document.querySelectorAll(".book-card"));
  const seriesCards = Array.from(document.querySelectorAll(".series-card"));
  const reduceLibraryMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const libraryState = {
    destination: "library",
    folder: null,
    query: "",
    inProgressOnly: false,
    sort: "title",
  };

  const libraryDestinations = {
    library: { title: "Library", kicker: "Your collection", noun: "books" },
    series: { title: "Series", kicker: "Books in reading order", noun: "series" },
    favorites: { title: "Favorites", kicker: "Saved views", noun: "books" },
    folders: { title: "Folders", kicker: "Archive folders", noun: "folders" },
  };

  const normalized = (value) => (value || "").trim().toLocaleLowerCase();

  const animateLibrarySurface = (surface) => {
    if (
      reduceLibraryMotion.matches ||
      !(surface instanceof HTMLElement) ||
      typeof surface.animate !== "function"
    ) {
      return;
    }

    surface.getAnimations().forEach((animation) => animation.cancel());
    surface.animate(
      [
        { opacity: 0.72, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 160, easing: "cubic-bezier(.22,.61,.36,1)" },
    );
  };

  const clearLibrarySelection = () => {
    [...libraryViewButtons, ...folderButtons].forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-pressed", "false");
    });
  };

  const sortedByPreviewPreference = (left, right) => {
    if (libraryState.sort === "recent") {
      return Number(right.dataset.recent || 0) - Number(left.dataset.recent || 0);
    }
    return (left.dataset.title || "").localeCompare(right.dataset.title || "");
  };

  const renderBookCollection = () => {
    if (!(bookGrid instanceof HTMLElement)) return 0;
    const query = normalized(libraryState.query);
    const cards = [...bookCards].sort(sortedByPreviewPreference);
    let visibleCount = 0;

    cards.forEach((card) => {
      const matchesDestination =
        libraryState.destination === "favorites"
          ? card.dataset.favorite === "true"
          : libraryState.destination === "folder"
            ? card.dataset.folder === libraryState.folder
            : true;
      const searchable = normalized(`${card.dataset.title} ${card.dataset.author}`);
      const progress = Number(card.dataset.progress || 0);
      const matchesProgress = !libraryState.inProgressOnly || (progress > 0 && progress < 100);
      const visible =
        matchesDestination && matchesProgress && (!query || searchable.includes(query));
      card.classList.toggle("is-hidden", !visible);
      bookGrid.append(card);
      if (visible) visibleCount += 1;
    });

    animateLibrarySurface(bookGrid);
    return visibleCount;
  };

  const renderSeriesCollection = () => {
    if (!(seriesGrid instanceof HTMLElement)) return 0;
    const query = normalized(libraryState.query);
    const cards = [...seriesCards].sort(sortedByPreviewPreference);
    let visibleCount = 0;
    cards.forEach((card) => {
      const visible = !query || normalized(card.dataset.title).includes(query);
      card.hidden = !visible;
      seriesGrid.append(card);
      if (visible) visibleCount += 1;
    });
    animateLibrarySurface(seriesGrid);
    return visibleCount;
  };

  const renderFolderCollection = () => {
    if (!(folderOverview instanceof HTMLElement)) return 0;
    const query = normalized(libraryState.query);
    let visibleCount = 0;
    folderOverviewButtons.forEach((button) => {
      const visible = !query || normalized(button.dataset.libraryFolderCard).includes(query);
      button.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    animateLibrarySurface(folderOverview);
    return visibleCount;
  };

  const renderLibraryPreview = () => {
    const destination = libraryState.destination;
    const content =
      destination === "folder"
        ? { title: libraryState.folder || "Folder", kicker: "Archive folder", noun: "books" }
        : libraryDestinations[destination] || libraryDestinations.library;
    const showsBooks = ["library", "favorites", "folder"].includes(destination);
    const showsSeries = destination === "series";
    const showsFolders = destination === "folders";

    if (bookGrid instanceof HTMLElement) bookGrid.hidden = !showsBooks;
    if (seriesGrid instanceof HTMLElement) seriesGrid.hidden = !showsSeries;
    if (folderOverview instanceof HTMLElement) folderOverview.hidden = !showsFolders;

    let visibleCount = 0;
    if (showsBooks) visibleCount = renderBookCollection();
    else if (showsSeries) visibleCount = renderSeriesCollection();
    else if (showsFolders) visibleCount = renderFolderCollection();

    if (previewTitle) previewTitle.textContent = content.title;
    if (previewKicker) previewKicker.textContent = content.kicker;
    if (previewResults) {
      const singular = content.noun === "series" ? "series" : content.noun.slice(0, -1);
      previewResults.textContent = `${visibleCount} ${visibleCount === 1 ? singular : content.noun}`;
    }

    if (librarySearch instanceof HTMLInputElement) {
      librarySearch.placeholder = showsSeries
        ? "Search series"
        : showsFolders
          ? "Search folders"
          : "Search books";
    }
    if (libraryFilter instanceof HTMLButtonElement) {
      libraryFilter.disabled = !showsBooks;
      libraryFilter.setAttribute("aria-pressed", String(libraryState.inProgressOnly));
    }
    requestPageMetricsRefresh();
  };

  const setLibraryDestination = (destination) => {
    if (!libraryDestinations[destination]) return;
    libraryState.destination = destination;
    libraryState.folder = null;
    clearLibrarySelection();
    const activeButton = libraryViewButtons.find(
      (button) => button.dataset.libraryView === destination,
    );
    activeButton?.classList.add("active");
    activeButton?.setAttribute("aria-pressed", "true");
    renderLibraryPreview();
  };

  const setFolderView = (folder) => {
    if (!folder) return;
    libraryState.destination = "folder";
    libraryState.folder = folder;
    clearLibrarySelection();
    const activeButton = folderButtons.find((button) => button.dataset.libraryFolder === folder);
    activeButton?.classList.add("active");
    activeButton?.setAttribute("aria-pressed", "true");
    renderLibraryPreview();
  };

  libraryViewButtons.forEach((button) => {
    button.addEventListener("click", () =>
      setLibraryDestination(button.dataset.libraryView || "library"),
    );
  });

  folderButtons.forEach((button) => {
    button.addEventListener("click", () => setFolderView(button.dataset.libraryFolder || ""));
  });

  folderOverviewButtons.forEach((button) => {
    button.addEventListener("click", () => setFolderView(button.dataset.libraryFolderCard || ""));
  });

  librarySearch?.addEventListener("input", () => {
    if (!(librarySearch instanceof HTMLInputElement)) return;
    libraryState.query = librarySearch.value;
    renderLibraryPreview();
  });

  libraryFilter?.addEventListener("click", () => {
    if (!(libraryFilter instanceof HTMLButtonElement) || libraryFilter.disabled) return;
    libraryState.inProgressOnly = !libraryState.inProgressOnly;
    renderLibraryPreview();
  });

  librarySort?.addEventListener("change", () => {
    if (!(librarySort instanceof HTMLSelectElement)) return;
    libraryState.sort = librarySort.value === "recent" ? "recent" : "title";
    renderLibraryPreview();
  });

  renderLibraryPreview();

  const readerDemo = document.querySelector("[data-reader-demo]");
  const readerFrame = readerDemo?.querySelector(".reader-demo__frame");
  const themeButtons = Array.from(document.querySelectorAll("[data-reader-theme]"));
  const readerSize = document.querySelector("#reader-size");
  const readerSizeOutput = document.querySelector("#reader-size-output");
  const readerModeButtons = Array.from(document.querySelectorAll("[data-reader-mode]"));
  const readerModeStatus = document.querySelector("[data-reader-mode-status]");

  const selectReaderMode = (button) => {
    const mode = button.dataset.readerMode === "continuous" ? "continuous" : "paged";
    readerDemo?.setAttribute("data-mode", mode);
    readerModeButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    if (readerModeStatus) {
      readerModeStatus.textContent =
        mode === "continuous" ? "Continuous scrolling" : "Page-by-page reading";
    }
  };

  readerModeButtons.forEach((button) => {
    button.addEventListener("click", () => selectReaderMode(button));
  });

  const selectReaderTheme = (button) => {
    readerDemo?.setAttribute("data-theme", button.dataset.readerTheme || "dark");
    themeButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-checked", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
  };

  themeButtons.forEach((button, index) => {
    button.addEventListener("click", () => selectReaderTheme(button));
    button.addEventListener("keydown", (event) => {
      let nextIndex;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (index + 1) % themeButtons.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (index - 1 + themeButtons.length) % themeButtons.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = themeButtons.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      selectReaderTheme(themeButtons[nextIndex]);
      themeButtons[nextIndex].focus();
    });
  });

  readerSize?.addEventListener("input", () => {
    if (!(readerSize instanceof HTMLInputElement)) return;
    readerDemo?.style.setProperty("--reader-size", `${readerSize.value}px`);
    if (readerSizeOutput) readerSizeOutput.textContent = readerSize.value;
  });

  const readerPages = [
    {
      variant: "opener",
      chapterLabel: "Chapter 12 · The Relay",
      progress: 67,
      pageNumber: 211,
      content: `
        <p class="chapter-number">Chapter Twelve</p>
        <h3>The Relay</h3>
        <p class="reader-deck"><span class="reader-annotatable" data-reader-annotatable data-annotation-key="relay-silence" role="button" tabindex="0">The oldest receiver on Meridian Station had been silent for nineteen years.</span></p>
        <div class="reader-transmission-card">
          <span>Unidentified transmission</span>
          <strong>11 second interval</strong>
          <small>Origin unresolved · Signal stable</small>
        </div>
        <p>Mara isolated the pattern and watched its fragments align across the console. It was not a warning. It was a route.</p>
      `,
    },
    {
      variant: "prose",
      chapterLabel: "Chapter 12 · The Relay",
      progress: 68,
      pageNumber: 214,
      content: `
        <p class="reader-running-head">Signal and Dust · Chapter Twelve</p>
        <p class="reader-dropcap">By the time the signal crossed the station network, Mara had already stopped listening for a reply. The station had taught her that silence was not the absence of information. It was a shape, a pressure, a thing with weight.</p>
        <p>Outside the glass, the catalogue lights moved in strict intervals. Each pulse marked a volume returned to its place, a record made legible again.</p>
        <blockquote><span class="reader-annotatable" data-reader-annotatable data-annotation-key="nothing-lost" role="button" tabindex="0">Nothing was lost. It had only been waiting for an index.</span></blockquote>
        <p>The console warmed beneath her hands. One more book was ready to be read.</p>
      `,
    },
    {
      variant: "transcript",
      chapterLabel: "Chapter 12 · The Relay",
      progress: 69,
      pageNumber: 217,
      content: `
        <p class="chapter-number">Recovered record</p>
        <h3>Outer Stack 04</h3>
        <div class="reader-transcript" aria-label="Recovered transmission transcript">
          <p><time>00:00:11</time><span>STACK FOUR ONLINE</span></p>
          <p><time>00:00:22</time><span>CATALOGUE PATH RESTORED</span></p>
          <p><time>00:00:33</time><span>ONE VOLUME UNACCOUNTED FOR</span></p>
          <p class="reader-transcript__final"><time>00:00:44</time><span class="reader-annotatable" data-reader-annotatable data-annotation-key="awaiting-reader" role="button" tabindex="0">AWAITING READER</span></p>
        </div>
        <p>Mara followed the sequence past damaged manifests until a single shelf remained illuminated. The relay was not calling the station. It was calling her.</p>
      `,
    },
    {
      variant: "index",
      chapterLabel: "Chapter 13 · The Index",
      progress: 70,
      pageNumber: 221,
      content: `
        <p class="chapter-number">Chapter Thirteen</p>
        <h3>The Index</h3>
        <p>The book opened to a page absent from its table of contents. Four entries had been typed in ink that still looked wet.</p>
        <ol class="reader-index-list">
          <li><span>Ilyan Vale</span><time>Meridian · 2174</time></li>
          <li><span>Sera Noll</span><time>Outer Ring · 2191</time></li>
          <li><span>Orin Cass</span><time>Relay Nine · 2206</time></li>
          <li class="reader-index-list__current"><span>Mara Vey</span><time>Meridian · Tomorrow</time></li>
        </ol>
        <blockquote><span class="reader-annotatable" data-reader-annotatable data-annotation-key="future-memory" role="button" tabindex="0">An archive does not predict the future. It remembers what has not happened yet.</span></blockquote>
      `,
    },
  ];

  const readerPageCopy = document.querySelector("[data-reader-page-copy]");
  const readerChapterLabel = document.querySelector("[data-reader-chapter-label]");
  const readerProgress = document.querySelector("[data-reader-progress]");
  const readerPageCount = document.querySelector("[data-reader-page-count]");
  const previousPageButton = document.querySelector('[data-reader-page="previous"]');
  const nextPageButton = document.querySelector('[data-reader-page="next"]');
  const bookmarkButton = document.querySelector("[data-reader-bookmark-toggle]");
  const annotationsButton = document.querySelector("[data-reader-annotations-toggle]");
  const annotationsPanel = document.querySelector("[data-reader-annotations-panel]");
  const annotationsCloseButton = document.querySelector("[data-reader-annotations-close]");
  const annotationsList = document.querySelector("[data-reader-annotations-list]");
  const annotationFilterButtons = Array.from(
    document.querySelectorAll("[data-reader-annotation-filter]"),
  );
  const highlightPalette = document.querySelector("[data-reader-highlight-palette]");
  const highlightColorButtons = Array.from(document.querySelectorAll("[data-highlight-color]"));
  const noteActionButton = document.querySelector("[data-reader-note-action]");
  const notePanel = document.querySelector("[data-reader-note-panel]");
  const noteBackButton = document.querySelector("[data-reader-note-back]");
  const noteInput = document.querySelector("[data-reader-note-input]");
  const noteStatus = document.querySelector("[data-reader-note-status]");
  const noteDeleteButton = document.querySelector("[data-reader-note-delete]");
  const annotationStatus = document.querySelector("[data-reader-annotation-status]");
  const passageDescriptions = document.querySelector("[data-reader-passage-descriptions]");
  const annotationHint = document.querySelector("[data-reader-annotation-hint]");

  const highlightColors = {
    yellow: "#f2c94c",
    green: "#6fcf97",
    blue: "#56ccf2",
    rose: "#eb8fa3",
  };
  const highlights = new Map();
  const bookmarks = new Set([0]);
  let readerPageIndex = 1;
  let readerPageTransitioning = false;
  let activeAnnotationKey = null;
  let annotationFilter = "all";
  let noteSaveTimer = 0;

  const announceAnnotation = (message) => {
    if (annotationStatus) annotationStatus.textContent = message;
  };

  const pageAnnotationTarget = (pageIndex) => {
    const match = readerPages[pageIndex].content.match(
      /data-annotation-key="([^"]+)"[^>]*>([^<]+)</,
    );
    return match ? { key: match[1], quote: match[2].trim() } : null;
  };

  const closeHighlightPalette = ({ restoreFocus = false } = {}) => {
    if (!(highlightPalette instanceof HTMLElement)) return;
    const invokingTarget = readerPageCopy?.querySelector(".is-palette-target");
    highlightPalette.hidden = true;
    readerPageCopy?.querySelectorAll(".is-palette-target").forEach((target) => {
      target.classList.remove("is-palette-target");
      target.removeAttribute("aria-expanded");
    });
    if (restoreFocus && invokingTarget instanceof HTMLElement && invokingTarget.isConnected) {
      invokingTarget.focus({ preventScroll: true });
    }
  };

  const closeReaderPanels = ({ restoreFocus = false } = {}) => {
    if (annotationsPanel instanceof HTMLElement) annotationsPanel.hidden = true;
    if (notePanel instanceof HTMLElement) notePanel.hidden = true;
    readerFrame?.classList.remove("has-reader-panel", "has-annotations");
    annotationsButton?.setAttribute("aria-expanded", "false");
    if (restoreFocus && annotationsButton instanceof HTMLElement) annotationsButton.focus();
  };

  const updateBookmarkButton = () => {
    if (!(bookmarkButton instanceof HTMLButtonElement)) return;
    const active = bookmarks.has(readerPageIndex);
    bookmarkButton.setAttribute("aria-pressed", String(active));
    bookmarkButton.title = active ? "Remove bookmark" : "Add bookmark";
  };

  const hydrateReaderAnnotations = () => {
    readerPageCopy?.querySelectorAll("[data-reader-annotatable]").forEach((target) => {
      if (!(target instanceof HTMLElement) || !(passageDescriptions instanceof HTMLElement)) return;
      const key = target.dataset.annotationKey;
      if (!key) return;
      const annotation = highlights.get(key);
      const descriptionId = `reader-passage-${key}-description`;
      let description = document.getElementById(descriptionId);
      if (!description) {
        description = document.createElement("span");
        description.id = descriptionId;
        description.className = "sr-only";
        description.setAttribute("data-reader-passage-description", "");
        passageDescriptions.append(description);
      }
      target.setAttribute("aria-describedby", descriptionId);
      if (annotation) {
        target.dataset.highlight = annotation.color;
        target.dataset.hasNote = annotation.note ? "true" : "false";
        const color = annotation.color[0].toUpperCase() + annotation.color.slice(1);
        description.textContent = annotation.note
          ? `${color} highlight with note. Select to change the highlight or edit the note.`
          : `${color} highlight. Select to change the highlight or add a note.`;
      } else {
        delete target.dataset.highlight;
        delete target.dataset.hasNote;
        description.textContent = "Select to highlight this passage or add a note.";
      }
    });
  };

  const collectAnnotations = () => {
    const items = [];
    bookmarks.forEach((pageIndex) => {
      const target = pageAnnotationTarget(pageIndex);
      items.push({
        type: "bookmark",
        pageIndex,
        key: null,
        chapter: readerPages[pageIndex].chapterLabel,
        quote: target?.quote || "Saved reading position",
        note: "",
        color: "blue",
      });
    });
    highlights.forEach((annotation, key) => {
      items.push({ ...annotation, type: "highlight", key });
    });
    return items.sort((a, b) => a.pageIndex - b.pageIndex || a.type.localeCompare(b.type));
  };

  const escapeMarkup = (value) =>
    value.replace(
      /[&<>'"]/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[character],
    );

  const renderAnnotationsPanel = () => {
    if (!(annotationsList instanceof HTMLElement)) return;
    const visible = collectAnnotations().filter((item) => {
      if (annotationFilter === "bookmarks") return item.type === "bookmark";
      if (annotationFilter === "highlights") return item.type === "highlight";
      return true;
    });

    if (visible.length === 0) {
      annotationsList.innerHTML = `
        <div class="reader-annotations-empty">
          <strong>No ${annotationFilter === "all" ? "annotations" : annotationFilter}</strong>
          <span>Bookmarks and highlighted passages appear here.</span>
        </div>`;
      return;
    }

    const groups = new Map();
    visible.forEach((item) => {
      if (!groups.has(item.chapter)) groups.set(item.chapter, []);
      groups.get(item.chapter).push(item);
    });

    annotationsList.innerHTML = Array.from(groups.entries())
      .map(
        ([chapter, items]) => `
      <section class="reader-annotation-group">
        <h4>${escapeMarkup(chapter)}</h4>
        ${items
          .map(
            (item) => `
          <button
            type="button"
            class="reader-annotation-card"
            data-reader-annotation-jump
            data-page-index="${item.pageIndex}"
            ${item.key ? `data-annotation-key="${escapeMarkup(item.key)}"` : ""}
          >
            <span class="reader-annotation-card__type">
              <i class="reader-annotation-card__dot" style="--annotation-color: ${item.type === "highlight" ? highlightColors[item.color] : "var(--blue)"}"></i>
              ${item.type === "highlight" ? `${item.color[0].toUpperCase()}${item.color.slice(1)} highlight` : "Bookmark"}
            </span>
            <span class="reader-annotation-card__quote">${escapeMarkup(item.quote)}</span>
            ${item.note ? `<span class="reader-annotation-card__note">${escapeMarkup(item.note)}</span>` : ""}
          </button>`,
          )
          .join("")}
      </section>`,
      )
      .join("");
  };

  const openAnnotationsPanel = () => {
    closeHighlightPalette();
    if (notePanel instanceof HTMLElement) notePanel.hidden = true;
    if (annotationsPanel instanceof HTMLElement) annotationsPanel.hidden = false;
    readerFrame?.classList.add("has-reader-panel", "has-annotations");
    annotationsButton?.setAttribute("aria-expanded", "true");
    renderAnnotationsPanel();
    annotationsCloseButton?.focus();
  };

  const openNotePanel = () => {
    if (!activeAnnotationKey) return;
    const target = readerPageCopy?.querySelector(
      `[data-annotation-key="${CSS.escape(activeAnnotationKey)}"]`,
    );
    if (!(target instanceof HTMLElement)) return;
    const existing = highlights.get(activeAnnotationKey) || {
      pageIndex: readerPageIndex,
      chapter: readerPages[readerPageIndex].chapterLabel,
      quote: target.textContent?.trim() || "Highlighted passage",
      color: "yellow",
      note: "",
    };
    highlights.set(activeAnnotationKey, existing);
    hydrateReaderAnnotations();
    closeHighlightPalette();
    if (annotationsPanel instanceof HTMLElement) annotationsPanel.hidden = true;
    if (notePanel instanceof HTMLElement) notePanel.hidden = false;
    readerFrame?.classList.add("has-reader-panel", "has-annotations");
    annotationsButton?.setAttribute("aria-expanded", "true");
    if (noteInput instanceof HTMLTextAreaElement) {
      noteInput.value = existing.note || "";
      noteInput.focus();
    }
    if (noteStatus) noteStatus.textContent = existing.note ? "Saved" : "Changes save automatically";
    if (noteDeleteButton instanceof HTMLButtonElement) noteDeleteButton.disabled = !existing.note;
  };

  const positionHighlightPalette = (target) => {
    if (!(highlightPalette instanceof HTMLElement) || !(readerFrame instanceof HTMLElement)) return;
    highlightPalette.hidden = false;
    const frameRect = readerFrame.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const paletteRect = highlightPalette.getBoundingClientRect();
    const desiredLeft =
      targetRect.left - frameRect.left + targetRect.width / 2 - paletteRect.width / 2;
    const left = Math.min(Math.max(10, desiredLeft), frameRect.width - paletteRect.width - 10);
    const above = targetRect.top - frameRect.top - paletteRect.height - 10;
    const top = above > 66 ? above : targetRect.bottom - frameRect.top + 10;
    highlightPalette.style.left = `${left}px`;
    highlightPalette.style.top = `${Math.min(top, frameRect.height - paletteRect.height - 12)}px`;
  };

  const openHighlightPalette = (target) => {
    closeReaderPanels();
    activeAnnotationKey = target.dataset.annotationKey || null;
    if (!activeAnnotationKey) return;
    target.classList.add("is-palette-target");
    target.setAttribute("aria-expanded", "true");
    const annotation = highlights.get(activeAnnotationKey);
    highlightColorButtons.forEach((button) => {
      const color = button.dataset.highlightColor;
      if (color && Object.hasOwn(highlightColors, color)) {
        button.setAttribute("aria-pressed", String(color === annotation?.color));
      } else {
        button.removeAttribute("aria-pressed");
      }
    });
    if (noteActionButton instanceof HTMLButtonElement) {
      const label = annotation?.note
        ? "Edit note"
        : annotation
          ? "Add note"
          : "Highlight and add note";
      noteActionButton.setAttribute("aria-label", label);
      noteActionButton.title = label;
    }
    positionHighlightPalette(target);
    const selectedColorButton = highlightColorButtons.find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    const firstColorButton = highlightColorButtons.find(
      (button) => button.dataset.highlightColor !== "none",
    );
    (selectedColorButton || firstColorButton)?.focus();
    annotationHint?.setAttribute("hidden", "");
    announceAnnotation("Choose a highlight color or add a note.");
  };

  const renderReaderPage = (pageIndex) => {
    if (!(readerPageCopy instanceof HTMLElement)) return;
    const page = readerPages[pageIndex];
    closeHighlightPalette();
    readerPageCopy.dataset.readerPageVariant = page.variant;
    readerPageCopy.innerHTML = page.content;
    passageDescriptions?.replaceChildren();
    if (readerChapterLabel) readerChapterLabel.textContent = page.chapterLabel;
    if (readerProgress instanceof HTMLElement) readerProgress.style.width = `${page.progress}%`;
    if (readerPageCount)
      readerPageCount.textContent = `${page.progress}% · ${page.pageNumber} / 315`;
    readerPageIndex = pageIndex;
    hydrateReaderAnnotations();
    updateBookmarkButton();
    if (previousPageButton instanceof HTMLButtonElement)
      previousPageButton.disabled = readerPageIndex === 0;
    if (nextPageButton instanceof HTMLButtonElement)
      nextPageButton.disabled = readerPageIndex === readerPages.length - 1;
  };

  const updateReaderPage = (nextIndex, direction) => {
    if (!(readerPageCopy instanceof HTMLElement) || readerPageTransitioning) return;
    if (nextIndex < 0 || nextIndex >= readerPages.length || nextIndex === readerPageIndex) return;
    closeReaderPanels();
    closeHighlightPalette();

    if (reducedMotion.matches) {
      renderReaderPage(nextIndex);
      return;
    }

    readerPageTransitioning = true;
    readerPageCopy.classList.add(
      direction === "backward" ? "is-turning-backward" : "is-turning-forward",
    );
    window.setTimeout(() => {
      renderReaderPage(nextIndex);
      readerPageCopy.classList.remove("is-turning-forward", "is-turning-backward");
      readerPageTransitioning = false;
    }, 140);
  };

  readerPageCopy?.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element ? event.target.closest("[data-reader-annotatable]") : null;
    if (target instanceof HTMLElement) openHighlightPalette(target);
  });

  readerPageCopy?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target =
      event.target instanceof Element ? event.target.closest("[data-reader-annotatable]") : null;
    if (!(target instanceof HTMLElement)) return;
    event.preventDefault();
    openHighlightPalette(target);
  });

  highlightColorButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!activeAnnotationKey) return;
      const color = button.dataset.highlightColor;
      const target = readerPageCopy?.querySelector(
        `[data-annotation-key="${CSS.escape(activeAnnotationKey)}"]`,
      );
      if (!(target instanceof HTMLElement)) return;
      if (color === "none") {
        highlights.delete(activeAnnotationKey);
        announceAnnotation("Highlight removed.");
      } else if (color && Object.hasOwn(highlightColors, color)) {
        const previous = highlights.get(activeAnnotationKey);
        highlights.set(activeAnnotationKey, {
          pageIndex: readerPageIndex,
          chapter: readerPages[readerPageIndex].chapterLabel,
          quote: target.textContent?.trim() || "Highlighted passage",
          color,
          note: previous?.note || "",
        });
        announceAnnotation(`${color[0].toUpperCase()}${color.slice(1)} highlight added.`);
      }
      hydrateReaderAnnotations();
      renderAnnotationsPanel();
      closeHighlightPalette({ restoreFocus: true });
    });
  });

  noteActionButton?.addEventListener("click", openNotePanel);

  bookmarkButton?.addEventListener("click", () => {
    const active = bookmarks.has(readerPageIndex);
    if (active) bookmarks.delete(readerPageIndex);
    else bookmarks.add(readerPageIndex);
    updateBookmarkButton();
    renderAnnotationsPanel();
    announceAnnotation(active ? "Bookmark removed." : "Page bookmarked.");
  });

  annotationsButton?.addEventListener("click", () => {
    const isOpen = annotationsPanel instanceof HTMLElement && !annotationsPanel.hidden;
    if (isOpen) closeReaderPanels({ restoreFocus: true });
    else openAnnotationsPanel();
  });

  annotationsCloseButton?.addEventListener("click", () =>
    closeReaderPanels({ restoreFocus: true }),
  );

  annotationFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      annotationFilter = button.dataset.readerAnnotationFilter || "all";
      annotationFilterButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderAnnotationsPanel();
    });
  });

  annotationsList?.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest("[data-reader-annotation-jump]")
        : null;
    if (!(button instanceof HTMLElement)) return;
    const pageIndex = Number(button.dataset.pageIndex);
    const annotationKey = button.dataset.annotationKey;
    closeReaderPanels();
    renderReaderPage(pageIndex);
    window.requestAnimationFrame(() => {
      const target = annotationKey
        ? readerPageCopy?.querySelector(`[data-annotation-key="${CSS.escape(annotationKey)}"]`)
        : readerPageCopy;
      if (!(target instanceof HTMLElement)) return;
      target.classList.add("is-annotation-target");
      target.focus({ preventScroll: true });
      window.setTimeout(() => target.classList.remove("is-annotation-target"), 800);
    });
  });

  noteInput?.addEventListener("input", () => {
    if (!(noteInput instanceof HTMLTextAreaElement) || !activeAnnotationKey) return;
    const annotation = highlights.get(activeAnnotationKey);
    if (!annotation) return;
    annotation.note = noteInput.value.trim();
    highlights.set(activeAnnotationKey, annotation);
    hydrateReaderAnnotations();
    if (noteDeleteButton instanceof HTMLButtonElement) noteDeleteButton.disabled = !annotation.note;
    if (noteStatus) noteStatus.textContent = "Saving…";
    window.clearTimeout(noteSaveTimer);
    noteSaveTimer = window.setTimeout(() => {
      if (noteStatus)
        noteStatus.textContent = annotation.note ? "Saved" : "Changes save automatically";
      renderAnnotationsPanel();
    }, 420);
  });

  noteBackButton?.addEventListener("click", openAnnotationsPanel);

  noteDeleteButton?.addEventListener("click", () => {
    if (!activeAnnotationKey) return;
    const annotation = highlights.get(activeAnnotationKey);
    if (!annotation) return;
    annotation.note = "";
    highlights.set(activeAnnotationKey, annotation);
    if (noteInput instanceof HTMLTextAreaElement) noteInput.value = "";
    if (noteStatus) noteStatus.textContent = "Note deleted. Highlight kept.";
    if (noteDeleteButton instanceof HTMLButtonElement) noteDeleteButton.disabled = true;
    hydrateReaderAnnotations();
    renderAnnotationsPanel();
  });

  previousPageButton?.addEventListener("click", () =>
    updateReaderPage(readerPageIndex - 1, "backward"),
  );
  nextPageButton?.addEventListener("click", () => updateReaderPage(readerPageIndex + 1, "forward"));

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!(highlightPalette instanceof HTMLElement) || highlightPalette.hidden) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (highlightPalette.contains(target)) return;
      if (target instanceof Element && target.closest("[data-reader-annotatable]")) return;
      closeHighlightPalette({ restoreFocus: highlightPalette.contains(document.activeElement) });
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (highlightPalette instanceof HTMLElement && !highlightPalette.hidden) {
      closeHighlightPalette({ restoreFocus: true });
      return;
    }
    if (notePanel instanceof HTMLElement && !notePanel.hidden) {
      openAnnotationsPanel();
      return;
    }
    if (annotationsPanel instanceof HTMLElement && !annotationsPanel.hidden) {
      closeReaderPanels({ restoreFocus: true });
    }
  });

  renderReaderPage(readerPageIndex);
})();
