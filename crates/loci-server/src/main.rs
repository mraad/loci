use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use loci_core::{Store, index_ollama};
use rust_embed::RustEmbed;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(RustEmbed)]
#[folder = "../../.build/web/"]
struct Assets;
type Shared = Arc<Mutex<Store>>;
type ApiError = (StatusCode, Json<Value>);
fn api_error(e: impl std::fmt::Display) -> ApiError {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error":e.to_string()})),
    )
}

async fn library(State(store): State<Shared>) -> Result<Json<Value>, ApiError> {
    request(store, "library".into(), json!({})).await.map(Json)
}
async fn operation(
    State(store): State<Shared>,
    Path(operation): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    if !headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/json"))
    {
        return Err((
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Json(json!({"error":"Expected application/json"})),
        ));
    }
    let params: Value = serde_json::from_slice(&body).map_err(api_error)?;
    if !params.is_object() {
        return Err(api_error("Expected a JSON object"));
    }
    request(store, operation, params).await.map(Json)
}
async fn request(store: Shared, operation: String, params: Value) -> Result<Value, ApiError> {
    tokio::task::spawn_blocking(move || -> anyhow::Result<Value> {
        if operation == "indexSemantics" {
            let notes = store
                .lock()
                .map_err(|_| anyhow::anyhow!("Storage unavailable"))?
                .notes()?;
            let indexed = index_ollama(&notes)?;
            return store
                .lock()
                .map_err(|_| anyhow::anyhow!("Storage unavailable"))?
                .save_embeddings(indexed);
        }
        store
            .lock()
            .map_err(|_| anyhow::anyhow!("Storage unavailable"))?
            .request(&operation, params)
    })
    .await
    .map_err(api_error)?
    .map_err(api_error)
}
async fn static_file(method: axum::http::Method, uri: axum::http::Uri) -> Response {
    if method != axum::http::Method::GET && method != axum::http::Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if path.split('/').any(|p| p == ".." || p.starts_with('.')) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(asset) = Assets::get(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "wasm" => "application/wasm",
        "png" => "image/png",
        _ => "application/octet-stream",
    };
    ([(header::CONTENT_TYPE, mime)], asset.data.into_owned()).into_response()
}
async fn boundaries(request: axum::extract::Request, next: Next) -> Response {
    let headers = request.headers();
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let hostname = host.rsplit_once(':').map(|(name, _)| name).unwrap_or(host);
    if !["localhost", "127.0.0.1", "[::1]"].contains(&hostname) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Untrusted host"})),
        )
            .into_response();
    }
    if headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|origin| {
            origin != format!("http://{host}") && origin != format!("https://{host}")
        })
        || headers
            .get("sec-fetch-site")
            .is_some_and(|v| v == "cross-site")
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Cross-origin requests are not allowed"})),
        )
            .into_response();
    }
    let mut response = next.run(request).await;
    for (name, value) in [
        ("cache-control", "no-store"),
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "same-origin"),
        ("cross-origin-resource-policy", "same-origin"),
        (
            "content-security-policy",
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        ),
    ] {
        response.headers_mut().insert(
            axum::http::HeaderName::from_static(name),
            value.parse().unwrap(),
        );
    }
    response
}
fn router(store: Store) -> Router {
    Router::new()
        .route("/api/library", get(library))
        .route("/api/{operation}", post(operation))
        .fallback(static_file)
        .layer(DefaultBodyLimit::max(50_000_000))
        .layer(middleware::from_fn(boundaries))
        .with_state(Arc::new(Mutex::new(store)))
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut bind = std::env::var("LOCI_BIND").unwrap_or("127.0.0.1:4173".into());
    let mut path =
        PathBuf::from(std::env::var("LOCI_DB").unwrap_or("data/loci-rust.sqlite".into()));
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bind" => {
                bind = args
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("Missing --bind address"))?
            }
            "--data" => {
                path = PathBuf::from(
                    args.next()
                        .ok_or_else(|| anyhow::anyhow!("Missing --data path"))?,
                )
            }
            "--help" => {
                println!(
                    "loci-server [--bind 127.0.0.1:4173] [--data path.sqlite]\nRemote access: use SSH local port forwarding and open the forwarded localhost address."
                );
                return Ok(());
            }
            _ => anyhow::bail!("Unknown argument: {arg}"),
        }
    }
    let address: std::net::SocketAddr = bind.parse()?;
    anyhow::ensure!(
        address.ip().is_loopback(),
        "Bind to loopback; use SSH local port forwarding for remote access"
    );
    let legacy = path
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("loci.sqlite");
    let store = Store::open(&path, Some(&legacy))?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!(
        "Loci Rust server: http://{}\nSQLite: {}",
        listener.local_addr()?,
        path.display()
    );
    axum::serve(listener, router(store))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn http_rejects_cross_origin_and_serves_ui() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, router(Store::memory().unwrap()))
                .await
                .unwrap();
        });
        // Use a raw HTTP request so the test adds no client dependency.
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let host = address.to_string();
        for (path, host, extra, expected) in [
            ("/api/library", host.as_str(), "", "200 OK"),
            ("/", host.as_str(), "", "200 OK"),
            (
                "/api/library",
                host.as_str(),
                "Origin: https://evil.example\r\n",
                "403 Forbidden",
            ),
            // DNS rebinding: a hostile name that resolves to loopback is still refused.
            ("/api/library", "evil.example", "", "403 Forbidden"),
            ("/backend/store.js", host.as_str(), "", "404 Not Found"),
        ] {
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream
                .write_all(
                    format!(
                        "GET {path} HTTP/1.1\r\nHost: {host}\r\n{extra}Connection: close\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            let mut bytes = Vec::new();
            stream.read_to_end(&mut bytes).await.unwrap();
            assert!(String::from_utf8_lossy(&bytes).contains(expected));
        }
        task.abort();
    }
}
