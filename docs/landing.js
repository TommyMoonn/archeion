      (() => {
        const logoSrc = document.querySelector('link[rel="icon"]')?.href;
        if (logoSrc) {
          document.querySelectorAll("[data-logo]").forEach((image) => {
            image.src = logoSrc;
            image.decoding = "async";
          });
        }

        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const prefersMobilePerformance = window.matchMedia("(max-width: 720px), (pointer: coarse)").matches;
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const prefersLitePerformance =
          prefersMobilePerformance ||
          connection?.saveData === true ||
          (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
          (navigator.deviceMemory && navigator.deviceMemory <= 4);
        const nav = document.querySelector(".site-nav");
        let navHeight = nav?.offsetHeight || 0;
        const navLinks = [...document.querySelectorAll(".nav-links a")];
        const sections = navLinks
          .map((link) => document.querySelector(link.getAttribute("href")))
          .filter(Boolean);

        const pageRoot = document.documentElement;
        pageRoot.classList.toggle("mobile-performance", prefersMobilePerformance);
        pageRoot.classList.toggle("performance-lite", prefersLitePerformance);
        let anchorScrollTimer = 0;

        window.addEventListener("resize", () => {
          navHeight = nav?.offsetHeight || 0;
        }, { passive: true });

        const endAnchorScroll = () => {
          pageRoot.classList.remove("is-anchor-scrolling");
          window.clearTimeout(anchorScrollTimer);
          anchorScrollTimer = 0;
        };

        const getAnchorScrollTop = (target) => {
          const rect = target.getBoundingClientRect();
          const anchorPadding = Math.min(6, Math.max(0, window.innerHeight * 0.006));
          const readerNudge = target.id === "experience" ? 18 : 0;

          return Math.max(0, Math.round(window.scrollY + rect.top - navHeight - anchorPadding + readerNudge));
        };

        const beginAnchorScroll = (destinationTop) => {
          pageRoot.classList.add("sections-prewarmed");

          if (prefersReducedMotion) return;

          const distance = Math.abs(window.scrollY - destinationTop);
          const settleDelay = Math.min(1200, Math.max(520, distance * 0.55));

          pageRoot.classList.add("is-anchor-scrolling");
          window.clearTimeout(anchorScrollTimer);
          anchorScrollTimer = window.setTimeout(endAnchorScroll, settleDelay);

          if ("onscrollend" in window) {
            window.addEventListener("scrollend", endAnchorScroll, { once: true });
          }
        };

        document.querySelectorAll('a[href^="#"]').forEach((link) => {
          link.addEventListener("click", (event) => {
            const target = document.querySelector(link.getAttribute("href"));
            if (!target) return;
            event.preventDefault();

            const destinationTop = getAnchorScrollTop(target);
            beginAnchorScroll(destinationTop);
            window.scrollTo({
              top: destinationTop,
              behavior: prefersReducedMotion ? "auto" : "smooth",
            });
            history.pushState(null, "", link.getAttribute("href"));
          });
        });

        const revealObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                revealObserver.unobserve(entry.target);
              }
            });
          },
          { threshold: 0.12 },
        );

        document.querySelectorAll(".reveal").forEach((node) => revealObserver.observe(node));

        const navObserver = new IntersectionObserver(
          (entries) => {
            const visible = entries
              .filter((entry) => entry.isIntersecting)
              .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
            if (!visible) return;
            navLinks.forEach((link) => {
              link.classList.toggle("is-active", link.getAttribute("href") === "#" + visible.target.id);
            });
          },
          { rootMargin: "-35% 0px -50% 0px", threshold: [0.05, 0.2, 0.5] },
        );

        sections.forEach((section) => navObserver.observe(section));

        const activeSectionObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              entry.target.classList.toggle("is-visible-section", entry.isIntersecting);
            });
          },
          { rootMargin: "18% 0px 18% 0px", threshold: 0.01 },
        );

        document.querySelectorAll(".hero, .alive-section, .get-started-section")
          .forEach((section) => activeSectionObserver.observe(section));

        const prewarmSections = () => {
          pageRoot.classList.add("sections-prewarmed");
        };

        if (!prefersReducedMotion && !prefersLitePerformance) {
          if ("requestIdleCallback" in window) {
            window.requestIdleCallback(prewarmSections, { timeout: 900 });
          } else {
            window.setTimeout(prewarmSections, 240);
          }
        }


        const copyButton = document.querySelector("[data-copy-clone]");
        if (copyButton) {
          copyButton.addEventListener("click", async () => {
            const command = copyButton.getAttribute("data-copy-clone") || "";
            try {
              await navigator.clipboard.writeText(command);
              copyButton.textContent = "Copied";
            } catch {
              copyButton.textContent = command;
            }
            window.setTimeout(() => {
              copyButton.textContent = "Copy clone command";
            }, 1800);
          });
        }

        if (
          !prefersReducedMotion &&
          !prefersLitePerformance &&
          window.matchMedia("(hover: hover) and (pointer: fine)").matches
        ) {
          const root = pageRoot;
          const stage = document.querySelector(".hero-stage");
          const reactiveNodes = [...document.querySelectorAll(".interactive-glow")];
          let frame = 0;
          let pointerX = window.innerWidth / 2;
          let pointerY = window.innerHeight / 2;
          let glowFrame = 0;
          let glowNode = null;
          let glowEvent = null;

          const updatePointerFrame = () => {
            const viewportX = pointerX / window.innerWidth;
            const viewportY = pointerY / window.innerHeight;
            const tiltX = (viewportX - 0.5) * 6;
            const tiltY = (viewportY - 0.5) * -5;

            root.style.setProperty("--cursor-x", (viewportX * 100).toFixed(2) + "%");
            root.style.setProperty("--cursor-y", (viewportY * 100).toFixed(2) + "%");
            root.style.setProperty("--hero-drift-x", ((viewportX - 0.5) * 12).toFixed(2));
            root.style.setProperty("--hero-drift-y", ((viewportY - 0.5) * 9).toFixed(2));

            if (stage) {
              stage.style.setProperty("--tilt-x", tiltX.toFixed(2) + "deg");
              stage.style.setProperty("--tilt-y", tiltY.toFixed(2) + "deg");
            }

            frame = 0;
          };

          const updateGlowFrame = () => {
            if (!glowNode || !glowEvent) {
              glowFrame = 0;
              return;
            }

            const rect = glowNode.getBoundingClientRect();
            const localX = Math.min(1, Math.max(0, (glowEvent.clientX - rect.left) / rect.width));
            const localY = Math.min(1, Math.max(0, (glowEvent.clientY - rect.top) / rect.height));

            glowNode.style.setProperty("--mx", (localX * 100).toFixed(1) + "%");
            glowNode.style.setProperty("--my", (localY * 100).toFixed(1) + "%");
            glowNode.style.setProperty("--card-depth-x", ((localX - 0.5) * 3).toFixed(2) + "px");
            glowNode.style.setProperty("--card-depth-y", ((localY - 0.5) * 3).toFixed(2) + "px");
            glowFrame = 0;
          };

          window.addEventListener("pointermove", (event) => {
            if (root.classList.contains("is-anchor-scrolling")) return;

            pointerX = event.clientX;
            pointerY = event.clientY;
            if (!frame) {
              frame = window.requestAnimationFrame(updatePointerFrame);
            }
          }, { passive: true });

          reactiveNodes.forEach((node) => {
            node.addEventListener("pointermove", (event) => {
              glowNode = node;
              glowEvent = event;
              if (!glowFrame) {
                glowFrame = window.requestAnimationFrame(updateGlowFrame);
              }
            }, { passive: true });
          });
        }

        if (!prefersReducedMotion && !prefersLitePerformance) {
          const root = pageRoot;
          let scrollFrame = 0;

          window.addEventListener("scroll", () => {
            if (root.classList.contains("is-anchor-scrolling")) {
              root.style.setProperty("--scroll-glow", "0");
              return;
            }

            if (scrollFrame) return;
            scrollFrame = window.requestAnimationFrame(() => {
              const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
              root.style.setProperty("--scroll-glow", (window.scrollY / maxScroll).toFixed(4));
              scrollFrame = 0;
            });
          }, { passive: true });
        }
      })();
    
