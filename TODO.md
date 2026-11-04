# Loci follow-up work

The Rust port uses SQLite + FTS5 + sqlite-vec first. These are separate follow-up evaluations, not additional production dependencies.

- [ ] **LanceDB:** prototype its embedded Rust SDK against a copy of the collection; compare filtered vector search, hybrid retrieval, disk use, indexing latency, and startup with SQLite. Preserve note IDs, explicit links, model fingerprints, and export compatibility. Adopt only with a measured benefit.
- [ ] **SurrealDB:** prototype embedded graph + vector + full-text queries; test recursive traversal, filtering, migration/export, transactional updates, packaging, licensing, and supported OS targets. Compare operational and build costs before replacing SQLite.
- [ ] **Rust FastEmbed:** evaluate headless local indexing using the existing MiniLM ONNX/tokenizer files, with no first-run downloads. Match the current 200-token windows, 180-token stride, title truncation, mean pooling, normalization, and content fingerprints. Compare embeddings and note-neighbor rankings with Transformers.js before reusing a model ID. Keep browser inference and optional Ollama available.
- [ ] Run Windows and Linux native packaging and GPU/fallback checks on real machines or suitable CI runners.

References: [LanceDB](https://docs.lancedb.com/), [SurrealDB](https://surrealdb.com/docs/learn/data-models/vector-search/overview), [FastEmbed](https://docs.rs/fastembed/latest/fastembed/).
