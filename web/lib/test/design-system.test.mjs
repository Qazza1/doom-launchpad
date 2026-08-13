import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/// The design system lives in the website repository, the parent directory here, which is not
/// checked out in CI. These run locally and skip elsewhere.

const directory = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(directory, "../../../..");
const cssPath = resolve(siteRoot, "assets/doomstreak.css");
const present = existsSync(cssPath);
const skip = present ? false : "the website repository is not checked out here";

const familiesIn = css =>
  [...css.matchAll(/--font-[a-z]+:\s*"([^"]+)"/g)].map(match => match[1]);

/// The bug that made the old site look wrong, as a test. It declared Bangers, Cinzel, Inter,
/// JetBrains Mono, Nunito and Syne, and loaded two of them. Everything styled with the other four
/// silently fell back to Times New Roman. A font you did not load is a font you did not choose.
test("every font the stylesheet declares is actually loaded", { skip }, async () => {
  const css = await readFile(cssPath, "utf8");
  const declared = familiesIn(css);
  // Two families, matching the live site: Bangers to shout, Nunito to read. The count is not the
  // invariant — "every family declared is a family loaded" is.
  assert.ok(declared.length >= 2, "expected at least a display and a body family");

  // The stylesheet documents the exact <link> pages must use; the families must all appear in it.
  const linkLine = css.match(/fonts\.googleapis\.com\/css2\?[^"'\s]+/)?.[0];
  assert.ok(linkLine, "the stylesheet must document the font link pages need");
  for (const family of declared) {
    assert.ok(
      linkLine.includes(family.replaceAll(" ", "+")),
      `${family} is declared but never loaded`,
    );
  }
});

test("every page using the system loads every font it declares", { skip }, async () => {
  const css = await readFile(cssPath, "utf8");
  const declared = familiesIn(css);
  const pages = [];
  const walk = async folder => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".html")) pages.push(path);
    }
  };
  await walk(resolve(siteRoot, "assets"));

  assert.ok(pages.length > 0, "expected at least the style guide");
  for (const path of pages) {
    const html = await readFile(path, "utf8");
    assert.match(html, /doomstreak\.css/, `${path} must use the design system`);
    for (const family of declared) {
      assert.ok(
        html.includes(family.replaceAll(" ", "+")),
        `${path} does not load ${family}`,
      );
    }
  }
});

/// Colours carry fixed meanings. A page inventing its own hex value is a page whose colours stop
/// meaning anything.
test("the palette has one definition and fixed meanings", { skip }, async () => {
  const css = await readFile(cssPath, "utf8");
  for (const token of ["--cyan", "--lime", "--yellow", "--pink"]) {
    const definitions = [...css.matchAll(new RegExp(`${token}:`, "g"))].length;
    assert.equal(definitions, 1, `${token} must be defined exactly once`);
  }
  assert.match(css, /good, alive, done|GOOD/i);
});

test("the style guide demonstrates each component the system defines", { skip }, async () => {
  const [css, guide] = await Promise.all([
    readFile(cssPath, "utf8"),
    readFile(resolve(siteRoot, "assets/style-guide.html"), "utf8"),
  ]);
  const classes = new Set(
    [...css.matchAll(/^\.([a-z][a-z-]*)/gm)].map(match => match[1]),
  );
  const missing = [...classes].filter(name => !guide.includes(name));
  assert.deepEqual(missing, [], "every component class needs an example to review");
});
