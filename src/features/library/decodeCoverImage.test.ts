// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeCoverImage } from "./decodeCoverImage";

describe("decodeCoverImage", () => {
  let image: HTMLImageElement;
  beforeEach(() => {
    image = document.createElement("img");
    Object.defineProperties(image, {
      naturalWidth: { value: 120, configurable: true },
      naturalHeight: { value: 180 },
    });
    vi.stubGlobal(
      "Image",
      class {
        constructor() {
          return image;
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("waits for load and decode, not just a URL", async () => {
    let finish!: () => void;
    image.decode = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const ready = vi.fn();
    const promise = decodeCoverImage("blob:cover", new AbortController().signal).then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    image.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    finish();
    await promise;
    expect(ready).toHaveBeenCalledWith(image);
  });

  it("uses valid load on engines without decode", async () => {
    Object.defineProperty(image, "decode", { value: undefined });
    const promise = decodeCoverImage("blob:cover", new AbortController().signal);
    image.dispatchEvent(new Event("load"));
    expect(await promise).toBe(image);
  });

  it("ignores late success after retirement during decode", async () => {
    let finish!: () => void;
    image.decode = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const controller = new AbortController();
    const ready = vi.fn();
    const promise = decodeCoverImage("blob:cover", controller.signal);
    image.dispatchEvent(new Event("load"));
    controller.abort();
    await expect(promise).rejects.toThrow("Cover retired");
    void promise.then(ready, () => undefined);
    finish();
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    expect(image.getAttribute("src")).toBeNull();
  });

  it.each(["error", "dimensions", "decode", "abort", "already-aborted"])(
    "rejects %s and releases listeners and source",
    async (failure) => {
      const controller = new AbortController();
      if (failure === "already-aborted") controller.abort();
      image.decode = vi.fn().mockRejectedValue(new Error("bad pixels"));
      if (failure === "dimensions") Object.defineProperty(image, "naturalWidth", { value: 0 });
      const promise = decodeCoverImage("blob:cover", controller.signal);
      const rejected = expect(promise).rejects.toThrow();
      if (failure === "abort") controller.abort();
      else if (failure !== "already-aborted")
        image.dispatchEvent(new Event(failure === "error" ? "error" : "load"));
      await rejected;
      expect(image.getAttribute("src")).toBeNull();
      expect(image.onload).toBeNull();
      expect(image.onerror).toBeNull();
    },
  );
});
