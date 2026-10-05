(() => {
  const root = document.documentElement;
  const body = document.body;
  const sidebar = document.querySelector("[data-sidebar]");
  const navOpen = document.querySelector("[data-nav-open]");
  const navClose = document.querySelector("[data-nav-close]");
  const navBackdrop = document.querySelector("[data-nav-backdrop]");
  const themeButton = document.querySelector("[data-theme-toggle]");
  const storage = {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Persistence is optional when storage is unavailable.
      }
    },
  };

  const mobileNavigation = window.matchMedia("(max-width: 780px)");
  const navFocusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  function navFocusableElements() {
    if (!sidebar) return [];
    return [...sidebar.querySelectorAll(navFocusableSelector)].filter(
      (element) => element.tabIndex >= 0 && !element.closest("[hidden], [inert]"),
    );
  }

  function setNavModalSemantics(modal) {
    if (!sidebar) return;
    if (modal) {
      sidebar.setAttribute("role", "dialog");
      sidebar.setAttribute("aria-modal", "true");
      return;
    }
    sidebar.removeAttribute("role");
    sidebar.removeAttribute("aria-modal");
  }

  function setNavBackgroundInert(inert) {
    for (const element of body.children) {
      if (element === sidebar || element === navBackdrop) continue;
      element.inert = inert;
    }
  }

  function setNav(open, restoreFocus = true) {
    const isOpen = mobileNavigation.matches && open;

    if (isOpen) {
      if (sidebar) sidebar.inert = false;
      setNavModalSemantics(true);
      body.classList.add("nav-open");
      navOpen?.setAttribute("aria-expanded", "true");
      if (navBackdrop) navBackdrop.hidden = false;
      setNavBackgroundInert(true);
      navClose?.focus();
      return;
    }

    setNavBackgroundInert(false);
    setNavModalSemantics(false);
    body.classList.remove("nav-open");
    navOpen?.setAttribute("aria-expanded", "false");
    if (navBackdrop) navBackdrop.hidden = true;
    if (sidebar) sidebar.inert = mobileNavigation.matches;
    if (restoreFocus && mobileNavigation.matches) navOpen?.focus();
  }

  function syncNavMode() {
    const activeElement = document.activeElement;
    const focusWasInSidebar = Boolean(sidebar?.contains(activeElement));
    const focusWasOnOpener = activeElement === navOpen;

    setNav(false, mobileNavigation.matches && focusWasInSidebar);

    if (!mobileNavigation.matches && (focusWasInSidebar || focusWasOnOpener)) {
      sidebar?.querySelector('a[aria-current="page"], a')?.focus();
    }
  }

  syncNavMode();
  mobileNavigation.addEventListener("change", syncNavMode);

  navOpen?.addEventListener("click", () => setNav(true));
  navClose?.addEventListener("click", () => setNav(false));
  navBackdrop?.addEventListener("click", () => setNav(false));
  sidebar?.querySelectorAll("a[href]").forEach((link) =>
    link.addEventListener("click", (event) => {
      if (
        !mobileNavigation.matches ||
        !body.classList.contains("nav-open") ||
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

      setNav(false, false);
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

  document.querySelectorAll("[data-sidebar-group-toggle]").forEach((button) => {
    const panelId = button.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel) return;

    const storageKey = `archeion-docs-group:${panelId}`;
    const containsCurrentPage = Boolean(panel.querySelector('[aria-current="page"]'));
    const savedState = storage.get(storageKey);
    const initiallyExpanded = containsCurrentPage || savedState !== "false";

    button.setAttribute("aria-expanded", String(initiallyExpanded));
    panel.hidden = !initiallyExpanded;

    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      const nextExpanded = !expanded;
      button.setAttribute("aria-expanded", String(nextExpanded));
      panel.hidden = !nextExpanded;
      storage.set(storageKey, String(nextExpanded));
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && mobileNavigation.matches && body.classList.contains("nav-open")) {
      const focusable = navFocusableElements();
      if (focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeElement = document.activeElement;
        const leavesAtStart =
          event.shiftKey && (activeElement === first || !sidebar?.contains(activeElement));
        const leavesAtEnd =
          !event.shiftKey && (activeElement === last || !sidebar?.contains(activeElement));

        if (leavesAtStart || leavesAtEnd) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    }

    if (event.key === "Escape" && body.classList.contains("nav-open")) setNav(false);
  });

  const themeOrder = ["system", "light", "dark"];
  const savedTheme = storage.get("archeion-docs-theme");
  if (themeOrder.includes(savedTheme)) root.dataset.theme = savedTheme;

  function updateThemeLabel() {
    if (!themeButton) return;
    const label = root.dataset.theme || "system";
    themeButton.setAttribute("aria-label", `Documentation theme: ${label}. Change theme`);
    themeButton.setAttribute("title", `Theme: ${label}`);
  }
  updateThemeLabel();

  themeButton?.addEventListener("click", () => {
    const current = root.dataset.theme || "system";
    const next = themeOrder[(themeOrder.indexOf(current) + 1) % themeOrder.length];
    root.dataset.theme = next;
    storage.set("archeion-docs-theme", next);
    updateThemeLabel();
  });

  const article = document.querySelector("[data-doc-article]");
  const headings = article ? [...article.querySelectorAll("h2[id], h3[id]")] : [];
  const tocTargets = [
    document.querySelector("[data-toc]"),
    document.querySelector("[data-mobile-toc]"),
  ].filter(Boolean);

  tocTargets.forEach((toc) => {
    headings.forEach((heading) => {
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent || "";
      link.dataset.level = heading.tagName === "H3" ? "3" : "2";
      toc.append(link);
    });
  });

  if (headings.length === 0)
    document.querySelector("[data-mobile-outline]")?.setAttribute("hidden", "");

  if (headings.length) {
    const desktopToc = document.querySelector("[data-toc]");
    const outlineLinks = tocTargets.map((toc) => [...toc.querySelectorAll("a")]);
    const indicator = desktopToc ? document.createElement("span") : null;
    if (indicator) {
      indicator.className = "docs-outline-indicator";
      indicator.setAttribute("aria-hidden", "true");
      desktopToc.append(indicator);
    }

    function updateOutline() {
      // Use the same clearance as native fragments, not a narrow intersection band.
      const anchor = Math.max(
        document.querySelector(".docs-header")?.getBoundingClientRect().bottom || 0,
        parseFloat(getComputedStyle(root).scrollPaddingTop) || 0,
      );
      let activeIndex = 0;
      for (const [index, heading] of headings.entries()) {
        // Native fragment scrolling rounds to CSS pixels while heading geometry is fractional.
        if (Math.round(heading.getBoundingClientRect().top) <= Math.round(anchor))
          activeIndex = index;
        else break;
      }
      // A short final section may never reach the anchor before scrolling ends.
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= root.scrollHeight - 1)
        activeIndex = headings.length - 1;

      for (const links of outlineLinks) {
        links.forEach((link, index) => {
          if (index === activeIndex) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      }
      const activeLink = desktopToc?.querySelector('a[aria-current="location"]');
      if (indicator && activeLink) {
        indicator.style.transform = `translateY(${activeLink.offsetTop}px)`;
        indicator.style.height = `${activeLink.offsetHeight}px`;
      }
    }

    let framePending = false;
    function scheduleOutline() {
      if (framePending) return;
      framePending = true;
      window.requestAnimationFrame(() => {
        framePending = false;
        updateOutline();
      });
    }

    updateOutline();
    window.addEventListener("scroll", scheduleOutline, { passive: true });
    for (const event of ["resize", "hashchange", "pageshow", "load"])
      window.addEventListener(event, scheduleOutline);
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(scheduleOutline);
      observer.observe(article);
      if (desktopToc) observer.observe(desktopToc);
    }
  }
})();
