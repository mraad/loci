# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `AGENTS.md` for directory layout and style rules, and `README.md` for product behavior. This file covers what those do not: how the pieces connect and the commands to run them.

## Commands

Prerequisites: Node 22.13+, Rust (edition 2024), Tauri platform prerequisites.

```sh
npm ci --ignore-scripts          # JS deps (one runtime dep: @huggingface/transformers)
npm run setup:embeddings         # fetch/prepare the MiniLM model + ONNX runtime into src/frontend/{models,vendor}
node scripts/prepare-web.js      # stage src/frontend + src/shared into .build/web (required before any Rust build of the server)
npm run dev                      # Tauri desktop dev mode
npm run build -- --bundles app   # macOS .app -> target/release/bundle/macos/Loci.app
npm start                        # release loci-server at http://127.0.0.1:4173 (runs prepare-web first)
npm run preview                  # debug loci-server

npm test                         # node --test tests/*.test.js (JS only)
npm run test:rust                # cargo test --workspace
cargo fmt --all --check          # Rust formatting check (no JS linter configured)

# Single tests
node --test tests/knowledge.test.js
cargo test -p loci-core <test_name>
```

`tests/native-sqlite.js` and `tests/frontend-smoke.js` do not match `*.test.js`, so `npm test` skips them. The smoke test needs the app's asset origin and real WebGPU/WebGL/model inference.

## Architecture: one frontend, two hosts, one Rust core

The UI is vanilla JS with no bundler. The same files run in three places, and the Rust core is the only storage path that matters for the shipped app.

- **Frontend** (`src/frontend/app.js`, `terrain.js`, `semantic-worker.js`) talks to storage through one function, `apiCall(name, params)`. Inside Tauri it calls `globalThis.__TAURI__.core.invoke('loci', {operation, params})`. In browser mode it POSTs JSON to `/api/<operation>`, and `GET /api/library` loads the collection. Adding a storage operation means changing both the Rust dispatch and this call path.
- **Desktop host** (`src-tauri/src/main.rs`) registers one Tauri command, `loci`. It handles native-only operations (folder dialogs, Apple Notes, opening source URLs, theme, JSON export, Ollama indexing) and forwards everything else to `Store::request`.
- **Browser/server host** (`crates/loci-server/src/main.rs`) is an Axum app. It embeds `.build/web/` via `rust-embed`, so a release binary needs no checkout. `Store::request` is wrapped in `spawn_blocking` behind a `Mutex<Store>`. Middleware restricts requests to loopback hosts and origins. Keep this boundary when changing routes.
- **Rust core** (`crates/loci-core/src/lib.rs`) owns SQLite storage. `Store::request` is the single operation dispatch (`library`, `saveNote`, `importNotes`, `saveEmbeddings`, `searchNotes`, `saveGraph`, `neighbors`, `similarNotes`). Schema, FTS5, sqlite-vec tables, graph edges, and vault/JSON import validation all live there.

The `.build/` directory is a copy, not a source. Edit `src/frontend/` and `src/shared/`, then run `node scripts/prepare-web.js`. `loci-server` embeds whatever is in `.build/web` at compile time, so a stale copy means a stale UI. `.build/` is gitignored.

`src/shared/` is loaded by the UI thread (`app.js`) and the embedding worker (`semantic-worker.js`), so it must stay free of DOM access.

## Cross-cutting invariants

These couple the JS and Rust sides. Breaking one fails silently or at import time.

- **Fingerprints must match across languages.** The JS `contentHash` (`src/shared/embedding-utils.js`) and Rust `content_hash` (`loci-core`) hash `title + "\n" + body` with the same FNV-1a variant. Astral characters are split into UTF-16 surrogates on both sides. `validate_note` rejects any embedding whose `embeddingHash` does not match the note's current content. If you change hashing, change both sides together, or every existing embedding is rejected.
- **Embeddings are model-scoped.** An embedding is valid only for its `embeddingModel` string (`all-MiniLM-L6-v2:q8:v1` by default) and its dimensions. Rust keeps one sqlite-vec table per model and dimension pair. Ollama vectors (`qwen3-embedding`, `nomic-embed-text`) are never compared with MiniLM vectors. Editing a note's title or body invalidates its embedding.
- **Semantic layout is deterministic.** Positions for an unchanged collection must not change between runs. Both 2D and 3D use the same base coordinates from `src/shared/layout.js` and `knowledge.js`. Sampling for more than 600 notes is a deliberate limit, not a bug.
- **Import limits:** 5,000 notes per collection, 2 MB per note, 50 MB per server request (`NOTE_LIMIT`, `TEXT_LIMIT`, and the Axum body limit). Imports are snapshots. Reimporting updates the imported copy and never overwrites originals.
- **Legacy migration.** On first launch, the desktop app and the server copy `loci.sqlite` into `loci-rust.sqlite` using SQLite's online backup API, which includes WAL data. Do not replace this with a file copy. Schema changes must migrate in place (see the `search` table `tags` column check in `Store::from_connection`).
- **Local-only.** Inference runs in the browser (WebGPU/WASM) or on loopback Ollama. Nothing calls out to a remote inference service. Tauri capabilities are restricted in `src-tauri/capabilities/default.json`. Keep both restrictions.

## Data and privacy

Real notes live in `data/` and in the OS app-data folder. Server storage defaults to `data/loci-rust.sqlite` relative to the working directory. Use `--data`/`LOCI_DB` for another path and `--bind`/`LOCI_BIND` for the listener. Test migrations and imports against copies or temporary databases, never the files in `data/`. Do not commit `*.sqlite*`, `data/`, `.build/`, `target/`, or vendored model files.

## Where to look

- Model/runtime assets and their licenses: `src/frontend/vendor/`, `src/frontend/models/minilm/`.
- Embedding pipeline: `src/shared/embedded-index.js` (browser), `src/frontend/semantic-worker.js` (worker), `crates/loci-core` `save_embeddings` and `index_ollama` (Rust).
- Desktop packaging and permissions: `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/Info.plist`, `src-tauri/Entitlements.plist`.
- Apple Notes import uses AppleScript (`assets/apple-notes.applescript`); the desktop host dispatches `importAppleNotes` natively.
- Follow-up evaluations (LanceDB, SurrealDB, FastEmbed) are tracked in `TODO.md`. They are not dependencies.
