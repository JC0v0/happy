use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    if let Err(error) = happy_cli::run().await {
        eprintln!("Error: {error:#}");
        return ExitCode::from(1);
    }

    ExitCode::SUCCESS
}
