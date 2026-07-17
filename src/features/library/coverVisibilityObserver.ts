type VisibilityCallback = () => void;

let observer: IntersectionObserver | null = null;
const callbacks = new Map<Element, VisibilityCallback>();

export function observeCoverVisibility(
  element: Element,
  onVisible: VisibilityCallback,
): () => void {
  callbacks.set(element, onVisible);
  getObserver().observe(element);

  return () => {
    callbacks.delete(element);
    observer?.unobserve(element);
    if (callbacks.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

function getObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        callbacks.delete(entry.target);
        observer?.unobserve(entry.target);
        callback?.();
      }
      if (callbacks.size === 0) {
        observer?.disconnect();
        observer = null;
      }
    },
    { rootMargin: "240px" },
  );
  return observer;
}
