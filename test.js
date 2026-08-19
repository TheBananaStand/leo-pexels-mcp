// The mapping is the part that fails quietly: a wrong field name produces
// well-formed photos with empty attribution, or drops every row, and the first
// anyone notices is a blank wallpaper set.
process.env.LEO_MCP_NO_SERVE = "1";
const { toPhoto } = await import("./index.js");
const assert = await import("node:assert/strict");

assert.deepEqual(
  toPhoto({ id: 123, src: { original: "https://x/1.jpg" }, alt: "A lake", photographer: "Ansel" }),
  { source_id: "123", download_url: "https://x/1.jpg", description: "A lake", photographer: "Ansel" },
);

// Pexels ids are numbers; the hub de-duplicates on a string, so a number here
// would compare unequal to its own text form.
assert.equal(typeof toPhoto({ id: 7, src: { original: "https://x/7.jpg" } }).source_id, "string");

// Missing optionals become the same fallbacks the compiled provider used —
// empty labels in the gallery are worse than honest ones.
const bare = toPhoto({ id: 1, src: { original: "https://x/1.jpg" } });
assert.equal(bare.description, "Wallpaper");
assert.equal(bare.photographer, "Unknown");

// No usable URL: dropped rather than carried into a fetch that fails later.
for (const junk of [{}, { id: 1 }, { id: 1, src: {} }, { id: 1, src: { original: "" } }, null]) {
  assert.equal(toPhoto(junk), null);
}
console.log("ok — pexels mapping holds");
