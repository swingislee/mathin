import sanitizeHtml from "sanitize-html";

const NOTEBOOK_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "figure", "figcaption", "picture", "source"],
  allowedAttributes: {
    "*": ["class", "data-*"],
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    source: ["src", "srcset", "type"],
  },
  allowedSchemes: ["http", "https"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener noreferrer" }, true),
  },
};

/**
 * Server Actions sanitize before persistence, and public rendering sanitizes again.
 * The second pass is intentional because authenticated users can call exposed RPCs
 * without going through the application action.
 */
export function sanitizeNotebookHtml(value: string) {
  return sanitizeHtml(value, NOTEBOOK_HTML_OPTIONS);
}
