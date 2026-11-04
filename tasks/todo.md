# Audit fixes (2026-11-04)

- [x] 1 Apple Notes date → ISO in AppleScript
- [x] 2 Vault IDs: Rust drops `id`, prefixes folder name to path; app.js drops `id:f.id`
- [x] 3 vector-index migration skips invalid notes instead of failing open
- [x] 4 merge() persists only incoming notes
- [x] 5 drag updates node transforms instead of rebuilding SVG
- [x] 6 Host-header 403 test in loci-server
- [x] 7 delete legacy TinyJS stack (backend, scripts, tests, tiny branches, mergeEmbeddings, npm scripts, README)
- [x] 8 FTS tags migration inside transaction
- [x] 9 renderList skips hidden view; excerpt slices body first
- [x] 10 region rgb parsed once in setRegions (lazy cache on region)
- [x] 11 index_ollama single local-model list
- [x] 12 save_embeddings HashMap lookup
- [x] npm test 25/25, cargo test 7/7, cargo fmt clean, prepare-web

Not verified in a running app: drag transform update (#5), real Apple Notes import (#1 verified only via osascript date format).
