pub mod api;
pub mod auth;
pub mod cli;
pub mod commands;
pub mod common;
pub mod config;
pub mod crypto;
pub mod daemon;
pub mod doctor;
pub mod machine;
pub mod persistence;
pub mod rpc;
pub mod server;
pub mod session;
pub mod socket;
pub mod terminal;
pub mod wire;

use anyhow::Result;
use clap::Parser;

pub async fn run() -> Result<()> {
    let cli = cli::Cli::parse();
    commands::run(cli).await
}
