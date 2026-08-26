import { describe, expect, it } from "vitest";

import {
  applyH5InputProfile,
  h5ObjectPath,
  h5HtmlSecurityHeaders,
  h5PublicUrl,
  h5StorageObjectPath,
  injectH5Runtime,
  injectHeadSnippet,
  isHtmlObjectPath,
} from "../src/features/courseware-doc/h5-shim";
import {
  H5_INPUT_PROFILE_SCHEMA,
  H5_INPUT_PROVIDER_SCHEMA,
  H5_INPUT_PROVIDER_VERSION,
  parseH5InputProfile,
} from "../src/features/courseware-doc/h5-input-profile";
import { H5_POINTER_RUNTIME_VERSION } from "../src/features/courseware-doc/h5-pointer-protocol";

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

  it("injects opaque-origin storage and nested media bridges before package scripts", () => {
    const html = injectH5Runtime('<html><head><script src="legacy.js"></script></head></html>');
    expect(html.indexOf("data-mathin-h5-runtime")).toBeLessThan(html.indexOf("legacy.js"));
    expect(html).toContain('Object.defineProperty(window, name');
    expect(html).toContain('frame.contentWindow?.postMessage(data');
    expect(html).toContain('source: "mathin-h5-media"');
  });

  it("strips source claims and injects only a registry-authoritative input profile", () => {
    const source = '<html data-classroom-input-provider="forged" data-classroom-renderer-version="99" data-classroom-input-default="ink"><head></head></html>';
    expect(applyH5InputProfile(source)).toBe("<html><head></head></html>");
    const profile = parseH5InputProfile({
      profile_schema: H5_INPUT_PROFILE_SCHEMA,
      provider_schema: H5_INPUT_PROVIDER_SCHEMA,
      provider_version: H5_INPUT_PROVIDER_VERSION,
      default_capability: "drag",
    });
    expect(profile).not.toBeNull();
    expect(applyH5InputProfile(source, profile)).toContain(
      'data-classroom-input-provider="mathin-classroom-input" data-classroom-renderer-version="1" data-classroom-input-default="drag"',
    );
    expect(applyH5InputProfile(source, profile)).not.toContain("forged");
    expect(parseH5InputProfile({
      profile_schema: H5_INPUT_PROFILE_SCHEMA,
      provider_schema: H5_INPUT_PROVIDER_SCHEMA,
      provider_version: 2,
      default_capability: "ink",
    })).toBeNull();
  });

  it("keeps entry pages same-origin-only while allowing sandboxed nested HTML", () => {
    expect(h5HtmlSecurityHeaders(`https://mathin.example/api/cw-h5/packages/${HASH}/index.html?mathin_h5_runtime=${H5_POINTER_RUNTIME_VERSION}`))
      .toEqual({
        "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-pointer-lock allow-modals",
        "X-Frame-Options": "SAMEORIGIN",
      });
    expect(h5HtmlSecurityHeaders(`https://mathin.example/api/cw-h5/packages/${HASH}/interactive/game.html`))
      .toEqual({
        "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-pointer-lock allow-modals",
      });
  });
});
