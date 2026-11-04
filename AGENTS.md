# Repository Guidelines

## Project Structure & Module Organization

- `src/frontend/`: Vanilla JavaScript interface, themes, WebGPU/WebGL/Canvas terrain, and embedding worker.
- `src/shared/`: note parsing, semantic grouping, layout, and embedding utilities shared across runtimes.
- `crates/loci-core/`: Rust storage, SQLite/FTS5/sqlite-vec search, graph operations, and import validation.
- `crates/loci-server/`: Axum server; release builds embed the interface and model assets.
- `src-tauri/`: desktop shell, native dialogs, permissions, and packaging configuration.
- `tests/`: JavaScript tests and frontend smoke harness. Rust tests live beside implementation code.
- `assets/` and `scripts/`: branding, Apple Notes importer, and asset preparation.

## Build, Test, and Development Commands

Install Node 22.13+, Rust, and the target platform’s Tauri prerequisites.

- `npm ci --ignore-scripts`: install pinned JavaScript dependencies.
- `npm run setup:embeddings`: prepare local model and inference assets.
- `npm run dev`: launch desktop development mode.
- `npm run preview`: run the Rust browser server locally.
- `npm start`: run the release server at `http://127.0.0.1:4173`.
- `npm run build`: build native desktop packages on the target OS.
- `npm test`: run Node’s built-in test suite.
- `node scripts/prepare-web.js && npm run test:rust`: stage assets, then test the Rust workspace.

## Coding Style & Naming Conventions

Use ES modules, `camelCase` JavaScript identifiers, and descriptive kebab-case filenames. Match surrounding compact formatting and two-space JavaScript indentation; avoid unrelated reformatting. Keep the frontend framework-free and dependencies minimal.

Use Rust 2024 conventions and `snake_case` functions/modules. Run `cargo fmt --all`; verify with `cargo fmt --all --check`. No JavaScript formatter or linter is configured.

## Testing Guidelines

Name JavaScript tests `tests/*.test.js`; use descriptive behavior names and Rust `#[test]` functions. Add focused tests for changed layout, projection, parsing, migration, or storage behavior. No coverage threshold is configured. Use synthetic notes and temporary databases. Check visual changes in both themes and 2D/3D; report untested platforms and renderers.

## Commit & Pull Request Guidelines

This checkout has no Git metadata, so historical commit conventions cannot be verified. Prefer concise, imperative subjects, such as `Improve terrain contour contrast`. Keep changes focused. PRs should explain the problem, resulting behavior, validation, and limitations; link relevant issues and include screenshots for visual changes.

## Privacy & Configuration

Never commit personal notes, credentials, database files, or generated assets. Keep `data/`, `.build/`, `target/`, and model/vendor downloads ignored. Test migrations against copies. Preserve offline inference, loopback server boundaries, and Tauri permission restrictions. Configure server paths with `--data`/`LOCI_DB` and listeners with `--bind`/`LOCI_BIND`.
