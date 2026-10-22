/** Keep decoded pixels alive during the cache's bounded return window. */
export function decodeCoverImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
      if (error) {
        image.removeAttribute("src");
        reject(error);
      } else resolve(image);
    };
    const abort = () => finish(new Error("Cover retired"));
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        finish(new Error("Invalid cover dimensions"));
        return;
      }
      // Engines without decode use successful load with valid dimensions.
      if (typeof image.decode !== "function") finish();
      else
        void image.decode().then(
          () => finish(),
          () => finish(new Error("Cover decode failed")),
        );
    };
    image.onerror = () => finish(new Error("Cover load failed"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else image.src = url;
  });
}
