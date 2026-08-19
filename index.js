#!/usr/bin/env node
//
// Leo wallpaper provider, over MCP — Pexels.
//
// Leo's wallpaper generator doesn't fetch anything itself: it resolves a
// WallpaperProvider and asks that. This server is one, reachable as a package
// the hub installs at runtime rather than one it is rebuilt for.
//
// The contract it answers is `wallpaper` in leo_mcp::providers:
//
//   search_photos({ queries, orientation })
//     -> { photos: [{ source_id, download_url, description, photographer }] }
//
// One photo per query, which is what the compiled package did: the caller
// passes a list of phrases and expects a set, not a page of results for the
// first phrase.
//
// Plain JavaScript on purpose — this ships as a commit-pinned git tarball, and
// npm does not reliably run build steps for a tarball URL.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PEXELS_SEARCH = "https://api.pexels.com/v1/search";

// Leo hands an entitled setting to the subprocess under its settings key,
// verbatim and lower-case. This must match the descriptor's `settings_read`
// or the credential silently never arrives.
const SETTING_KEY = "pexels_api_key";

/** Map one Pexels photo onto the role's shape. `null` when it can't be used. */
export function toPhoto(photo) {
  const download_url = photo?.src?.original;
  // The one field with no sensible fallback. A URL-less entry becomes a failed
  // fetch much later, where it reads as a network fault rather than bad data.
  if (typeof download_url !== "string" || download_url === "") return null;
  return {
    // Pexels ids are numbers; the role's field is a string, and the hub
    // de-duplicates on it — a number would compare unequal to its own text form.
    source_id: photo.id == null ? "" : String(photo.id),
    download_url,
    description: photo.alt || "Wallpaper",
    photographer: photo.photographer || "Unknown",
  };
}

async function searchOne(query, orientation, apiKey) {
  const url = new URL(PEXELS_SEARCH);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "1");
  url.searchParams.set("orientation", orientation || "landscape");

  const response = await fetch(url, { headers: { Authorization: apiKey } });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Pexels API returned ${response.status}: ${detail.slice(0, 200)}`,
    );
  }
  const payload = await response.json();
  const first = Array.isArray(payload?.photos) ? payload.photos[0] : null;
  return first ? toPhoto(first) : null;
}

async function searchPhotos({ queries, orientation }) {
  const apiKey = process.env[SETTING_KEY] ?? "";
  if (!apiKey) {
    throw new Error(
      `No ${SETTING_KEY} configured. Add it in Settings → Packages → Pexels.`,
    );
  }
  const list = Array.isArray(queries) ? queries.filter((q) => typeof q === "string" && q.trim()) : [];
  if (list.length === 0) throw new Error("search_photos requires a non-empty `queries` array.");

  // Sequential, matching the compiled package: these are one-result lookups
  // against a rate-limited API, and a burst of parallel requests is how a
  // wallpaper refresh turns into a 429 for every query at once.
  const photos = [];
  for (const query of list) {
    const photo = await searchOne(query, orientation, apiKey);
    if (photo) photos.push(photo);
  }
  return { photos };
}

const server = new Server(
  { name: "leo-pexels-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_photos",
      description:
        "Find one Pexels photo per query phrase, for use as a wallpaper.",
      inputSchema: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: { type: "string" },
            description: "Phrases to search for — one photo is returned per phrase.",
          },
          orientation: {
            type: "string",
            description: "landscape | portrait | square",
          },
        },
        required: ["queries"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== "search_photos") {
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  }
  try {
    return {
      content: [{ type: "text", text: JSON.stringify(await searchPhotos(args ?? {})) }],
    };
  } catch (error) {
    // `isError` is what lets the hub tell "no photos matched" from "the search
    // never ran" — an empty list for the second would read as the first.
    return {
      isError: true,
      content: [{ type: "text", text: String(error?.message ?? error) }],
    };
  }
});

if (process.env.LEO_MCP_NO_SERVE !== "1") {
  await server.connect(new StdioServerTransport());
}
