import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { RdashDocument } from "@revealbi/dom";
import { assertBoundFieldsExist } from "./guard.js";

/** True when the calling module was run directly (tsx file.ts), not imported. */
export const isMain = (moduleUrl: string): boolean =>
  !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === moduleUrl;

/** Validates bound fields, then writes the document as a .rdash file. */
export async function saveRdash(doc: RdashDocument, path: string): Promise<void> {
  assertBoundFieldsExist(doc.toJson());
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await doc.toBlob().arrayBuffer()));
}

export async function loadRdash(path: string): Promise<RdashDocument> {
  return RdashDocument.loadFromBuffer(await readFile(path));
}

/**
 * Reads the raw Dashboard.json without the DOM. Works for every .rdash, including ones
 * the DOM cannot load, so use it for inspection and for diffing a round trip.
 */
export async function readRdashJson(path: string): Promise<Record<string, any>> {
  const entries = unzipSync(new Uint8Array(await readFile(path)));
  const name = Object.keys(entries).find(n => n.toLowerCase().endsWith(".json"));
  if (!name) throw new Error(`${path} contains no JSON entry; is it a .rdash file?`);
  return JSON.parse(strFromU8(entries[name]).replace(/^﻿/, ""));
}
