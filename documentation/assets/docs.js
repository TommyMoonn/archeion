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

  function setNav(open) {
    body.classList.toggle("nav-open", open);
    navOpen?.setAttribute("aria-expanded", String(open));
    if (navBackdrop) navBackdrop.hidden = !open;
  }

  navOpen?.addEventListener("click", () => setNav(true));
  navClose?.addEventListener("click", () => setNav(false));
  navBackdrop?.addEventListener("click", () => setNav(false));
  sidebar
    ?.querySelectorAll("a")
    .forEach((link) => link.addEventListener("click", () => setNav(false)));

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

  const searchDialog = document.querySelector("[data-search-dialog]");
  const searchInput = document.querySelector("[data-search-input]");
  const searchResults = document.querySelector("[data-search-results]");
  const searchEmpty = document.querySelector("[data-search-empty]");
  const searchTriggers = document.querySelectorAll("[data-search-trigger]");
  const searchClose = document.querySelector("[data-search-close]");
  const sourceLinks = [...document.querySelectorAll("[data-doc-link]")];

  function renderSearchResults() {
    if (!searchResults) return;
    const query = searchInput?.value.trim().toLocaleLowerCase() || "";
    const matches = sourceLinks.filter((link) => {
      const searchable =
        `${link.textContent || ""} ${link.dataset.search || ""}`.toLocaleLowerCase();
      return !query || searchable.includes(query);
    });

    searchResults.replaceChildren();
    matches.forEach((link) => {
      const result = document.createElement("a");
      result.className = "docs-search-result";
      result.href = link.href;
      if (link.getAttribute("aria-current") === "page") result.setAttribute("aria-current", "page");

      const title = document.createElement("strong");
      title.textContent = link.textContent?.trim() || "";
      const group = document.createElement("span");
      group.textContent =
        link.closest("[data-sidebar-group]")?.querySelector("[data-sidebar-group-toggle] span")
          ?.textContent || "Documentation";

      result.append(title, group);
      result.addEventListener("click", () => searchDialog?.close());
      searchResults.append(result);
    });

    if (searchEmpty) searchEmpty.hidden = matches.length !== 0;
  }

  function openSearch() {
    if (!searchDialog || typeof searchDialog.showModal !== "function") return;
    if (!searchDialog.open) searchDialog.showModal();
    renderSearchResults();
    window.setTimeout(() => {
      searchInput?.focus();
      searchInput?.select();
    }, 30);
  }

  searchTriggers.forEach((button) => button.addEventListener("click", openSearch));
  searchClose?.addEventListener("click", () => searchDialog?.close());
  searchInput?.addEventListener("input", renderSearchResults);
  searchDialog?.addEventListener("click", (event) => {
    if (event.target === searchDialog) searchDialog.close();
  });

  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
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

  const desktopTocLinks = [...document.querySelectorAll("[data-toc] a")];
  if ("IntersectionObserver" in window && headings.length) {
    const visible = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => visible.set(entry.target.id, entry.isIntersecting));
        const active =
          headings.find((heading) => visible.get(heading.id)) ||
          [...headings].reverse().find((heading) => heading.getBoundingClientRect().top < 150) ||
          headings[0];
        desktopTocLinks.forEach((link) =>
          link.classList.toggle("is-active", link.hash === `#${active.id}`),
        );
      },
      { rootMargin: "-90px 0px -72% 0px", threshold: [0, 1] },
    );
    headings.forEach((heading) => observer.observe(heading));
  }

  document.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    if (!code) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.setAttribute("aria-label", "Copy code");
    button.innerHTML = '<svg aria-hidden="true"><use href="#icon-copy"></use></svg>';
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent || "");
        button.setAttribute("aria-label", "Copied");
        window.setTimeout(() => button.setAttribute("aria-label", "Copy code"), 1400);
      } catch {
        button.setAttribute("aria-label", "Copy failed");
      }
    });
    pre.append(button);
  });
})();
