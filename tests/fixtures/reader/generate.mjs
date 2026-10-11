import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildReaderFixture, readerFixtures } from "./readerFixtures.ts";
import { validateReaderFixture } from "./validateReaderFixture.ts";
import { DOMParser } from "@xmldom/xmldom";

const output = new URL("../../../.scratch/reader-fixtures/", import.meta.url);
await fs.mkdir(output, { recursive: true });
for (const fixture of readerFixtures) {
  const bytes = await buildReaderFixture(fixture.id);
  await validateReaderFixture(bytes, fixture.sections.length, (text) =>
    new DOMParser({
      onError(_level, message) {
        throw new Error(message);
      },
    }).parseFromString(text, "application/xml"),
  );
  await fs.writeFile(new URL(`${fixture.id}.epub`, output), bytes);
  console.log(`${fixture.id}.epub: ${bytes.byteLength} bytes`);
}
console.log(`Generated synthetic EPUBs in ${fileURLToPath(output)}`);
