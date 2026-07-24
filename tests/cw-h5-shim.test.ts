import { describe, expect, it } from "vitest";

import {
  h5ObjectPath,
  h5PublicUrl,
  h5StorageObjectPath,
  injectHeadSnippet,
  isHtmlObjectPath,
} from "../src/features/courseware-doc/h5-shim";

const HASH = "a".repeat(64);

describe("P6-4 H5 shim", () => {
  it("accepts only packages/<sha256>/<relative path>", () => {
    expect(h5ObjectPath(["packages", HASH, "index.html"])).toBe(`packages/${HASH}/index.html`);
    expect(h5ObjectPath(["packages", HASH, "js", "main.js"])).toBe(`packages/${HASH}/js/main.js`);

    expect(h5ObjectPath(["packages", HASH])).toBeNull();
    expect(h5ObjectPath(["objects", HASH, "index.html"])).toBeNull();
    expect(h5ObjectPath(["packages", "not-a-hash", "index.html"])).toBeNull();
    expect(h5ObjectPath(["packages", HASH.toUpperCase(), "index.html"])).toBeNull();
    expect(h5ObjectPath(["packages", HASH, "..", "secret"])).toBeNull();
    expect(h5ObjectPath(["packages", HASH, ""])).toBeNull();
    expect(h5ObjectPath(["packages", HASH, "a\\b.js"])).toBeNull();
  });

  it("routes only .html/.htm through the shim body", () => {
    expect(isHtmlObjectPath(`packages/${HASH}/index.html`)).toBe(true);
    expect(isHtmlObjectPath(`packages/${HASH}/INDEX.HTM`)).toBe(true);
    expect(isHtmlObjectPath(`packages/${HASH}/main.js`)).toBe(false);
    expect(isHtmlObjectPath(`packages/${HASH}/video.mp4`)).toBe(false);
    expect(isHtmlObjectPath(`packages/${HASH}/noext`)).toBe(false);
  });

  it("maps Unicode H5 filenames to ASCII Storage keys and addresses those keys", () => {
    expect(h5StorageObjectPath(`packages/${HASH}/img/主图 1.png`)).toBe(
      `packages/${HASH}/img/u__E4_B8_BB_E5_9B_BE_201.png`,
    );
    expect(h5PublicUrl("https://supabase.example/", `packages/${HASH}/img/主图 1.png`)).toBe(
      `https://supabase.example/storage/v1/object/public/cw-h5/packages/${HASH}/img/u__E4_B8_BB_E5_9B_BE_201.png`,
    );
  });

  it("injects snippets right after <head>", () => {
    expect(injectHeadSnippet('<html><head lang="zh"><title>t</title></head></html>', "<script>1</script>"))
      .toBe('<html><head lang="zh"><script>1</script><title>t</title></head></html>');
    expect(injectHeadSnippet("<div>no head</div>", "<script>1</script>"))
      .toBe("<script>1</script><div>no head</div>");
  });
});
