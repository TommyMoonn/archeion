(() => {
  "use strict";

  const root = document.documentElement;
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
  const lowPowerDevice =
    coarsePointerQuery.matches ||
    (Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 4);

  root.dataset.motion = reducedMotionQuery.matches ? "off" : "on";

  const header = document.getElementById("site-header");
  const progressBar = document.getElementById("scroll-progress");
  let scrollFrame = 0;

  const updateScrollState = () => {
    scrollFrame = 0;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollRange = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, scrollTop / scrollRange));

    header?.classList.toggle("is-scrolled", scrollTop > 18);
    if (progressBar) {
      progressBar.style.transform = `scaleX(${progress})`;
    }
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!scrollFrame) {
        scrollFrame = window.requestAnimationFrame(updateScrollState);
      }
    },
    { passive: true },
  );
  updateScrollState();

  const sectionScrollConfig = {
    home: { focus: ".hero-copy", align: 0.5 },
    library: { focus: ".section-heading", align: 0.21 },
    reader: { focus: ".reader-layout", fallback: ".reader-copy", align: 0.45 },
    architecture: { focus: ".architecture-heading", align: 0.46 },
    "get-started": { focus: ".get-started-panel", fallback: ".get-started-copy", align: 0.5 },
  };

  const getSectionScrollTop = (section) => {
    if (section.id === "home") return 0;

    const config = sectionScrollConfig[section.id] || {};
    const availableHeight = Math.max(1, window.innerHeight - (header?.offsetHeight || 0));
    let focus = config.focus ? section.querySelector(config.focus) : section;

    if (focus && config.fallback && focus.getBoundingClientRect().height > availableHeight * 0.92) {
      focus = section.querySelector(config.fallback) || focus;
    }

    if (!focus) focus = section;

    const rect = focus.getBoundingClientRect();
    const headerHeight = header?.getBoundingClientRect().height || 0;
    const safeTop = headerHeight + Math.min(28, window.innerHeight * 0.035);
    const usableHeight = Math.max(1, window.innerHeight - safeTop);
    const align = config.align ?? 0.48;
    const desiredCenter = safeTop + usableHeight * align;
    const focusCenter = window.scrollY + rect.top + rect.height / 2;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    return Math.min(maxScroll, Math.max(0, focusCenter - desiredCenter));
  };

  let scrollTargetCleanup = 0;

  const scrollToSection = (section, behavior = "smooth") => {
    window.clearTimeout(scrollTargetCleanup);
    section.style.contentVisibility = "visible";
    void section.offsetHeight;

    const resolvedBehavior = root.dataset.motion === "off" ? "auto" : behavior;
    window.scrollTo({
      top: getSectionScrollTop(section),
      behavior: resolvedBehavior,
    });

    scrollTargetCleanup = window.setTimeout(
      () => section.style.removeProperty("content-visibility"),
      resolvedBehavior === "smooth" ? 850 : 0,
    );
  };

  const internalSectionLinks = Array.from(
    document.querySelectorAll('a[href^="#"]:not(.skip-link)'),
  );

  internalSectionLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const hash = link.getAttribute("href");
      if (!hash || hash === "#") return;

      const section = document.getElementById(hash.slice(1));
      if (!(section instanceof HTMLElement)) return;

      event.preventDefault();
      if (window.location.hash !== hash) {
        window.history.pushState(null, "", hash);
      } else {
        window.history.replaceState(null, "", hash);
      }
      scrollToSection(section);
    });
  });

  window.addEventListener("popstate", () => {
    const section = window.location.hash
      ? document.getElementById(window.location.hash.slice(1))
      : document.getElementById("home");
    if (section instanceof HTMLElement) scrollToSection(section, "auto");
  });

  if (window.location.hash) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const section = document.getElementById(window.location.hash.slice(1));
        if (section instanceof HTMLElement) scrollToSection(section, "auto");
      });
    });
  }

  const revealElements = document.querySelectorAll(".reveal");
  if (root.dataset.motion === "off" || !("IntersectionObserver" in window)) {
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
      { rootMargin: "0px 0px -8%", threshold: 0.08 },
    );
    revealElements.forEach((element) => revealObserver.observe(element));
  }

  const navLinks = Array.from(document.querySelectorAll(".site-nav a"));
  const sections = Array.from(document.querySelectorAll("[data-section]"));
  if ("IntersectionObserver" in window && navLinks.length) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visible) return;
        const id = visible.target.id;
        navLinks.forEach((link) => {
          link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
        });
      },
      { rootMargin: "-25% 0px -58%", threshold: [0.05, 0.2, 0.45] },
    );
    sections.forEach((section) => sectionObserver.observe(section));
  }

  const heroPanels = new Map();
  document.querySelectorAll("[data-hero-panel]").forEach((panel) => {
    heroPanels.set(panel.dataset.heroPanel, panel);
  });

  const heroViewButtons = Array.from(document.querySelectorAll("[data-hero-view]"));
  let previousHeroView = "library";

  const setHeroView = (view) => {
    if (!heroPanels.has(view)) return;

    heroPanels.forEach((panel, panelName) => {
      panel.hidden = panelName !== view;
    });

    heroViewButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.heroView === view);
    });

    if (view !== "reader") {
      previousHeroView = view;
    }
  };

  heroViewButtons.forEach((button) => {
    button.addEventListener("click", () => setHeroView(button.dataset.heroView));
  });

  document.querySelectorAll("[data-open-reader]").forEach((button) => {
    button.addEventListener("click", () => setHeroView("reader"));
  });

  document.querySelectorAll("[data-close-reader]").forEach((button) => {
    button.addEventListener("click", () => setHeroView(previousHeroView));
  });

  const tiltTarget = document.querySelector("[data-tilt]");
  if (tiltTarget && !coarsePointerQuery.matches && root.dataset.motion === "on") {
    let tiltFrame = 0;
    let nextTiltX = 0;
    let nextTiltY = 0;

    const applyTilt = () => {
      tiltFrame = 0;
      tiltTarget.style.setProperty("--tilt-x", nextTiltX.toFixed(3));
      tiltTarget.style.setProperty("--tilt-y", nextTiltY.toFixed(3));
    };

    tiltTarget.addEventListener("pointermove", (event) => {
      const rect = tiltTarget.getBoundingClientRect();
      nextTiltX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      nextTiltY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      if (!tiltFrame) tiltFrame = window.requestAnimationFrame(applyTilt);
    });

    tiltTarget.addEventListener("pointerleave", () => {
      nextTiltX = 0;
      nextTiltY = 0;
      if (!tiltFrame) tiltFrame = window.requestAnimationFrame(applyTilt);
    });
  }

  const spotlightTargets = document.querySelectorAll("[data-spotlight]");
  spotlightTargets.forEach((target) => {
    if (coarsePointerQuery.matches) return;
    target.addEventListener("pointermove", (event) => {
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
    });
  });

  if (!coarsePointerQuery.matches && root.dataset.motion === "on") {
    let pointerFrame = 0;
    let pointerX = 0;
    let pointerY = 0;

    window.addEventListener(
      "pointermove",
      (event) => {
        pointerX = event.clientX / window.innerWidth - 0.5;
        pointerY = event.clientY / window.innerHeight - 0.5;
        if (!pointerFrame) {
          pointerFrame = window.requestAnimationFrame(() => {
            pointerFrame = 0;
            root.style.setProperty("--pointer-x", pointerX.toFixed(3));
            root.style.setProperty("--pointer-y", pointerY.toFixed(3));
          });
        }
      },
      { passive: true },
    );
  }

  const readerApp = document.querySelector(".reader-app");
  const settingsPanel = document.getElementById("reader-settings-panel");
  const settingsToggle = document.getElementById("reader-settings-toggle");
  const settingsClose = document.getElementById("reader-settings-close");
  const pageInner = document.getElementById("reader-page-inner");

  const setSettingsOpen = (isOpen) => {
    settingsPanel?.classList.toggle("open", isOpen);
    settingsToggle?.setAttribute("aria-expanded", String(isOpen));
  };

  settingsToggle?.setAttribute("aria-expanded", "false");
  settingsToggle?.addEventListener("click", () => {
    setSettingsOpen(!settingsPanel?.classList.contains("open"));
  });
  settingsClose?.addEventListener("click", () => setSettingsOpen(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && settingsPanel?.classList.contains("open")) {
      setSettingsOpen(false);
      settingsToggle?.focus();
    }
  });

  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      const theme = button.dataset.theme;
      if (!theme || !readerApp) return;
      readerApp.dataset.readerTheme = theme;
      document.querySelectorAll("[data-theme]").forEach((option) => {
        option.classList.toggle("active", option === button);
      });
    });
  });

  const readerSizes = {
    small: "14px",
    medium: "16px",
    large: "18px",
  };

  document.querySelectorAll("[data-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const size = button.dataset.size;
      if (!size || !pageInner) return;
      pageInner.style.setProperty("--reader-font-size", readerSizes[size] || readerSizes.medium);
      document.querySelectorAll("[data-size]").forEach((option) => {
        option.classList.toggle("active", option === button);
      });
    });
  });

  const demoProgress = document.querySelector(".reader-demo-progress span");
  let pageProgress = 64;
  document.querySelectorAll(".page-zone, .reader-demo-actions button").forEach((button) => {
    const label = button.getAttribute("aria-label") || "";
    if (!label.includes("page")) return;

    button.addEventListener("click", () => {
      const direction = label.toLowerCase().includes("previous") ? -1 : 1;
      pageProgress = Math.min(96, Math.max(8, pageProgress + direction * 4));
      if (demoProgress) demoProgress.style.width = `${pageProgress}%`;

      if (pageInner && root.dataset.motion === "on") {
        pageInner.animate(
          [
            { opacity: 0.55, transform: `translateX(${direction * 6}px)` },
            { opacity: 1, transform: "translateX(0)" },
          ],
          { duration: 220, easing: "cubic-bezier(.2,0,0,1)" },
        );
      }
    });
  });

  const copyButton = document.getElementById("copy-command");
  const commandText = [
    "git clone https://github.com/TommyMoonn/archeion.git",
    "cd archeion",
    "npm install",
    "npm run tauri dev",
  ].join("\n");

  copyButton?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(commandText);
      const label = copyButton.querySelector("span");
      copyButton.classList.add("copied");
      if (label) label.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.classList.remove("copied");
        if (label) label.textContent = "Copy";
      }, 1600);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = commandText;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
    }
  });

  const initializeHomeOrbitAnimation = () => {
    const stage = document.querySelector("[data-home-orbit-stage]");
    const scene = stage?.querySelector("[data-home-orbit-scene]");
    const canvas = document.querySelector("[data-home-orbit-canvas]");
    const hero = document.getElementById("home");

    if (stage && scene && !coarsePointerQuery.matches && root.dataset.motion === "on") {
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
        if (!parallaxFrame) {
          parallaxFrame = window.requestAnimationFrame(renderParallax);
        }
      });

      stage.addEventListener("pointerleave", () => {
        targetX = 0;
        targetY = 0;
        if (!parallaxFrame) {
          parallaxFrame = window.requestAnimationFrame(renderParallax);
        }
      });
    }

    if (!(canvas instanceof HTMLCanvasElement) || !hero || root.dataset.motion !== "on") {
      return;
    }

    const context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
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
      const starCount = Math.min(
        lowPowerDevice ? 100 : 190,
        Math.max(70, Math.round((width * height) / 10500)),
      );

      stars = Array.from({ length: starCount }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: randomBetween(0.35, 1.2),
        opacity: randomBetween(0.08, 0.48),
        phase: Math.random() * Math.PI * 2,
        speed: randomBetween(0.00035, 0.00115),
      }));

      const stackedLayout = window.innerWidth <= 1040;
      const centerX = width * (stackedLayout ? 0.5 : 0.73);
      const centerY = height * (stackedLayout ? 0.73 : 0.5);
      const radiusX = Math.min(width, height) * (stackedLayout ? 0.27 : 0.33);
      const radiusY = radiusX * 0.29;
      const particleCount = lowPowerDevice ? 24 : 38;

      particles = Array.from({ length: particleCount }, (_, index) => ({
        centerX,
        centerY,
        radiusX: radiusX * randomBetween(0.72, 1.15),
        radiusY: radiusY * randomBetween(0.75, 1.2),
        angle: (index / particleCount) * Math.PI * 2,
        speed: randomBetween(0.00005, 0.00016),
        size: randomBetween(0.6, 1.7),
        opacity: randomBetween(0.1, 0.42),
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

  const initializeStarfield = () => {
    const canvas = document.getElementById("starfield");
    if (!(canvas instanceof HTMLCanvasElement)) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let stars = [];
    let animationFrame = 0;
    let lastFrameTime = 0;
    let isVisible = !document.hidden;
    const animate = root.dataset.motion === "on" && !reducedMotionQuery.matches;
    const targetFps = lowPowerDevice ? 20 : 30;
    const frameInterval = 1000 / targetFps;

    const createStars = () => {
      const area = width * height;
      const desiredCount = Math.round(area / (lowPowerDevice ? 26000 : 17000));
      const count = Math.min(lowPowerDevice ? 70 : 120, Math.max(34, desiredCount));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 0.75 + 0.25,
        alpha: Math.random() * 0.36 + 0.14,
        speed: Math.random() * 0.016 + 0.006,
        phase: Math.random() * Math.PI * 2,
        drift: (Math.random() - 0.5) * 0.018,
      }));
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      pixelRatio = Math.min(window.devicePixelRatio || 1, lowPowerDevice ? 1 : 1.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      createStars();
      draw(performance.now());
    };

    const draw = (time) => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#c9d9e5";

      stars.forEach((star) => {
        const pulse = animate ? Math.sin(time * star.speed + star.phase) * 0.12 : 0;
        const alpha = Math.max(0.05, star.alpha + pulse);
        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fill();

        if (animate) {
          star.x += star.drift;
          star.y += star.speed * 0.05;
          if (star.x < -2) star.x = width + 2;
          if (star.x > width + 2) star.x = -2;
          if (star.y > height + 2) star.y = -2;
        }
      });

      context.globalAlpha = 1;
    };

    const loop = (time) => {
      if (!isVisible || !animate) return;
      animationFrame = window.requestAnimationFrame(loop);
      if (time - lastFrameTime < frameInterval) return;
      lastFrameTime = time;
      draw(time);
    };

    let resizeTimer = 0;
    window.addEventListener(
      "resize",
      () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(resize, 120);
      },
      { passive: true },
    );

    document.addEventListener("visibilitychange", () => {
      isVisible = !document.hidden;
      if (isVisible && animate && !animationFrame) {
        animationFrame = window.requestAnimationFrame(loop);
      } else if (!isVisible && animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    });

    resize();
    if (animate) animationFrame = window.requestAnimationFrame(loop);
  };

  initializeHomeOrbitAnimation();
  initializeStarfield();
})();
