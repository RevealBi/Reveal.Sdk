import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { RdashDocument } from "@revealbi/dom";
import { assertBoundFieldsExist } from "./guard.js";

/** True when the calling module was run directly (tsx file.ts), not imported. */
export const isMain = (moduleUrl: string): boolean =>
  !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === moduleUrl;

/**
 * Validates bindings, then writes the document as a .rdash file. When you edit a loaded dashboard,
 * pass its original JSON (readRdashJson) as `original`, so problems it already had don't block the save.
 */
export async function saveRdash(doc: RdashDocument, path: string, original?: object): Promise<void> {
  // Serialize once: @revealbi/dom 0.3.0 adds another copy of a new document's data sources on
  // every toJson()/toJsonString()/toBlob(), so check the bytes that will be written.
  const bytes = new Uint8Array(await doc.toBlob().arrayBuffer());
  assertBoundFieldsExist(dashboardJsonFromZip(bytes, path), original);
  await mkdir(dirname(path), { recursive: true });
  // Write next to the target, then move over it: a failed write never leaves half a dashboard.
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

export async function loadRdash(path: string): Promise<RdashDocument> {
  return RdashDocument.loadFromBuffer(await readFile(path));
}

/**
 * Reads the raw Dashboard.json without the DOM. Works for every .rdash, including ones
 * the DOM cannot load, so use it for inspection and for diffing a round trip.
 */
export async function readRdashJson(path: string): Promise<Record<string, any>> {
  return dashboardJsonFromZip(new Uint8Array(await readFile(path)), path);
}

function dashboardJsonFromZip(bytes: Uint8Array, path: string): Record<string, any> {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); }
  catch { throw new Error(`${path} is not a .rdash (not a zip file). An .rplus is the older XML format, which neither DOM reads.`); }
  const name = Object.keys(entries).find(n => n.toLowerCase().endsWith(".json"));
  if (!name) throw new Error(`${path} is not a .rdash: it has no Dashboard.json. An .rplus is the older XML format, which neither DOM reads.`);
  return parseTolerant(strFromU8(entries[name]).replace(/^﻿/, ""));
}

/** JSON.parse that also accepts trailing commas, which Reveal and Reveal.Sdk.Dom read and some editor files have. */
export function parseTolerant(text: string): Record<string, any> {
  try { return JSON.parse(text); }
  catch (e) {
    // Drop a comma before } or ], outside strings only.
    let out = "", inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        out += c;
        if (c === "\\") out += text[++i] ?? "";
        else if (c === '"') inString = false;
      } else if (c === '"') { inString = true; out += c; }
      else if (c === "," && /^\s*[}\]]/.test(text.slice(i + 1, i + 200))) continue;
      else out += c;
    }
    try { return JSON.parse(out); } catch { throw e; }
  }
}
