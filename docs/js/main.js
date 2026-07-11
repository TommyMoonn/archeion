(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(pointer: fine)");

  const header = document.querySelector("[data-header]");
  const navToggle = document.querySelector(".nav-toggle");
  const siteNav = document.querySelector(".site-nav");
  const navLinks = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));

  const setHeaderState = () => {
    header?.classList.toggle("is-scrolled", window.scrollY > 12);
  };

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

  window.addEventListener("scroll", setHeaderState, { passive: true });
  setHeaderState();

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
  if ("IntersectionObserver" in window) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        navLinks.forEach((link) => {
          const isCurrent = link.getAttribute("href") === `#${visible.target.id}`;
          if (isCurrent) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      },
      { threshold: [0.28, 0.5, 0.72], rootMargin: "-15% 0px -55%" },
    );
    sections.forEach((section) => sectionObserver.observe(section));
  }

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
          visible = entry.isIntersecting;
          stage.classList.toggle("is-paused", !visible);
          if (visible) startAnimation();
          else stopAnimation();
        },
        { threshold: 0.01 },
      );
      visibilityObserver.observe(hero);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopAnimation();
      else startAnimation();
    });
  };

  initializeHomeOrbitAnimation();

  const libraryTabs = Array.from(document.querySelectorAll("[data-library-mode]"));
  const bookGrid = document.querySelector("[data-book-grid]");
  const folderView = document.querySelector("[data-folder-view]");
  const continueStrip = document.querySelector("[data-continue-strip]");
  const previewTitle = document.querySelector("[data-preview-title]");
  const previewKicker = document.querySelector("[data-preview-kicker]");
  const libraryCaption = document.querySelector("[data-library-caption]");
  const bookCards = Array.from(document.querySelectorAll(".book-card"));

  const libraryModes = {
    library: {
      title: "Library",
      kicker: "All books",
      caption: "See covers, progress, and current reads in one place.",
    },
    folders: {
      title: "Folders",
      kicker: "Folder browsing",
      caption: "Browse the same nested folders you already use.",
    },
    favorites: {
      title: "Favorites",
      kicker: "Saved shelf",
      caption: "Keep a focused shelf of books you want close by.",
    },
  };

  const setLibraryMode = (mode) => {
    const content = libraryModes[mode];
    if (!content || !bookGrid || !folderView) return;

    libraryTabs.forEach((tab) =>
      tab.setAttribute("aria-selected", String(tab.dataset.libraryMode === mode)),
    );
    if (previewTitle) previewTitle.textContent = content.title;
    if (previewKicker) previewKicker.textContent = content.kicker;
    if (libraryCaption) libraryCaption.textContent = content.caption;

    const showFolders = mode === "folders";
    folderView.hidden = !showFolders;
    bookGrid.hidden = showFolders;
    if (continueStrip instanceof HTMLElement) continueStrip.hidden = mode !== "library";

    bookCards.forEach((card) => {
      const favorite = card.getAttribute("data-favorite") === "true";
      card.classList.toggle("is-hidden", mode === "favorites" && !favorite);
    });
  };

  libraryTabs.forEach((tab) => {
    tab.addEventListener("click", () => setLibraryMode(tab.dataset.libraryMode || "library"));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = libraryTabs.indexOf(tab);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = libraryTabs[(index + direction + libraryTabs.length) % libraryTabs.length];
      next.focus();
      setLibraryMode(next.dataset.libraryMode || "library");
    });
  });

  const readerDemo = document.querySelector("[data-reader-demo]");
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
