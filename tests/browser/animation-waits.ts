/** Installed in the page so waits share browser clocks and always release their resources. */
export function installAnimationWaits() {
  const describe = (nodes: Element[]) =>
    nodes.flatMap((node) => {
      const animations = node.getAnimations({ subtree: true });
      return animations.length
        ? animations.map((animation) => {
            const target =
              animation.effect instanceof KeyframeEffect ? animation.effect.target : node;
            return {
              target: target instanceof Element ? target.className || target.tagName : node.tagName,
              property:
                animation instanceof CSSTransition
                  ? animation.transitionProperty
                  : animation instanceof CSSAnimation
                    ? animation.animationName
                    : JSON.stringify(
                        animation.effect instanceof KeyframeEffect
                          ? animation.effect.getKeyframes()
                          : [],
                      ),
              state: animation.playState,
              pending: animation.pending,
            };
          })
        : [
            {
              target: node.className || node.tagName,
              property: "none",
              state: "idle" as const,
              pending: false,
            },
          ];
    });
  window.animationWaits = {
    describe,
    acquire: (node: Element, timeout = 2000) =>
      new Promise<Animation>((resolve, reject) => {
        let raf = 0;
        const cleanup = () => {
          clearTimeout(timer);
          cancelAnimationFrame(raf);
          window.removeEventListener("pagehide", cancel);
        };
        const cancel = () => {
          cleanup();
          reject(new Error("Animation acquisition cancelled"));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Animation acquisition timed out: ${JSON.stringify(describe([node]))}`));
        }, timeout);
        const tick = () => {
          const animation = node.getAnimations()[0];
          if (animation) {
            cleanup();
            resolve(animation);
          } else raf = requestAnimationFrame(tick);
        };
        window.addEventListener("pagehide", cancel, { once: true });
        tick();
      }),
    finish: async (nodes: Element[], timeout = 3000) => {
      const animations = nodes
        .flatMap((node) => node.getAnimations({ subtree: true }))
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(animations.map((animation) => animation.finished)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(`Animation completion timed out: ${JSON.stringify(describe(nodes))}`),
                ),
              timeout,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

declare global {
  interface Window {
    animationWaits: {
      describe: (
        nodes: Element[],
      ) => { target: string; property: string; state: AnimationPlayState; pending: boolean }[];
      acquire: (node: Element, timeout?: number) => Promise<Animation>;
      finish: (nodes: Element[], timeout?: number) => Promise<void>;
    };
  }
}
