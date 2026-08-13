import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildVaultIndex } from "../server/vault-index.mjs";
import { graphPayload } from "../server/vite-plugin-workbench.mjs";

test("resolves Wiki sources and exposes reverse material references", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-source-links-"));
  try {
    await mkdir(join(root, "10_raw", "articles"), { recursive: true });
    await mkdir(join(root, "wiki", "concepts"), { recursive: true });
    await Promise.all([
      writeFile(join(root, "10_raw", "articles", "source.md"), "# Source\n\nEvidence."),
      writeFile(join(root, "10_raw", "articles", "unused.md"), "# Unused\n"),
      writeFile(
        join(root, "wiki", "concepts", "knowledge.md"),
        "---\ntype: concept\nsources:\n  - 10_raw/articles/source.md\n---\n# Knowledge\n\n[[10_raw/articles/source.md]]\n",
      ),
    ]);

    const index = await buildVaultIndex(root);
    const wiki = index.documents.find((item) => item.path === "wiki/concepts/knowledge.md");
    const source = index.documents.find((item) => item.path === "10_raw/articles/source.md");
    const unused = index.documents.find((item) => item.path === "10_raw/articles/unused.md");

    assert.equal(wiki.sourceRefs.length, 1);
    assert.equal(wiki.sourceRefs[0].path, source.path);
    assert.equal(source.wikiReferences.length, 1);
    assert.equal(unused.wikiReferences.length, 0);
    assert.equal(wiki.qualityFlags.includes("unresolved_source"), false);

    const graph = graphPayload(index);
    assert.equal(graph.stats.wikiNodeCount, 1);
    assert.equal(graph.stats.materialNodeCount, 1);
    assert.equal(graph.stats.sourceEdgeCount, 1);
    assert.equal(graph.nodes.some((node) => node.sourcePath === unused.path), false);
    assert.equal(graph.edges.some((edge) => edge.relation === "source"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marks unresolved Wiki sources without fabricating graph nodes", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-missing-source-"));
  try {
    await mkdir(join(root, "wiki", "concepts"), { recursive: true });
    await writeFile(
      join(root, "wiki", "concepts", "missing.md"),
      "---\ntype: concept\nsources: 10_raw/missing.md\n---\n# Missing\n",
    );
    const index = await buildVaultIndex(root);
    const page = index.documents.find((item) => item.path === "wiki/concepts/missing.md");
    assert.equal(page.qualityFlags.includes("unresolved_source"), true);
    assert.equal(graphPayload(index).stats.materialNodeCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
