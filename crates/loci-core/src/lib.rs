use anyhow::{Context, Result, bail, ensure};
use rusqlite::{Connection, OpenFlags, params};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Once,
    time::{Duration, UNIX_EPOCH},
};

static VECTOR_INIT: Once = Once::new();
pub const NOTE_LIMIT: usize = 5_000;
pub const TEXT_LIMIT: usize = 2_000_000;

pub fn content_hash(note: &Value) -> u32 {
    js_hash(&format!(
        "{}\n{}",
        note["title"].as_str().unwrap_or(""),
        note["body"].as_str().unwrap_or("")
    ))
}

/// Same FNV-1a as `hash()` in `src/shared/knowledge.js`, including its handling of astral characters.
pub fn js_hash(text: &str) -> u32 {
    text.chars().fold(2166136261u32, |hash, ch| {
        let cp = ch as u32;
        let code = if cp > 0xffff {
            0xd800 + ((cp - 0x10000) >> 10)
        } else {
            cp
        };
        (hash ^ code).wrapping_mul(16777619)
    })
}

pub fn validate_note(note: &Value) -> Result<()> {
    let text = |key: &str| {
        note.get(key)
            .and_then(Value::as_str)
            .context(format!("Missing text field: {key}"))
    };
    let id = text("id")?;
    let title = text("title")?;
    let body = text("body")?;
    ensure!(!id.is_empty() && id.len() <= 1200, "Invalid note ID");
    ensure!(
        !title.trim().is_empty() && title.chars().count() <= 1000,
        "Invalid note title"
    );
    ensure!(body.len() <= TEXT_LIMIT, "Note exceeds 2 MB");
    for key in ["tags", "links"] {
        let values = note[key].as_array().context(format!("Invalid {key}"))?;
        ensure!(
            values.len() <= 10_000 && values.iter().all(Value::is_string),
            "Invalid {key}"
        );
    }
    ensure!(
        note.get("path").is_none_or(Value::is_string),
        "Invalid note path"
    );
    if let Some(vector) = note.get("embedding") {
        let vector = vector.as_array().context("Invalid embedding")?;
        ensure!(
            !vector.is_empty()
                && vector.len() <= 4096
                && vector
                    .iter()
                    .all(|v| v.as_f64().is_some_and(|n| (n as f32).is_finite()))
                && vector
                    .iter()
                    .any(|v| v.as_f64().is_some_and(|n| n as f32 != 0.)),
            "Invalid embedding dimensions or values"
        );
        ensure!(
            note["embeddingModel"]
                .as_str()
                .is_some_and(|m| !m.is_empty() && m.len() <= 300),
            "Missing embedding model"
        );
        ensure!(
            note["embeddingHash"].as_u64() == Some(content_hash(note) as u64),
            "Embedding fingerprint does not match note content"
        );
    }
    Ok(())
}

fn register_vectors() {
    VECTOR_INIT.call_once(|| unsafe {
        // SQLite's documented auto-extension entry point is process-wide and registered once.
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *mut std::ffi::c_char,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> std::ffi::c_int,
        >(
            sqlite_vec::sqlite3_vec_init as *const ()
        )));
    });
}

pub struct Store {
    db: Connection,
}
impl Store {
    pub fn open(path: &Path, legacy: Option<&Path>) -> Result<Self> {
        register_vectors();
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent)?;
        }
        if !path.exists() {
            if let Some(source) = legacy.filter(|p| p.exists() && *p != path) {
                let original =
                    Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
                // The online backup API includes committed WAL data; copying just the main file would not.
                original.backup(rusqlite::MAIN_DB, path, None)?;
            }
        }
        Self::from_connection(Connection::open(path)?)
    }
    pub fn memory() -> Result<Self> {
        register_vectors();
        Self::from_connection(Connection::open_in_memory()?)
    }
    fn from_connection(db: Connection) -> Result<Self> {
        db.busy_timeout(Duration::from_secs(10))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,path TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS edges(a TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,b TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,kind TEXT NOT NULL,weight REAL NOT NULL,PRIMARY KEY(a,b));
            CREATE INDEX IF NOT EXISTS edges_b ON edges(b);
            CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,title,body,tags);
            CREATE TABLE IF NOT EXISTS embedding_profiles(id INTEGER PRIMARY KEY,model TEXT NOT NULL,dimensions INTEGER NOT NULL,UNIQUE(model,dimensions));
            CREATE TABLE IF NOT EXISTS embeddings(id INTEGER PRIMARY KEY,note_id TEXT NOT NULL UNIQUE REFERENCES notes(id) ON DELETE CASCADE,profile_id INTEGER NOT NULL REFERENCES embedding_profiles(id),content_hash INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS loci_migrations(name TEXT PRIMARY KEY);")?;
        let mut store = Self { db };
        let columns: Vec<String> = store
            .db
            .prepare("PRAGMA table_info(search)")?
            .query_map([], |r| r.get(1))?
            .collect::<rusqlite::Result<_>>()?;
        if !columns.iter().any(|c| c == "tags") {
            let notes = store.notes()?;
            store.transaction(|s| {
                s.db.execute_batch("DROP TABLE search; CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED,title,body,tags);")?;
                for n in notes {
                    s.write_note(n)?;
                }
                Ok(())
            })?;
        }
        let migrated: i64 = store.db.query_row(
            "SELECT count(*) FROM loci_migrations WHERE name='vector-index-v1'",
            [],
            |r| r.get(0),
        )?;
        if migrated == 0 {
            let notes = store.notes()?;
            store.transaction(|s| {
                // A stale vector must not stop the library from opening; it stays unindexed until refined.
                for note in notes {
                    if note.get("embedding").is_some() && validate_note(&note).is_ok() {
                        s.write_vector(&note)?;
                    }
                }
                s.db.execute("INSERT INTO loci_migrations VALUES('vector-index-v1')", [])?;
                Ok(())
            })?;
        }
        let migrated: i64 = store.db.query_row(
            "SELECT count(*) FROM loci_migrations WHERE name='vault-ids-v1'",
            [],
            |r| r.get(0),
        )?;
        if migrated == 0 {
            // Older vault imports used `vault:<absolute folder>:<file>` IDs, which changed when the
            // folder moved and never matched a browser upload. Re-key them to the shared path hash.
            let notes = store.notes()?;
            store.transaction(|s| {
                s.db.execute_batch("PRAGMA defer_foreign_keys=ON")?;
                for mut note in notes {
                    let (Some(old), Some(rel)) = (note["id"].as_str(), note["path"].as_str())
                    else {
                        continue;
                    };
                    let Some(root) = old
                        .strip_prefix("vault:")
                        .and_then(|r| r.strip_suffix(rel))
                        .and_then(|r| r.strip_suffix(':'))
                    else {
                        continue;
                    };
                    // Root may be a Windows path written on another OS; split on either separator.
                    let name = root
                        .trim_end_matches(['/', '\\'])
                        .rsplit(['/', '\\'])
                        .next()
                        .unwrap_or("");
                    let (old, path) = (old.to_string(), format!("{name}/{rel}"));
                    let id = format!("n{}", js_hash(&path));
                    let taken: i64 =
                        s.db.query_row("SELECT count(*) FROM notes WHERE id=?", [&id], |r| {
                            r.get(0)
                        })?;
                    if taken > 0 {
                        // The vault was already re-imported under the new ID; drop the stale copy.
                        s.db.execute("DELETE FROM search WHERE id=?", [&old])?;
                        s.db.execute("DELETE FROM notes WHERE id=?", [&old])?;
                        continue;
                    }
                    note["id"] = json!(id);
                    note["path"] = json!(path);
                    s.db.execute(
                        "UPDATE notes SET id=?,path=?,data=? WHERE id=?",
                        params![id, path, serde_json::to_string(&note)?, old],
                    )?;
                    for sql in [
                        "UPDATE edges SET a=? WHERE a=?",
                        "UPDATE edges SET b=? WHERE b=?",
                        "UPDATE embeddings SET note_id=? WHERE note_id=?",
                        "UPDATE search SET id=? WHERE id=?",
                    ] {
                        s.db.execute(sql, params![id, old])?;
                    }
                }
                s.db.execute("INSERT INTO loci_migrations VALUES('vault-ids-v1')", [])?;
                Ok(())
            })?;
        }
        Ok(store)
    }
    fn transaction<T>(&mut self, operation: impl FnOnce(&mut Self) -> Result<T>) -> Result<T> {
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        match operation(self) {
            Ok(value) => {
                self.db.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                self.db.execute_batch("ROLLBACK")?;
                Err(error)
            }
        }
    }
    pub fn notes(&self) -> Result<Vec<Value>> {
        let mut stmt = self.db.prepare("SELECT data FROM notes ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
    fn drop_vector(&self, id: &str) -> Result<()> {
        let existing = self
            .db
            .prepare("SELECT id,profile_id FROM embeddings WHERE note_id=?")?
            .query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (key, profile) in existing {
            self.db.execute(
                &format!("DELETE FROM vec_profile_{profile} WHERE rowid=?"),
                [key],
            )?;
        }
        self.db
            .execute("DELETE FROM embeddings WHERE note_id=?", [id])?;
        Ok(())
    }
    fn write_vector(&self, note: &Value) -> Result<()> {
        let id = note["id"].as_str().unwrap();
        self.drop_vector(id)?;
        let Some(vector) = note["embedding"].as_array() else {
            return Ok(());
        };
        let model = note["embeddingModel"].as_str().unwrap();
        self.db.execute(
            "INSERT OR IGNORE INTO embedding_profiles(model,dimensions) VALUES(?,?)",
            params![model, vector.len() as i64],
        )?;
        let profile: i64 = self.db.query_row(
            "SELECT id FROM embedding_profiles WHERE model=? AND dimensions=?",
            params![model, vector.len() as i64],
            |r| r.get(0),
        )?;
        self.db.execute_batch(&format!("CREATE VIRTUAL TABLE IF NOT EXISTS vec_profile_{profile} USING vec0(embedding float[{}] distance_metric=cosine)",vector.len()))?;
        self.db.execute(
            "INSERT INTO embeddings(note_id,profile_id,content_hash) VALUES(?,?,?)",
            params![id, profile, content_hash(note) as i64],
        )?;
        let key = self.db.last_insert_rowid();
        let bytes: Vec<u8> = vector
            .iter()
            .flat_map(|v| (v.as_f64().unwrap() as f32).to_le_bytes())
            .collect();
        self.db.execute(
            &format!("INSERT INTO vec_profile_{profile}(rowid,embedding) VALUES(?,?)"),
            params![key, bytes],
        )?;
        Ok(())
    }
    fn write_note(&self, mut note: Value) -> Result<()> {
        validate_note(&note)?;
        if note.get("embedding").is_none() {
            let existing = self
                .db
                .prepare("SELECT data FROM notes WHERE id=?")?
                .query_map([note["id"].as_str().unwrap()], |r| r.get::<_, String>(0))?
                .next()
                .transpose()?;
            if let Some(existing) = existing {
                let old: Value = serde_json::from_str(&existing)?;
                if old["embeddingHash"].as_u64() == Some(content_hash(&note) as u64)
                    && old.get("embedding").is_some()
                {
                    for key in ["embedding", "embeddingModel", "embeddingHash"] {
                        note[key] = old[key].clone();
                    }
                }
            }
        }
        let id = note["id"].as_str().unwrap();
        // Retain JSON vectors for compatibility with the current JS layout; the vector index is also transactional.
        self.db.execute("INSERT INTO notes VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,title=excluded.title,body=excluded.body,data=excluded.data",params![id,note["path"].as_str().unwrap_or(""),note["title"].as_str().unwrap(),note["body"].as_str().unwrap(),serde_json::to_string(&note)?])?;
        self.db.execute("DELETE FROM search WHERE id=?", [id])?;
        let tags = note["tags"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ");
        self.db.execute(
            "INSERT INTO search VALUES(?,?,?,?)",
            params![
                id,
                note["title"].as_str().unwrap(),
                note["body"].as_str().unwrap(),
                tags
            ],
        )?;
        self.write_vector(&note)
    }
    pub fn import_notes(&mut self, notes: Vec<Value>) -> Result<()> {
        ensure!(notes.len() <= NOTE_LIMIT, "Import exceeds 5,000 notes");
        for n in &notes {
            validate_note(n)?;
        }
        self.transaction(|s| {
            for n in notes {
                s.write_note(n)?;
            }
            let count: i64 =
                s.db.query_row("SELECT count(*) FROM notes", [], |r| r.get(0))?;
            ensure!(count <= NOTE_LIMIT as i64, "Collection exceeds 5,000 notes");
            Ok(())
        })
    }
    pub fn save_embeddings(&mut self, indexed: Vec<Value>) -> Result<Value> {
        ensure!(indexed.len() <= NOTE_LIMIT, "Invalid embedding batch");
        for n in &indexed {
            validate_note(n)?;
        }
        let by_id: std::collections::HashMap<&str, &Value> = indexed
            .iter()
            .filter_map(|v| Some((v["id"].as_str()?, v)))
            .collect();
        self.transaction(|s| {
            let current = s.notes()?;
            for mut n in current {
                if let Some(v) = n["id"]
                    .as_str()
                    .and_then(|id| by_id.get(id))
                    .filter(|v| v["embeddingHash"].as_u64() == Some(content_hash(&n) as u64))
                {
                    for key in ["embedding", "embeddingModel", "embeddingHash"] {
                        n[key] = v[key].clone();
                    }
                    s.write_note(n)?;
                }
            }
            Ok(())
        })?;
        Ok(json!({"notes":self.notes()?}))
    }
    pub fn request(&mut self, operation: &str, params: Value) -> Result<Value> {
        match operation {
            "library" => Ok(
                json!({"notes":self.notes()?,"storage":"Rust SQLite + sqlite-vec","fullText":true,"vectorSearch":true}),
            ),
            "saveNote" => {
                self.import_notes(vec![params["note"].clone()])?;
                Ok(json!(true))
            }
            "importNotes" => {
                self.import_notes(
                    params["notes"]
                        .as_array()
                        .context("Expected notes array")?
                        .clone(),
                )?;
                Ok(json!(true))
            }
            "saveEmbeddings" => self.save_embeddings(
                params["notes"]
                    .as_array()
                    .context("Expected notes array")?
                    .clone(),
            ),
            "searchNotes" => {
                let query = params["query"].as_str().context("Expected search text")?;
                ensure!(query.len() <= 2000, "Search is too long");
                let words: Vec<String> = query
                    .split(|c: char| !c.is_alphanumeric() && c != '_')
                    .filter(|w| !w.is_empty())
                    .map(|w| format!("\"{w}\"*"))
                    .collect();
                if words.is_empty() {
                    return Ok(json!([]));
                }
                let result = self
                    .db
                    .prepare("SELECT id FROM search WHERE search MATCH ? ORDER BY rank LIMIT 200")?
                    .query_map([words.join(" AND ")], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(json!(result))
            }
            "saveGraph" => {
                let edges = params["edges"].as_array().context("Expected edges array")?;
                ensure!(edges.len() <= 30000, "Graph is too large");
                self.transaction(|s| {
                    s.db.execute("DELETE FROM edges", [])?;
                    for e in edges {
                        let a = e["a"].as_str().context("Invalid edge")?;
                        let b = e["b"].as_str().context("Invalid edge")?;
                        let kind = e["kind"].as_str().context("Invalid edge")?;
                        let weight = e["weight"].as_f64().context("Invalid edge weight")?;
                        ensure!(
                            ["link", "similar"].contains(&kind) && weight.is_finite(),
                            "Invalid edge"
                        );
                        s.db.execute(
                            "INSERT OR IGNORE INTO edges VALUES(?,?,?,?)",
                            params![a, b, kind, weight],
                        )?;
                    }
                    Ok(())
                })?;
                Ok(json!(true))
            }
            "neighbors" => {
                let id = params["id"].as_str().context("Expected note ID")?;
                let depth = params["depth"].as_u64().unwrap_or(1);
                ensure!((1..=3).contains(&depth), "Invalid traversal depth");
                let rows=self.db.prepare("WITH RECURSIVE walk(id,depth) AS (SELECT ?,0 UNION SELECT CASE WHEN e.a=w.id THEN e.b ELSE e.a END,w.depth+1 FROM edges e JOIN walk w ON (e.a=w.id OR e.b=w.id) WHERE w.depth<?) SELECT DISTINCT n.data FROM notes n JOIN walk w ON n.id=w.id WHERE n.id<>?")?.query_map(params![id,depth as i64,id],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(Value::Array(
                    rows.iter()
                        .map(|r| serde_json::from_str(r))
                        .collect::<serde_json::Result<_>>()?,
                ))
            }
            "similarNotes" => {
                let id = params["id"].as_str().context("Expected note ID")?;
                let limit = params["limit"].as_u64().unwrap_or(10);
                ensure!((1..=100).contains(&limit), "Invalid neighbor count");
                let row = self
                    .db
                    .prepare("SELECT id,profile_id FROM embeddings WHERE note_id=?")?
                    .query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?
                    .next()
                    .transpose()?;
                let Some((key, profile)) = row else {
                    return Ok(json!([]));
                };
                let bytes: Vec<u8> = self.db.query_row(
                    &format!("SELECT embedding FROM vec_profile_{profile} WHERE rowid=?"),
                    [key],
                    |r| r.get(0),
                )?;
                let matches=self.db.prepare(&format!("SELECT rowid,distance FROM vec_profile_{profile} WHERE embedding MATCH ? AND k=?"))?.query_map(params![bytes,(limit+1) as i64],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,f64>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
                let mut out = Vec::new();
                for (other, distance) in matches
                    .into_iter()
                    .filter(|(other, _)| *other != key)
                    .take(limit as usize)
                {
                    let other_id: String = self.db.query_row(
                        "SELECT note_id FROM embeddings WHERE id=?",
                        [other],
                        |r| r.get(0),
                    )?;
                    out.push(json!({"id":other_id,"distance":distance}));
                }
                Ok(json!(out))
            }
            _ => bail!("Unknown operation: {operation}"),
        }
    }
}

pub fn read_vault(root: &Path) -> Result<Value> {
    ensure!(root.is_dir(), "Choose an existing vault folder");
    let root = fs::canonicalize(root)?;
    let mut files = Vec::new();
    let mut skipped = Vec::new();
    fn walk(
        root: &Path,
        relative: &Path,
        depth: usize,
        files: &mut Vec<Value>,
        skipped: &mut Vec<String>,
    ) -> Result<()> {
        ensure!(depth <= 30, "Vault folder depth exceeds 30");
        let mut entries =
            fs::read_dir(root.join(relative))?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.')
                || ["node_modules", "dist", "build", "vendor"].contains(&name.as_ref())
            {
                continue;
            }
            let rel = relative.join(name.as_ref());
            let meta = fs::symlink_metadata(entry.path())?;
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                walk(root, &rel, depth + 1, files, skipped)?;
                continue;
            }
            if !rel.extension().is_some_and(|e| {
                ["md", "markdown", "txt"].contains(&e.to_string_lossy().to_lowercase().as_str())
            }) {
                continue;
            }
            ensure!(
                files.len() + skipped.len() < NOTE_LIMIT,
                "Vault exceeds 5,000 text files; nothing was imported"
            );
            let path = rel.to_string_lossy().replace('\\', "/");
            if meta.len() > TEXT_LIMIT as u64 {
                skipped.push(format!("{path}: larger than 2 MB"));
                continue;
            }
            match fs::read_to_string(entry.path()) {
                Ok(text) => {
                    let modified = meta
                        .modified()?
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    // Same path shape as a browser folder upload, so both produce the same note IDs.
                    let name = root.file_name().unwrap_or_default().to_string_lossy();
                    files.push(
                        json!({"text":text,"path":format!("{name}/{path}"),"modified":modified}),
                    );
                }
                Err(_) => skipped.push(format!("{path}: unreadable UTF-8 text")),
            }
        }
        Ok(())
    }
    walk(&root, Path::new(""), 0, &mut files, &mut skipped)?;
    Ok(
        json!({"files":files,"skipped":skipped,"name":root.file_name().unwrap_or_default().to_string_lossy()}),
    )
}

pub fn desktop_data_dir() -> Result<PathBuf> {
    #[cfg(target_os = "macos")]
    let path =
        PathBuf::from(std::env::var("HOME")?).join("Library/Application Support/app.loci.desktop");
    #[cfg(target_os = "windows")]
    let path = PathBuf::from(std::env::var("APPDATA")?).join("app.loci.desktop");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let path = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or(PathBuf::from(std::env::var("HOME")?).join(".local/share"))
        .join("app.loci.desktop");
    Ok(path)
}

pub fn index_ollama(notes: &[Value]) -> Result<Vec<Value>> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .no_proxy()
        .build()?;
    let models: Value = client
        .get("http://127.0.0.1:11434/api/tags")
        .send()
        .context("Start optional local Ollama to use a larger model")?
        .error_for_status()?
        .json()?;
    let models = models["models"]
        .as_array()
        .context("Invalid Ollama model list")?;
    let local: Vec<&str> = models
        .iter()
        .filter(|m| m.get("remote_host").is_none_or(Value::is_null))
        .filter_map(|m| m["name"].as_str())
        .collect();
    let model = local
        .iter()
        .find(|n| n.starts_with("qwen3-embedding:"))
        .or_else(|| local.iter().find(|n| n.starts_with("nomic-embed-text:")))
        .copied()
        .context(
            "Install a local qwen3-embedding or nomic-embed-text model to use this optional path",
        )?;
    let mut out = Vec::new();
    for note in notes {
        let hash = content_hash(note);
        let key = format!("{model}:clustering:rust-v1");
        if note["embeddingModel"] == key && note["embeddingHash"].as_u64() == Some(hash as u64) {
            out.push(note.clone());
            continue;
        }
        let body = note["body"].as_str().unwrap_or("");
        let text = if body.trim().is_empty() {
            note["title"].as_str().unwrap_or("")
        } else {
            body
        };
        let chars: Vec<char> = text.chars().collect();
        let mut vectors = Vec::new();
        for chunk in chars.chunks(1800) {
            let input = format!(
                "{}{}\n{}",
                if model.starts_with("nomic-") {
                    "clustering: "
                } else {
                    ""
                },
                note["title"].as_str().unwrap_or(""),
                chunk.iter().collect::<String>()
            );
            let response:Value=client.post("http://127.0.0.1:11434/api/embed").json(&json!({"model":model,"input":[input],"truncate":false,"options":{"num_ctx":8192}})).send()?.error_for_status()?.json()?;
            let vector = response["embeddings"][0]
                .as_array()
                .context("Invalid Ollama embedding")?;
            vectors.push(
                vector
                    .iter()
                    .map(|v| v.as_f64().context("Invalid vector value"))
                    .collect::<Result<Vec<_>>>()?,
            );
        }
        ensure!(!vectors.is_empty(), "Cannot embed an empty note");
        let size = vectors[0].len();
        ensure!(
            (1..=4096).contains(&size)
                && vectors
                    .iter()
                    .all(|v| v.len() == size && v.iter().all(|x| x.is_finite())),
            "Invalid embedding dimensions"
        );
        let mut mean = vec![0.; size];
        for vector in &vectors {
            for (i, v) in vector.iter().enumerate() {
                mean[i] += v / vectors.len() as f64;
            }
        }
        let norm = mean.iter().map(|v| v * v).sum::<f64>().sqrt();
        ensure!(norm > 0., "Empty embedding vector");
        for v in &mut mean {
            *v /= norm;
        }
        let mut indexed = note.clone();
        indexed["embedding"] = json!(mean);
        indexed["embeddingModel"] = json!(key);
        indexed["embeddingHash"] = json!(hash);
        validate_note(&indexed)?;
        out.push(indexed);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn note(id: &str, body: &str) -> Value {
        json!({"id":id,"path":format!("{id}.md"),"title":id,"body":body,"tags":["nature"],"links":[],"type":"note","url":"","modified":1,"starred":false})
    }
    fn embedded(id: &str, body: &str, vector: Vec<f64>, model: &str) -> Value {
        let mut n = note(id, body);
        n["embedding"] = json!(vector);
        n["embeddingModel"] = json!(model);
        n["embeddingHash"] = json!(content_hash(&n));
        n
    }
    #[test]
    fn cosine_vectors_must_be_representable_and_nonzero() {
        for vector in [vec![1e100, 1.], vec![0., 0.], vec![1e-100, 0.]] {
            assert!(validate_note(&embedded("Garden", "Roots", vector, "test")).is_err());
        }
        assert!(validate_note(&embedded("Garden", "Roots", vec![1., 0.], "test")).is_ok());
    }
    #[test]
    fn fts_vector_search_and_graph_work_in_one_database() {
        let mut store = Store::memory().unwrap();
        let a = embedded("Garden", "Trees and roots", vec![1., 0.], "test");
        let b = embedded("Forest", "Trees", vec![0.99, 0.01], "test");
        let c = embedded("Computer", "Graphics rendering", vec![0., 1.], "test");
        let d = embedded("Other model", "Trees", vec![1., 0.], "other");
        store.import_notes(vec![a, b, c, d]).unwrap();
        assert_eq!(
            store
                .request("searchNotes", json!({"query":"roots"}))
                .unwrap(),
            json!(["Garden"])
        );
        assert_eq!(
            store
                .request("searchNotes", json!({"query":"\" OR *"}))
                .unwrap(),
            json!([])
        );
        let near = store
            .request("similarNotes", json!({"id":"Garden"}))
            .unwrap();
        assert_eq!(near[0]["id"], "Forest");
        assert_eq!(near.as_array().unwrap().len(), 2);
        store
            .request(
                "saveGraph",
                json!({"edges":[{"a":"Garden","b":"Forest","kind":"link","weight":1.}]}),
            )
            .unwrap();
        assert_eq!(
            store
                .request("neighbors", json!({"id":"Garden","depth":2}))
                .unwrap()[0]["id"],
            "Forest"
        );
        assert!(
            store
                .request(
                    "saveGraph",
                    json!({"edges":[{"a":"Garden","b":"missing","kind":"link","weight":1.}]})
                )
                .is_err()
        );
        assert_eq!(
            store
                .request("neighbors", json!({"id":"Garden"}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn imports_and_embeddings_preserve_edits_and_rollback() {
        let mut store = Store::memory().unwrap();
        let a = embedded("Garden", "Roots", vec![1., 0.], "test");
        store.import_notes(vec![a.clone()]).unwrap();
        store.import_notes(vec![note("Garden", "Roots")]).unwrap();
        assert!(store.notes().unwrap()[0].get("embedding").is_some());
        assert!(
            store
                .import_notes(vec![note("Garden", "Changed"), json!({})])
                .is_err()
        );
        assert_eq!(store.notes().unwrap()[0]["body"], "Roots");
        store
            .import_notes(vec![note("Garden", "Edited while indexing")])
            .unwrap();
        store.save_embeddings(vec![a]).unwrap();
        assert_eq!(store.notes().unwrap()[0]["body"], "Edited while indexing");
        assert!(store.notes().unwrap()[0].get("embedding").is_none());
    }
    #[test]
    fn online_migration_keeps_source_and_indexes_existing_vectors() {
        let directory =
            std::env::temp_dir().join(format!("loci-rust-migration-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let source = directory.join("legacy.sqlite");
        let target = directory.join("rust.sqlite");
        let mut original = Store::open(&source, None).unwrap();
        original
            .import_notes(vec![
                embedded("Garden", "Roots", vec![1., 0.], "test"),
                embedded("Forest", "Trees", vec![0., 1.], "test"),
            ])
            .unwrap();
        // Simulate a legacy database: no vector index yet, and one note whose text changed under its vector.
        original
            .db
            .execute_batch(
                "DELETE FROM loci_migrations; DELETE FROM embeddings; DELETE FROM vec_profile_1;
                 UPDATE notes SET data=json_set(data,'$.body','changed') WHERE id='Forest'",
            )
            .unwrap();
        let migrated = Store::open(&target, Some(&source)).unwrap();
        assert_eq!(migrated.notes().unwrap().len(), 2);
        assert_eq!(original.notes().unwrap().len(), 2);
        assert_eq!(
            migrated
                .db
                .query_row("SELECT note_id FROM embeddings", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "Garden"
        );
        drop(migrated);
        drop(original);
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn legacy_vault_ids_are_rekeyed_once_with_edges_vectors_and_search() {
        let directory =
            std::env::temp_dir().join(format!("loci-rust-vault-ids-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("library.sqlite");
        let mut store = Store::open(&file, None).unwrap();
        let mut a = embedded(
            "vault:/vaults/MyVault:notes/a.md",
            "Roots",
            vec![1., 0.],
            "test",
        );
        a["path"] = json!("notes/a.md");
        let mut b = note("vault:C:\\Users\\me\\MyVault:b.md", "Trees");
        b["path"] = json!("b.md");
        // A plain note and a vault already re-imported under its new ID (duplicate of `b`).
        let mut dup = note("n118555874", "Newer copy");
        dup["path"] = json!("MyVault/notes/a.md");
        store
            .import_notes(vec![a, b.clone(), note("Garden", "Plain"), dup])
            .unwrap();
        store
            .request(
                "saveGraph",
                json!({"edges":[{"a":"vault:/vaults/MyVault:notes/a.md","b":"Garden","kind":"link","weight":1.}]}),
            )
            .unwrap();
        store
            .db
            .execute("DELETE FROM loci_migrations WHERE name='vault-ids-v1'", [])
            .unwrap();
        drop(store);
        let mut store = Store::open(&file, None).unwrap();
        let ids: Vec<String> = store
            .notes()
            .unwrap()
            .iter()
            .map(|n| n["id"].as_str().unwrap().to_string())
            .collect();
        // `a` collided with the newer copy and was dropped; `b` was re-keyed to hash("MyVault/b.md").
        assert_eq!(ids.len(), 3);
        assert!(!ids.iter().any(|i| i.starts_with("vault:")));
        assert!(ids.contains(&"n118555874".to_string()));
        let b_id = format!("n{}", js_hash("MyVault/b.md"));
        assert!(ids.contains(&b_id));
        let stored = store
            .notes()
            .unwrap()
            .into_iter()
            .find(|n| n["id"] == b_id)
            .unwrap();
        assert_eq!(stored["path"], "MyVault/b.md");
        assert_eq!(
            store
                .request("searchNotes", json!({"query":"trees"}))
                .unwrap(),
            json!([b_id])
        );
        assert_eq!(
            store
                .db
                .query_row("SELECT count(*) FROM edges", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            store
                .db
                .query_row("SELECT count(*) FROM embeddings", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        drop(store);
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn vault_scan_skips_hidden_files_and_does_not_mutate_a_library() {
        let directory =
            std::env::temp_dir().join(format!("loci-rust-vault-{}", std::process::id()));
        fs::create_dir_all(directory.join(".hidden")).unwrap();
        fs::write(directory.join("Garden.md"), "# Garden\n[[Trees]] #nature").unwrap();
        fs::write(directory.join(".hidden/private.md"), "hidden").unwrap();
        fs::write(directory.join("image.png"), "ignore").unwrap();
        let data = read_vault(&directory).unwrap();
        assert_eq!(data["files"].as_array().unwrap().len(), 1);
        assert_eq!(
            data["files"][0]["path"],
            format!(
                "{}/Garden.md",
                directory.file_name().unwrap().to_string_lossy()
            )
        );
        assert!(data["files"][0].get("id").is_none());
        fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(test)]
mod fingerprint_test {
    use super::*;
    #[test]
    fn fingerprint_matches_existing_js_unicode_behavior() {
        assert_eq!(
            content_hash(&json!({"title":"Café 🚀","body":"A garden 🌳"})),
            3765279659
        );
        // Same value as parseNote('x','MyVault/notes/a.md').id in src/shared/knowledge.js.
        assert_eq!(js_hash("MyVault/notes/a.md"), 118555874);
    }
}
