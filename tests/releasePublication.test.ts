import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { detectReleaseCandidate, readRelease } from "../scripts/detect-release-candidate.mjs";
import { publishReleaseCandidate } from "../scripts/publish-release.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commit = "a".repeat(40);
const otherCommit = "b".repeat(40);
const tag = "v1.5.5";
const body = "## Changes\n\n- Fixture release.\n";
const assetNames = ["Archeion-Setup-x64.exe", "Archeion-x64.msi", "SHA256SUMS.txt"];
const temporaryRoots: string[] = [];
const hasPowerShell =
  spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
    encoding: "utf8",
    windowsHide: true,
  }).status === 0;

function digest(bytes: Buffer) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixture(
  options: {
    tagSha?: string;
    published?: boolean;
    draft?: boolean;
    uploadFails?: boolean;
    listingError?: string;
    listingPages?: unknown;
    concurrentDraft?: boolean;
    afterUpload?: Record<string, unknown>;
    idReadError?: string;
    pendingLookup?: unknown;
    pendingError?: string;
    pendingResponse?: unknown;
    restPlaceholder?: boolean;
  } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-release-publication-"));
  temporaryRoots.push(root);
  const artifactsDirectory = path.join(root, "artifacts");
  fs.mkdirSync(artifactsDirectory);
  fs.mkdirSync(path.join(root, "release-notes"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.5.5" }));
  fs.writeFileSync(
    path.join(root, "release-notes", "v1.5.5.md"),
    `<!-- release-note: v1.5.5; date: 2026-09-27 -->\n\n${body}`,
  );
  const exe = Buffer.from("fixture NSIS installer");
  const msi = Buffer.from("fixture MSI installer");
  fs.writeFileSync(path.join(artifactsDirectory, assetNames[0]), exe);
  fs.writeFileSync(path.join(artifactsDirectory, assetNames[1]), msi);
  fs.writeFileSync(
    path.join(artifactsDirectory, assetNames[2]),
    `${digest(exe).slice(7)}  ${assetNames[0]}\n${digest(msi).slice(7)}  ${assetNames[1]}\n`,
  );

  let tagSha = options.tagSha ?? null;
  let release: Record<string, unknown> | null =
    options.draft || options.published
      ? { id: 123, tag_name: tag, name: tag, body, draft: !options.published, assets: [] }
      : null;
  const mutations: string[] = [];
  const reads: string[] = [];
  const result = (status: number, stdout = "", stderr = "") => ({ status, stdout, stderr });
  const assetMetadata = () =>
    assetNames.map((name) => {
      const bytes = fs.readFileSync(path.join(artifactsDirectory, name));
      return { name, size: bytes.length, digest: digest(bytes), state: "uploaded" };
    });
  if (options.published && release) release.assets = assetMetadata();

  const run = (command: string, args: string[], _cwd: string, input?: string) => {
    if (command === "git" && args[0] === "rev-parse") return result(0, `${commit}\n`);
    if (command === "git" && args[0] === "show") {
      return result(0, JSON.stringify({ version: "1.5.4" }));
    }
    if (command === "git" && args[0] === "ls-remote") {
      return result(0, tagSha ? `${tagSha}\trefs/tags/${tag}\n` : "");
    }
    if (command === "pwsh") {
      if (args.some((arg) => arg.endsWith("verify-windows-release.ps1"))) {
        const verified = spawnSync(command, args, {
          cwd: projectRoot,
          encoding: "utf8",
          windowsHide: true,
        });
        return result(verified.status ?? 1, verified.stdout, verified.stderr);
      }
      return result(0);
    }
    if (command === "gh" && args[0] === "api") {
      const method = args[1] === "-X" ? args[2] : "GET";
      const endpoint = args.find((arg) => arg.startsWith("repos/") || arg === "graphql") ?? "";
      if (endpoint === "graphql") {
        reads.push(endpoint);
        const payload = JSON.parse(input ?? "{}");
        expect(payload.variables).toEqual({ owner: "TommyMoonn", name: "archeion", tag });
        if (options.pendingError) return result(1, "", options.pendingError);
        const pending =
          options.pendingLookup !== undefined
            ? options.pendingLookup
            : release && release.tag_name === tag
              ? { databaseId: release.id, isDraft: release.draft }
              : null;
        return result(
          0,
          JSON.stringify(options.pendingResponse ?? { data: { repository: { release: pending } } }),
        );
      }
      if (method === "GET" && endpoint.endsWith(`/releases/tags/${tag}`)) {
        reads.push(endpoint);
        // GitHub's tag endpoint returns published releases, not drafts.
        return release && !release.draft && release.tag_name === tag
          ? result(0, JSON.stringify(release))
          : result(1, "", "gh: Not Found (HTTP 404)");
      }
      if (method === "GET" && endpoint.endsWith("/releases?per_page=100")) {
        reads.push(endpoint);
        expect(args).toContain("--paginate");
        expect(args).toContain("--slurp");
        return options.listingError
          ? result(1, "", options.listingError)
          : result(0, JSON.stringify(options.listingPages ?? [release ? [release] : []]));
      }
      if (method === "GET" && endpoint.endsWith("/releases/123")) {
        reads.push(endpoint);
        if (options.idReadError) return result(1, "", options.idReadError);
        return release
          ? result(
              0,
              JSON.stringify(
                options.restPlaceholder && release.draft
                  ? { ...release, tag_name: "untagged-abcdef" }
                  : release,
              ),
            )
          : result(1, "", "gh: Not Found (HTTP 404)");
      }
      const payload = JSON.parse(input ?? "{}");
      mutations.push(`${method} ${endpoint}`);
      if (method === "POST" && endpoint.endsWith("/git/refs")) {
        if (tagSha) return result(1, "", "gh: Validation Failed (HTTP 422)");
        tagSha = payload.sha;
        return result(0, JSON.stringify({ ref: payload.ref, object: { sha: tagSha } }));
      }
      if (method === "POST" && endpoint.endsWith("/releases")) {
        release = {
          id: 123,
          tag_name: tag,
          name: payload.name,
          body: payload.body,
          draft: true,
          assets: [],
        };
        if (options.concurrentDraft) return result(1, "", "gh: Validation Failed (HTTP 422)");
        return result(0, JSON.stringify(release));
      }
      if (method === "PATCH" && endpoint.endsWith("/releases/123") && release) {
        expect(payload.tag_name).toBe(tag);
        release = { ...release, ...payload };
        return result(0, JSON.stringify(release));
      }
    }
    if (command === "gh" && args[0] === "release" && args[1] === "upload" && release) {
      mutations.push("upload assets");
      if (options.uploadFails) return result(1, "", "fixture upload failure");
      const uploadedNames = new Set(
        args.slice(3, args.indexOf("--repo")).map((file) => path.basename(file)),
      );
      release.assets = [
        ...(release.assets as Array<Record<string, unknown>>),
        ...assetMetadata().filter((asset) => uploadedNames.has(asset.name)),
      ];
      release = { ...release, ...options.afterUpload };
      return result(0);
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };

  return {
    root,
    artifactsDirectory,
    mutations,
    reads,
    detect: () =>
      detectReleaseCandidate({
        projectRoot: root,
        commit,
        repository: "TommyMoonn/archeion",
        run,
      }),
    publish: () =>
      publishReleaseCandidate({
        projectRoot: root,
        commit,
        version: "1.5.5",
        repository: "TommyMoonn/archeion",
        artifactsDirectory,
        run,
      }),
    setRelease: (changes: Record<string, unknown>) => {
      if (release) release = { ...release, ...changes };
    },
    release: () => release,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { force: true, recursive: true });
});

describe("pending-tag release identity", () => {
  it("accepts a REST placeholder only for the selected draft ID", () => {
    const release = { id: 123, tag_name: "untagged-abcdef", draft: true };
    const response = { status: 0, stdout: JSON.stringify(release) };
    expect(readRelease(response, tag, { draftId: 123 })).toEqual(release);
    expect(() => readRelease(response, tag)).toThrow("Invalid release metadata");
    expect(() => readRelease(response, tag, { draftId: 456 })).toThrow("Invalid release metadata");
  });

  it.each([
    { id: 123, tag_name: "untagged-abcdef", draft: false },
    { id: 123, tag_name: "v9.9.9", draft: true },
    { id: 123, tag_name: "untagged-invalid", draft: true },
  ])("rejects a published placeholder or conflicting draft tag: %j", (release) => {
    expect(() =>
      readRelease({ status: 0, stdout: JSON.stringify(release) }, tag, { draftId: 123 }),
    ).toThrow("Invalid release metadata");
  });
});

(hasPowerShell ? describe : describe.skip)("release publication", () => {
  it("creates the exact-SHA tag only after verification, then publishes the tracked note and three assets", () => {
    const state = fixture({ restPlaceholder: true });
    expect(state.publish()).toEqual({ published: true, reused: false, tag, sha: commit });
    expect(state.mutations).toEqual([
      "POST repos/TommyMoonn/archeion/git/refs",
      "POST repos/TommyMoonn/archeion/releases",
      "PATCH repos/TommyMoonn/archeion/releases/123",
      "upload assets",
      "PATCH repos/TommyMoonn/archeion/releases/123",
    ]);
    expect(state.release()).toMatchObject({
      tag_name: tag,
      name: tag,
      body,
      draft: false,
      assets: assetNames.map((name) => ({ name, state: "uploaded" })),
    });
    expect(state.detect()).toEqual({ candidate: true, version: "1.5.5", sha: commit });
    expect(state.publish()).toEqual({ published: true, reused: true, tag, sha: commit });
    expect(state.mutations).toHaveLength(5);
    expect(state.reads.filter((endpoint) => endpoint.endsWith("/releases/123"))).toHaveLength(2);
  }, 30_000);

  it("resumes a same-SHA draft, but refuses a conflicting protected tag", () => {
    const draft = fixture({ tagSha: commit, draft: true });
    expect(draft.publish()).toEqual({ published: true, reused: false, tag, sha: commit });
    expect(draft.mutations[0]).toBe("PATCH repos/TommyMoonn/archeion/releases/123");

    const conflict = fixture({ tagSha: otherCommit });
    expect(() => conflict.publish()).toThrow(`Remote tag ${tag} points to ${otherCommit}`);
    expect(conflict.mutations).toEqual([]);
  }, 30_000);

  it("resumes a partially uploaded draft without replacing verified assets", () => {
    const state = fixture({ tagSha: commit, draft: true });
    const filename = assetNames[0];
    const bytes = fs.readFileSync(path.join(state.artifactsDirectory, filename));
    state.setRelease({
      assets: [{ name: filename, size: bytes.length, digest: digest(bytes), state: "uploaded" }],
    });
    expect(state.publish()).toEqual({ published: true, reused: false, tag, sha: commit });
    expect(state.mutations).not.toContain("POST repos/TommyMoonn/archeion/git/refs");
  }, 30_000);

  it("resumes a pending-tag draft whose REST representation has an untagged placeholder", () => {
    const state = fixture({ tagSha: commit, draft: true, restPlaceholder: true });
    expect(state.publish()).toMatchObject({ published: true, reused: false });
    expect(state.mutations).not.toContain("POST repos/TommyMoonn/archeion/releases");
  }, 30_000);

  it("detects an orphaned draft on later release-list pages without creating a duplicate", () => {
    const state = fixture({
      tagSha: commit,
      listingPages: [
        [{ id: 456, tag_name: "v1.5.4", draft: false }],
        [{ id: 123, name: tag, tag_name: "untagged-abcdef", draft: true }],
      ],
    });
    expect(() => state.publish()).toThrow("reviewed recovery");
    expect(state.mutations).toEqual([]);
  }, 30_000);

  it("resumes a concurrently created draft after a create conflict", () => {
    const state = fixture({ tagSha: commit, concurrentDraft: true });
    expect(state.publish()).toMatchObject({ published: true, reused: false });
  }, 30_000);

  it.each([
    ["forbidden listing", { listingError: "gh: Forbidden (HTTP 403)" }, "List releases"],
    ["malformed pages", { listingPages: [{}] }, "Invalid release list"],
    ["malformed entry", { listingPages: [[{}]] }, "Invalid release list"],
    [
      "duplicate tag",
      {
        listingPages: [
          [
            { id: 123, tag_name: tag, draft: true, assets: [] },
            { id: 456, tag_name: tag, draft: true, assets: [] },
          ],
        ],
      },
      "reviewed recovery",
    ],
    [
      "untagged draft",
      { listingPages: [[{ id: 123, tag_name: "untagged-fixture", name: tag, draft: true }]] },
      "reviewed recovery",
    ],
    [
      "invalid release ID",
      { pendingLookup: { databaseId: "123", isDraft: true } },
      "Invalid release identity",
    ],
    [
      "pending lookup error",
      { pendingError: "gh: Forbidden (HTTP 403)" },
      "Inspect pending release",
    ],
    ["malformed pending lookup", { pendingLookup: {} }, "Invalid release identity"],
    ["missing GraphQL data", { pendingResponse: {} }, "Invalid pending release lookup"],
    [
      "partial GraphQL error",
      {
        pendingResponse: {
          errors: [{ message: "fixture error" }],
          data: { repository: { release: { databaseId: 123, isDraft: true } } },
        },
      },
      "Invalid pending release lookup",
    ],
  ])(
    "fails closed before mutation for %s",
    (_description, options, message) => {
      const state = fixture({ tagSha: commit, ...options });
      expect(() => state.publish()).toThrow(message);
      expect(state.mutations).toEqual([]);
    },
    30_000,
  );

  it.each(["gh: Not Found (HTTP 404)", "gh: Forbidden (HTTP 403)"])(
    "refuses asset upload when the selected draft cannot be re-read: %s",
    (idReadError) => {
      const state = fixture({ tagSha: commit, draft: true, idReadError });
      expect(() => state.publish()).toThrow();
      expect(state.mutations).toEqual([]);
    },
    30_000,
  );

  it.each([
    [{ tag_name: "v9.9.9" }, "not a draft before publication"],
    [{ id: 456 }, "Invalid release identity"],
    [{ draft: false }, "not a draft before publication"],
  ])(
    "refuses changed release identity/state after upload: %j",
    (afterUpload, message) => {
      const state = fixture({ afterUpload });
      expect(() => state.publish()).toThrow(message);
      expect(state.mutations.at(-1)).toBe("upload assets");
    },
    30_000,
  );

  it("never tags when installer verification fails or an asset is missing", () => {
    const damaged = fixture();
    fs.appendFileSync(path.join(damaged.artifactsDirectory, assetNames[0]), "tampered");
    expect(() => damaged.publish()).toThrow("Release installer verification failed");
    expect(damaged.mutations).toEqual([]);

    const missing = fixture();
    fs.rmSync(path.join(missing.artifactsDirectory, assetNames[1]));
    expect(() => missing.publish()).toThrow("Release installer verification failed");
    expect(missing.mutations).toEqual([]);
  }, 30_000);

  it("leaves an incomplete draft unpublished when asset upload fails", () => {
    const state = fixture({ uploadFails: true });
    expect(() => state.publish()).toThrow("fixture upload failure");
    expect(state.release()).toMatchObject({ draft: true });
    expect(state.mutations.at(-1)).toBe("upload assets");
  }, 30_000);

  it.each(["title", "body", "asset set", "asset size", "asset digest"])(
    "routes a published release with conflicting %s to fail-closed verification",
    (conflict) => {
      const state = fixture({ tagSha: commit, published: true });
      const release = state.release();
      if (!release) throw new Error("Missing published release fixture.");
      const assets = release.assets as Array<Record<string, unknown>>;
      if (conflict === "title") state.setRelease({ name: "Wrong title" });
      else if (conflict === "body") state.setRelease({ body: "Wrong body" });
      else if (conflict === "asset set") state.setRelease({ assets: assets.slice(1) });
      else if (conflict === "asset size") {
        state.setRelease({
          assets: [{ ...assets[0], size: Number(assets[0].size) + 1 }, ...assets.slice(1)],
        });
      } else {
        state.setRelease({
          assets: [{ ...assets[0], digest: `sha256:${"0".repeat(64)}` }, ...assets.slice(1)],
        });
      }

      expect(state.detect()).toEqual({ candidate: true, version: "1.5.5", sha: commit });
      expect(() => state.publish()).toThrow(
        conflict === "asset set"
          ? "does not contain exactly the expected assets"
          : conflict === "title" || conflict === "body"
            ? "does not match the tracked release note"
            : "does not match the verified bundle",
      );
      expect(state.mutations).toEqual([]);
    },
    30_000,
  );
});
