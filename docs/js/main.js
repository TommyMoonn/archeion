(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(pointer: fine)");

  const header = document.querySelector("[data-header]");
  const navToggle = document.querySelector(".nav-toggle");
  const siteNav = document.querySelector(".site-nav");
  const navLinks = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));

  const closeNavigation = () => {
    if (!navToggle || !siteNav) return;
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open navigation");
    siteNav.classList.remove("is-open");
    const use = navToggle.querySelector("use");
    use?.setAttribute("href", "#icon-menu");
  };

  navToggle?.addEventListener("click", () => {
    if (!siteNav) return;
    const willOpen = navToggle.getAttribute("aria-expanded") !== "true";
    navToggle.setAttribute("aria-expanded", String(willOpen));
    navToggle.setAttribute("aria-label", willOpen ? "Close navigation" : "Open navigation");
    siteNav.classList.toggle("is-open", willOpen);
    const use = navToggle.querySelector("use");
    use?.setAttribute("href", willOpen ? "#icon-close" : "#icon-menu");
  });

  navLinks.forEach((link) => link.addEventListener("click", closeNavigation));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNavigation();
  });

  document.addEventListener("click", (event) => {
    if (!siteNav?.classList.contains("is-open") || !navToggle) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!siteNav.contains(target) && !navToggle.contains(target)) closeNavigation();
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

  window.addEventListener("scroll", requestPageScrollUpdate, { passive: true });
  window.addEventListener("resize", requestPageMetricsRefresh);
  window.addEventListener("load", refreshPageMetrics, { once: true });
  document.fonts?.ready.then(refreshPageMetrics).catch(() => undefined);
  refreshPageMetrics();

  const initializeHomeOrbitAnimation = () => {
    const hero = document.getElementById("top");
    const stage = document.querySelector("[data-home-orbit-stage]");
    const scene = document.querySelector("[data-home-orbit-scene]");
    const canvas = document.querySelector("[data-home-orbit-canvas]");
    const lowPowerDevice =
      !finePointer.matches ||
      (Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 4);

    if (stage && scene && finePointer.matches && !reducedMotion.matches) {
      let parallaxFrame = 0;
      let targetX = 0;
      let targetY = 0;

      const renderParallax = () => {
        scene.style.setProperty("--home-tilt-x", `${targetX.toFixed(2)}deg`);
        scene.style.setProperty("--home-tilt-y", `${targetY.toFixed(2)}deg`);
        parallaxFrame = 0;
      };

      stage.addEventListener("pointermove", (event) => {
        const rect = stage.getBoundingClientRect();
        targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 6;
        targetY = ((event.clientY - rect.top) / rect.height - 0.5) * -5;
        if (!parallaxFrame) parallaxFrame = window.requestAnimationFrame(renderParallax);
      });

      stage.addEventListener("pointerleave", () => {
        targetX = 0;
        targetY = 0;
        if (!parallaxFrame) parallaxFrame = window.requestAnimationFrame(renderParallax);
      });
    }

    if (
      !(canvas instanceof HTMLCanvasElement) ||
      !(hero instanceof HTMLElement) ||
      !(stage instanceof HTMLElement) ||
      reducedMotion.matches
    ) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return;

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let stars = [];
    let particles = [];
    let animationFrame = 0;
    let previousTime = 0;
    let visible = true;
    const targetFps = lowPowerDevice ? 24 : 45;
    const frameInterval = 1000 / targetFps;

    const randomBetween = (min, max) => min + Math.random() * (max - min);

    const createScene = () => {
      const heroRect = hero.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const centerX = stageRect.left - heroRect.left + stageRect.width / 2;
      const centerY = stageRect.top - heroRect.top + stageRect.height / 2;
      const orbitRadius = Math.min(stageRect.width, stageRect.height) * 0.43;
      const starCount = Math.min(
        lowPowerDevice ? 90 : 165,
        Math.max(64, Math.round((width * height) / 12000)),
      );

      stars = Array.from({ length: starCount }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: randomBetween(0.35, 1.15),
        opacity: randomBetween(0.07, 0.42),
        phase: Math.random() * Math.PI * 2,
        speed: randomBetween(0.00035, 0.0011),
      }));

      const particleCount = lowPowerDevice ? 22 : 36;
      particles = Array.from({ length: particleCount }, (_, index) => ({
        centerX,
        centerY,
        radiusX: orbitRadius * randomBetween(0.72, 1.12),
        radiusY: orbitRadius * randomBetween(0.2, 0.34),
        angle: (index / particleCount) * Math.PI * 2,
        speed: randomBetween(0.00005, 0.00016),
        size: randomBetween(0.6, 1.65),
        opacity: randomBetween(0.1, 0.4),
        tilt: randomBetween(-0.12, 0.12),
      }));
    };

    const drawScene = (time, elapsed = 16) => {
      context.clearRect(0, 0, width, height);

      for (const star of stars) {
        const twinkle = 0.72 + Math.sin(time * star.speed + star.phase) * 0.28;
        context.globalAlpha = star.opacity * twinkle;
        context.fillStyle = "#d6d3d9";
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fill();
      }

      for (const particle of particles) {
        particle.angle += particle.speed * elapsed;
        const x = particle.centerX + Math.cos(particle.angle) * particle.radiusX;
        const y = particle.centerY + Math.sin(particle.angle + particle.tilt) * particle.radiusY;

        context.globalAlpha = particle.opacity;
        context.fillStyle = particle.angle % 1.8 > 0.9 ? "#b7a8d9" : "#8fc1e3";
        context.beginPath();
        context.arc(x, y, particle.size, 0, Math.PI * 2);
        context.fill();
      }

      context.globalAlpha = 1;
    };

    const resize = () => {
      const rect = hero.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      pixelRatio = Math.min(window.devicePixelRatio || 1, lowPowerDevice ? 1 : 1.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      createScene();
      drawScene(performance.now());
    };

    const animate = (time) => {
      animationFrame = 0;
      if (!visible || document.hidden) return;

      const elapsed = Math.min(32, Math.max(0, time - previousTime));
      if (elapsed >= frameInterval) {
        previousTime = time;
        drawScene(time, elapsed);
      }
      animationFrame = window.requestAnimationFrame(animate);
    };

    const startAnimation = () => {
      if (!animationFrame && visible && !document.hidden) {
        previousTime = performance.now();
        animationFrame = window.requestAnimationFrame(animate);
      }
    };

    const stopAnimation = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    };

    let resizeTimer = 0;
    const queueResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 120);
    };

    resize();
    startAnimation();

    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(queueResize);
      resizeObserver.observe(hero);
    } else {
      window.addEventListener("resize", queueResize, { passive: true });
    }

    if ("IntersectionObserver" in window) {
      const visibilityObserver = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting && entry.intersectionRatio >= 0.12;
          stage.classList.toggle("is-paused", !visible);
          if (visible) startAnimation();
          else stopAnimation();
        },
        { threshold: [0, 0.12] },
      );
      visibilityObserver.observe(hero);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopAnimation();
      else startAnimation();
    });
  };

  initializeHomeOrbitAnimation();

  const libraryViewButtons = Array.from(document.querySelectorAll("[data-library-view]"));
  const folderButtons = Array.from(document.querySelectorAll("[data-library-folder]"));
  const bookGrid = document.querySelector("[data-book-grid]");
  const previewTitle = document.querySelector("[data-preview-title]");
  const previewKicker = document.querySelector("[data-preview-kicker]");
  const libraryCaption = document.querySelector("[data-library-caption]");
  const bookCards = Array.from(document.querySelectorAll(".book-card"));
  const reduceLibraryMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const libraryViews = {
    library: {
      title: "Library",
      kicker: "All books",
      caption: "Browse every book in the active archive.",
      matches: () => true,
    },
    favorites: {
      title: "Favorites",
      caption: "Keep a focused shelf of books you want close by.",
      matches: (card) => card.dataset.favorite === "true",
    },
  };

  const animateLibraryGrid = () => {
    if (
      reduceLibraryMotion.matches ||
      !(bookGrid instanceof HTMLElement) ||
      typeof bookGrid.animate !== "function"
    ) {
      return;
    }

    bookGrid.getAnimations().forEach((animation) => animation.cancel());
    bookGrid.animate(
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

  const renderLibraryBooks = ({ title, kicker, caption, matches }) => {
    if (!bookGrid) return;

    let visibleCount = 0;
    bookCards.forEach((card) => {
      const visible = matches(card);
      card.classList.toggle("is-hidden", !visible);
      if (visible) visibleCount += 1;
    });

    if (previewTitle) previewTitle.textContent = title;
    if (previewKicker) {
      const suffix = visibleCount === 1 ? "book" : "books";
      previewKicker.textContent = kicker || `${visibleCount} ${suffix}`;
    }
    if (libraryCaption) libraryCaption.textContent = caption;
    animateLibraryGrid();
    requestPageMetricsRefresh();
  };

  const setLibraryView = (view) => {
    const content = libraryViews[view];
    if (!content) return;
    clearLibrarySelection();
    const activeButton = libraryViewButtons.find((button) => button.dataset.libraryView === view);
    activeButton?.classList.add("active");
    activeButton?.setAttribute("aria-pressed", "true");
    renderLibraryBooks(content);
  };

  const setFolderView = (folder) => {
    if (!folder) return;
    clearLibrarySelection();
    const activeButton = folderButtons.find((button) => button.dataset.libraryFolder === folder);
    activeButton?.classList.add("active");
    activeButton?.setAttribute("aria-pressed", "true");
    renderLibraryBooks({
      title: folder,
      caption: `Browse the books stored in ${folder}.`,
      matches: (card) => card.dataset.folder === folder,
    });
  };

  libraryViewButtons.forEach((button) => {
    button.addEventListener("click", () => setLibraryView(button.dataset.libraryView || "library"));
  });

  folderButtons.forEach((button) => {
    button.addEventListener("click", () => setFolderView(button.dataset.libraryFolder || ""));
  });

  const readerDemo = document.querySelector("[data-reader-demo]");
  const readerFrame = readerDemo?.querySelector(".reader-demo__frame");
  const themeButtons = Array.from(document.querySelectorAll("[data-reader-theme]"));
  const readerSize = document.querySelector("#reader-size");
  const readerSizeOutput = document.querySelector("#reader-size-output");

  themeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const theme = button.dataset.readerTheme || "dark";
      readerDemo?.setAttribute("data-theme", theme);
      themeButtons.forEach((item) => item.classList.toggle("active", item === button));
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
        <p class="reader-dropcap">By the time the signal crossed the inner ring, Mara had already stopped listening for a reply. The station had taught her that silence was not the absence of information. It was a shape, a pressure, a thing with weight.</p>
        <p>Outside the glass, the archive lights moved in strict intervals. Each pulse marked a volume returned to its place, a record made legible again.</p>
        <blockquote><span class="reader-annotatable" data-reader-annotatable data-annotation-key="nothing-lost" role="button" tabindex="0">Nothing was lost. It had only been waiting for an index.</span></blockquote>
        <p>The console warmed beneath her hands. One more book entered orbit.</p>
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
  const readerMemory = document.querySelector("[data-reader-memory]");
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

  const closeHighlightPalette = () => {
    if (!(highlightPalette instanceof HTMLElement)) return;
    highlightPalette.hidden = true;
    readerPageCopy?.querySelectorAll(".is-palette-target").forEach((target) => {
      target.classList.remove("is-palette-target");
      target.removeAttribute("aria-expanded");
    });
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
    bookmarkButton.setAttribute("aria-label", active ? "Remove bookmark" : "Add bookmark");
    bookmarkButton.title = active ? "Remove bookmark" : "Add bookmark";
  };

  const hydrateReaderAnnotations = () => {
    readerPageCopy?.querySelectorAll("[data-reader-annotatable]").forEach((target) => {
      if (!(target instanceof HTMLElement)) return;
      const key = target.dataset.annotationKey;
      const annotation = key ? highlights.get(key) : undefined;
      if (annotation) {
        target.dataset.highlight = annotation.color;
        target.dataset.hasNote = annotation.note ? "true" : "false";
        target.setAttribute(
          "aria-label",
          annotation.note ? "Highlighted passage with note" : "Highlighted passage",
        );
      } else {
        delete target.dataset.highlight;
        delete target.dataset.hasNote;
        target.setAttribute("aria-label", "Highlight this passage");
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
      const checked = button.dataset.highlightColor === (annotation?.color || "none");
      button.setAttribute("aria-checked", String(checked));
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
    annotationHint?.setAttribute("hidden", "");
    announceAnnotation("Choose a highlight color or add a note.");
  };

  const renderReaderPage = (pageIndex) => {
    if (!(readerPageCopy instanceof HTMLElement)) return;
    const page = readerPages[pageIndex];
    closeHighlightPalette();
    readerPageCopy.dataset.readerPageVariant = page.variant;
    readerPageCopy.innerHTML = page.content;
    if (readerChapterLabel) readerChapterLabel.textContent = page.chapterLabel;
    if (readerProgress instanceof HTMLElement) readerProgress.style.width = `${page.progress}%`;
    if (readerPageCount)
      readerPageCount.textContent = `${page.progress}% · ${page.pageNumber} / 315`;
    if (readerMemory)
      readerMemory.textContent = `${page.chapterLabel.split(" · ")[0]} · ${page.progress}%`;
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
      closeHighlightPalette();
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
      closeHighlightPalette();
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (highlightPalette instanceof HTMLElement && !highlightPalette.hidden) {
      closeHighlightPalette();
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

  const copyButton = document.querySelector("[data-copy-command]");
  const setupCommand = [
    "git clone https://github.com/TommyMoonn/archeion.git",
    "cd archeion",
    "npm install",
    "npm run tauri dev",
  ].join("\n");

  const writeClipboard = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Copy command was unavailable.");
  };

  copyButton?.addEventListener("click", async () => {
    const label = copyButton.querySelector("span");
    const use = copyButton.querySelector("use");
    try {
      await writeClipboard(setupCommand);
      if (label) label.textContent = "Copied";
      use?.setAttribute("href", "#icon-check");
      window.setTimeout(() => {
        if (label) label.textContent = "Copy";
        use?.setAttribute("href", "#icon-copy");
      }, 1800);
    } catch {
      if (label) label.textContent = "Select text";
      document.querySelector("#setup-command")?.parentElement?.focus?.();
    }
  });
})();
