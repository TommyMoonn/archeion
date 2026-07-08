      (() => {
        const logoSrc = document.querySelector('link[rel="icon"]')?.href;
        if (logoSrc) {
          document.querySelectorAll("[data-logo]").forEach((image) => {
            image.src = logoSrc;
            image.decoding = "async";
          });
        }

        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const navLinks = [...document.querySelectorAll(".nav-links a")];
        const sections = navLinks
          .map((link) => document.querySelector(link.getAttribute("href")))
          .filter(Boolean);

        document.querySelectorAll('a[href^="#"]').forEach((link) => {
          link.addEventListener("click", (event) => {
            const target = document.querySelector(link.getAttribute("href"));
            if (!target) return;
            event.preventDefault();
            target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
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

        if (!prefersReducedMotion && window.matchMedia("(pointer: fine)").matches) {
          const root = document.documentElement;
          const stage = document.querySelector(".hero-stage");
          const reactiveNodes = [...document.querySelectorAll(".interactive-glow")];
          let frame = 0;
          let pointerX = window.innerWidth / 2;
          let pointerY = window.innerHeight / 2;

          const updatePointerFrame = () => {
            const viewportX = pointerX / window.innerWidth;
            const viewportY = pointerY / window.innerHeight;
            const tiltX = (viewportX - 0.5) * 8;
            const tiltY = (viewportY - 0.5) * -7;

            root.style.setProperty("--cursor-x", (viewportX * 100).toFixed(2) + "%");
            root.style.setProperty("--cursor-y", (viewportY * 100).toFixed(2) + "%");
            root.style.setProperty("--hero-drift-x", ((viewportX - 0.5) * 18).toFixed(2));
            root.style.setProperty("--hero-drift-y", ((viewportY - 0.5) * 14).toFixed(2));

            if (stage) {
              stage.style.setProperty("--tilt-x", tiltX.toFixed(2) + "deg");
              stage.style.setProperty("--tilt-y", tiltY.toFixed(2) + "deg");
            }

            frame = 0;
          };

          window.addEventListener("pointermove", (event) => {
            pointerX = event.clientX;
            pointerY = event.clientY;
            if (!frame) {
              frame = window.requestAnimationFrame(updatePointerFrame);
            }
          }, { passive: true });

          reactiveNodes.forEach((node) => {
            node.addEventListener("pointermove", (event) => {
              const rect = node.getBoundingClientRect();
              const localX = (event.clientX - rect.left) / rect.width;
              const localY = (event.clientY - rect.top) / rect.height;

              node.style.setProperty("--mx", (localX * 100).toFixed(1) + "%");
              node.style.setProperty("--my", (localY * 100).toFixed(1) + "%");
              node.style.setProperty("--card-depth-x", ((localX - 0.5) * 5).toFixed(2) + "px");
              node.style.setProperty("--card-depth-y", ((localY - 0.5) * 5).toFixed(2) + "px");
            }, { passive: true });
          });
        }

        if (!prefersReducedMotion) {
          const root = document.documentElement;
          let scrollFrame = 0;

          window.addEventListener("scroll", () => {
            if (scrollFrame) return;
            scrollFrame = window.requestAnimationFrame(() => {
              const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
              root.style.setProperty("--scroll-glow", (window.scrollY / maxScroll).toFixed(4));
              scrollFrame = 0;
            });
          }, { passive: true });
        }
      })();
    
