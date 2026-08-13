import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildVaultIndex } from "../server/vault-index.mjs";

test("Wiki health status counts preserve explicit and unlabeled states", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-wiki-status-"));
  const wikiRoot = join(root, "wiki", "concepts");

  try {
    await mkdir(wikiRoot, { recursive: true });
    await Promise.all([
      writeFile(join(wikiRoot, "active.md"), "---\nstatus: active\n---\n# Active\n"),
      writeFile(join(wikiRoot, "review.md"), "---\nstatus: needs-review\n---\n# Review\n"),
      writeFile(join(wikiRoot, "deprecated.md"), "---\nstatus: deprecated\n---\n# Deprecated\n"),
      writeFile(join(wikiRoot, "missing.md"), "# Missing status\n"),
      writeFile(join(wikiRoot, "unknown.md"), "---\nstatus: draft\n---\n# Unknown status\n"),
    ]);

    const index = await buildVaultIndex(root);

    assert.equal(index.stats.formalWikiPages, 5);
    assert.deepEqual(index.wiki.countsByStatus, {
      active: 1,
      "needs-review": 1,
      deprecated: 1,
      unlabeled: 2,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

