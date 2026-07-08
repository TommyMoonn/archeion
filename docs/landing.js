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
          const stage = document.querySelector(".hero-stage");
          let frame = 0;

          window.addEventListener("pointermove", (event) => {
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
              const x = (event.clientX / window.innerWidth - 0.5) * 8;
              const y = (event.clientY / window.innerHeight - 0.5) * -7;
              if (stage) {
                stage.style.setProperty("--tilt-x", x.toFixed(2) + "deg");
                stage.style.setProperty("--tilt-y", y.toFixed(2) + "deg");
              }
              frame = 0;
            });
          }, { passive: true });

          document.querySelectorAll(".interactive-glow").forEach((node) => {
            node.addEventListener("pointermove", (event) => {
              const rect = node.getBoundingClientRect();
              node.style.setProperty("--mx", (((event.clientX - rect.left) / rect.width) * 100).toFixed(1) + "%");
              node.style.setProperty("--my", (((event.clientY - rect.top) / rect.height) * 100).toFixed(1) + "%");
            }, { passive: true });
          });
        }
      })();
    
