(() => {
  const root = document.documentElement;
  const nav = document.querySelector(".site-nav");
  const navLinks = Array.from(document.querySelectorAll(".nav-links a"));
  const sectionTargets = navLinks
    .map((link) => document.querySelector(link.getAttribute("href") || ""))
    .filter(Boolean);

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const prefersFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const usesCinematicMode = root.classList.contains("cinematic-enabled") && !prefersReducedMotion;
  const usesLiteMode = root.classList.contains("performance-lite") || prefersReducedMotion;

  const syncLogoDecoding = () => {
    document.querySelectorAll("[data-logo]").forEach((image) => {
      image.decoding = "async";
    });
  };

  syncLogoDecoding();

  let navHeight = nav?.offsetHeight || 0;
  let anchorScrollTimer = 0;

  if (nav && "ResizeObserver" in window) {
    new ResizeObserver((entries) => {
      navHeight = Math.round(entries[0]?.contentRect.height || nav.offsetHeight || navHeight);
    }).observe(nav);
  } else {
    window.addEventListener(
      "resize",
      () => {
        navHeight = nav?.offsetHeight || 0;
      },
      { passive: true },
    );
  }

  const stopAnchorScrollMode = () => {
    root.classList.remove("is-anchor-scrolling");
    window.clearTimeout(anchorScrollTimer);
    anchorScrollTimer = 0;
  };

  const getAnchorScrollTop = (target) => {
    const rect = target.getBoundingClientRect();
    const anchorPadding = Math.min(6, Math.max(0, window.innerHeight * 0.006));
    const readerNudge = target.id === "experience" ? 18 : 0;

    return Math.max(
      0,
      Math.round(window.scrollY + rect.top - navHeight - anchorPadding + readerNudge),
    );
  };

  const startAnchorScrollMode = (destinationTop) => {
    if (!usesCinematicMode || prefersReducedMotion) return;

    root.classList.add("sections-prewarmed", "is-anchor-scrolling");
    window.clearTimeout(anchorScrollTimer);

    const distance = Math.abs(window.scrollY - destinationTop);
    const settleDelay = Math.min(1000, Math.max(360, distance * 0.38));
    anchorScrollTimer = window.setTimeout(stopAnchorScrollMode, settleDelay);

    if ("onscrollend" in window) {
      window.addEventListener("scrollend", stopAnchorScrollMode, { once: true });
    }
  };

  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest?.('a[href^="#"]');
      if (!link) return;

      const href = link.getAttribute("href");
      const target = href ? document.querySelector(href) : null;
      if (!target) return;

      event.preventDefault();

      const destinationTop = getAnchorScrollTop(target);
      startAnchorScrollMode(destinationTop);
      window.scrollTo({
        top: destinationTop,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
      history.pushState(null, "", href);
    },
    { passive: false },
  );

  const revealNodes = Array.from(document.querySelectorAll(".reveal"));
  if (usesLiteMode || !usesCinematicMode) {
    revealNodes.forEach((node) => node.classList.add("is-visible"));
  } else {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12 },
    );

    revealNodes.forEach((node) => revealObserver.observe(node));
  }

  if (sectionTargets.length > 0) {
    const navObserver = new IntersectionObserver(
      (entries) => {
        let activeSection = null;
        let activeRatio = 0;

        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= activeRatio) {
            activeSection = entry.target;
            activeRatio = entry.intersectionRatio;
          }
        });

        if (!activeSection) return;

        navLinks.forEach((link) => {
          link.classList.toggle("is-active", link.getAttribute("href") === `#${activeSection.id}`);
        });
      },
      { rootMargin: "-35% 0px -50% 0px", threshold: [0.05, 0.3] },
    );

    sectionTargets.forEach((section) => navObserver.observe(section));
  }

  const sectionNodes = Array.from(
    document.querySelectorAll(".hero, .alive-section, .get-started-section"),
  );
  if (!usesCinematicMode) {
    sectionNodes.forEach((section) => section.classList.add("is-visible-section"));
  } else {
    const activeSectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle("is-visible-section", entry.isIntersecting);
        });
      },
      { rootMargin: "18% 0px 18% 0px", threshold: 0.01 },
    );

    sectionNodes.forEach((section) => activeSectionObserver.observe(section));

    const prewarmSections = () => root.classList.add("sections-prewarmed");
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(prewarmSections, { timeout: 1200 });
    } else {
      window.setTimeout(prewarmSections, 420);
    }
  }

  const copyButton = document.querySelector("[data-copy-clone]");
  if (copyButton) {
    const defaultCopyLabel = copyButton.textContent || "Copy clone command";

    copyButton.addEventListener("click", async () => {
      const command = copyButton.getAttribute("data-copy-clone") || "";

      try {
        await navigator.clipboard.writeText(command);
        copyButton.textContent = "Copied";
      } catch {
        copyButton.textContent = command;
      }

      window.setTimeout(() => {
        copyButton.textContent = defaultCopyLabel;
      }, 1800);
    });
  }

  if (!usesCinematicMode || !prefersFinePointer) return;

  const stage = document.querySelector(".hero-stage");
  let pointerFrame = 0;
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;

  const updateAmbientPointer = () => {
    const viewportX = pointerX / window.innerWidth;
    const viewportY = pointerY / window.innerHeight;

    root.style.setProperty("--cursor-x", `${(viewportX * 100).toFixed(2)}%`);
    root.style.setProperty("--cursor-y", `${(viewportY * 100).toFixed(2)}%`);
    root.style.setProperty("--hero-drift-x", ((viewportX - 0.5) * 8).toFixed(2));
    root.style.setProperty("--hero-drift-y", ((viewportY - 0.5) * 6).toFixed(2));

    if (stage) {
      stage.style.setProperty("--tilt-x", `${((viewportX - 0.5) * 3.5).toFixed(2)}deg`);
      stage.style.setProperty("--tilt-y", `${((viewportY - 0.5) * -3).toFixed(2)}deg`);
    }

    pointerFrame = 0;
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      if (root.classList.contains("is-anchor-scrolling")) return;

      pointerX = event.clientX;
      pointerY = event.clientY;

      if (!pointerFrame) {
        pointerFrame = window.requestAnimationFrame(updateAmbientPointer);
      }
    },
    { passive: true },
  );

  let glowFrame = 0;
  let glowNode = null;
  let glowRect = null;
  let glowX = 0;
  let glowY = 0;

  const updateGlowPointer = () => {
    if (!glowNode || !glowRect) {
      glowFrame = 0;
      return;
    }

    const localX = Math.min(1, Math.max(0, (glowX - glowRect.left) / glowRect.width));
    const localY = Math.min(1, Math.max(0, (glowY - glowRect.top) / glowRect.height));

    glowNode.style.setProperty("--mx", `${(localX * 100).toFixed(1)}%`);
    glowNode.style.setProperty("--my", `${(localY * 100).toFixed(1)}%`);
    glowNode.style.setProperty("--card-depth-x", `${((localX - 0.5) * 2).toFixed(2)}px`);
    glowNode.style.setProperty("--card-depth-y", `${((localY - 0.5) * 2).toFixed(2)}px`);
    glowFrame = 0;
  };

  document.addEventListener(
    "pointermove",
    (event) => {
      const nextNode = event.target.closest?.(".interactive-glow");
      if (!nextNode) {
        glowNode = null;
        glowRect = null;
        return;
      }

      if (nextNode !== glowNode) {
        glowNode = nextNode;
        glowRect = glowNode.getBoundingClientRect();
      }

      glowX = event.clientX;
      glowY = event.clientY;

      if (!glowFrame) {
        glowFrame = window.requestAnimationFrame(updateGlowPointer);
      }
    },
    { passive: true },
  );

  window.addEventListener(
    "resize",
    () => {
      glowRect = glowNode?.getBoundingClientRect() || null;
    },
    { passive: true },
  );
})();
