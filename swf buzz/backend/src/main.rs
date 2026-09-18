use swf_buzz_backend::{build_state, config::Config, routes};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().init();

    let config = Config::from_env().map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let bind_addr = config.bind_addr.clone();
    let state = build_state(&config).await?;

    let app = routes::router(state);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!(%bind_addr, "swf-buzz-backend listening");
    axum::serve(listener, app).await?;
    Ok(())
}
