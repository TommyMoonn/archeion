import { expect, test, type Page } from "@playwright/test";
import { installCoverReadinessProbe } from "./fixtures/cover-readiness-probe";

async function visibleReady(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const host = document.querySelector(".page-shell")!.getBoundingClientRect();
          return [...document.querySelectorAll<HTMLElement>(".book-cover")].filter((cover) => {
            const rect = cover.getBoundingClientRect();
            return (
              rect.bottom > host.top &&
              rect.top < host.bottom &&
              cover.dataset.coverState !== "available"
            );
          }).length;
        }),
      { timeout: 1260, intervals: [16] },
    )
    .toBe(0);
}

test.afterEach(async ({ page }, info) => {
  if (page.isClosed()) return;
  const report = await page.evaluate(() => window.coverReadinessProbe?.snapshot());
  if (report)
    await info.attach("all-cover-readiness", {
      body: JSON.stringify(report),
      contentType: "application/json",
    });
});

for (const view of ["grid", "list"] as const)
  for (const count of [50, 500, 3000]) {
    for (const workload of ["normal", "delayed"] as const) {
      test(`${view} ${count} ${workload} covers are ready at wheel-driven entry including reversal`, async ({
        page,
      }, info) => {
        const delay = workload === "delayed";
        await page.addInitScript(installCoverReadinessProbe, {
          fileDelay: delay ? 160 : 0,
          decodeDelay: delay ? 80 : 0,
        });
        await page.goto(
          `/tests/browser/fixtures/ui-stability.html?count=${count}&motion=off&covers=artwork&view=${view}&theme=${view === "grid" ? "dark" : "light"}`,
        );
        await expect(page.locator(`.book-${view}`)).toBeVisible();
        await visibleReady(page);
        // Establish the mounted horizon before testing continuous travel; cold entry is retained in metrics.
        await expect
          .poll(
            () =>
              page.evaluate(
                () =>
                  window.coverReadinessProbe.snapshot().activeFiles +
                  window.coverReadinessProbe.snapshot().activeDecodes,
              ),
            { timeout: 1260, intervals: [16] },
          )
          .toBe(0);
        const host = await page.locator(".page-shell").boundingBox();
        await page.mouse.move(host!.x + host!.width / 2, host!.y + host!.height / 2);
        for (const pass of ["continuous-cold", "continuous-warm"]) {
          await page.evaluate((pass) => window.coverReadinessProbe.phase(pass), pass);
          for (const direction of [1, -1]) {
            if (delay && pass === "continuous-cold" && direction === -1) {
              await expect
                .poll(
                  () => page.evaluate(() => window.coverReadinessProbe.snapshot().activeDecodes),
                  { timeout: 1260, intervals: [16] },
                )
                .toBeGreaterThan(0);
              const pending = await page.evaluate(() => window.coverReadinessProbe.snapshot());
              await info.attach("decode-pending-reversal", {
                body: JSON.stringify({
                  time: pending.time,
                  activeFiles: pending.activeFiles,
                  activeDecodes: pending.activeDecodes,
                }),
                contentType: "application/json",
              });
            }
            for (let step = 0; step < 18; step++) {
              await page.mouse.wheel(0, direction * (delay ? 60 : 120));
              await page.waitForTimeout(delay ? 120 : 100);
            }
          }
          const report = await page.evaluate(() => window.coverReadinessProbe.snapshot());
          const entries = report.entries.filter((entry) => entry.phase === pass);
          const notReady = entries.filter((entry) => !entry.readyAtEntry);
          await info.attach(pass, {
            body: JSON.stringify({
              entries,
              frames: report.frames.filter((frame) => frame.phase === pass),
              files: report.files,
              decodes: report.decodes,
            }),
            contentType: "application/json",
          });
          expect(entries.length).toBeGreaterThan(10);
          expect(
            notReady.map((entry) => ({
              id: entry.id,
              lead: entry.entered - (entry.horizon ?? entry.mounted),
              visibleLoading: Math.max(
                0,
                (entry.ready ?? entry.exited ?? report.time) - entry.entered,
              ),
            })),
          ).toEqual([]);
        }
        const report = await page.evaluate(() => window.coverReadinessProbe.snapshot());
        expect(report.peakFiles).toBeLessThanOrEqual(4);
        expect(report.peakDecodes).toBeLessThanOrEqual(4);
        expect(report.liveUrls).toBeLessThanOrEqual(48 + report.frames.at(-1)!.mounted);
        await page.screenshot({ path: info.outputPath("populated-artwork.png") });
      });
    }
  }

test("abrupt jumps beyond the horizon report transient loading without relaxing readiness", async ({
  page,
}, info) => {
  await page.addInitScript(installCoverReadinessProbe, { fileDelay: 160, decodeDelay: 80 });
  await page.goto("/tests/browser/fixtures/ui-stability.html?count=3000&motion=off");
  await expect(page.locator(".book-grid")).toBeVisible();
  await visibleReady(page);
  const host = await page.locator(".page-shell").boundingBox();
  await page.mouse.move(host!.x + 100, host!.y + 100);
  await page.evaluate(() => window.coverReadinessProbe.phase("abrupt-jump"));
  await page.mouse.wheel(0, 30000);
  await page.waitForTimeout(100);
  await page.mouse.wheel(0, -12000);
  await page.waitForTimeout(100);
  await visibleReady(page);
  const report = await page.evaluate(() => window.coverReadinessProbe.snapshot());
  expect(report.entries.some((entry) => entry.phase === "abrupt-jump" && !entry.readyAtEntry)).toBe(
    true,
  );
  await info.attach("jump-limit", {
    body: JSON.stringify(report),
    contentType: "application/json",
  });
});
