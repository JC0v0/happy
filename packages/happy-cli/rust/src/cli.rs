use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(
    name = "happy",
    version,
    about = "Remote terminal, end-to-end encrypted",
    arg_required_else_help = false
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Start a remote terminal session.
    Terminal(TerminalArgs),
    /// Manage authentication.
    Auth(AuthArgs),
    /// Run diagnostics.
    Doctor(DoctorArgs),
    /// Manage the background daemon.
    Daemon(DaemonArgs),
    /// Send a push notification.
    Notify(NotifyArgs),
    /// Run the local self-host server.
    Server(ServerArgs),
    /// Print a farewell message.
    Bye,
    /// Compatibility alias for auth logout.
    Logout,
}

#[derive(Debug, Args, Default)]
pub struct TerminalArgs {
    /// Identifies the process owner when launched by the daemon.
    #[arg(long, value_enum)]
    pub started_by: Option<StartedBy>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum StartedBy {
    Daemon,
    Terminal,
}

#[derive(Debug, Args, Default)]
pub struct AuthArgs {
    #[command(subcommand)]
    pub command: Option<AuthCommand>,
}

#[derive(Debug, Subcommand)]
pub enum AuthCommand {
    /// Start the authentication flow.
    Login,
    /// Remove local credentials and machine state.
    Logout,
    /// Show local authentication status.
    Status,
}

#[derive(Debug, Args, Default)]
pub struct DoctorArgs {
    #[command(subcommand)]
    pub command: Option<DoctorCommand>,
}

#[derive(Debug, Subcommand)]
pub enum DoctorCommand {
    /// Stop Happy daemon and child processes.
    Clean,
}

#[derive(Debug, Args, Default)]
pub struct DaemonArgs {
    #[command(subcommand)]
    pub command: Option<DaemonCommand>,
}

#[derive(Debug, Subcommand)]
pub enum DaemonCommand {
    /// Start the daemon in the background.
    Start,
    /// Start the daemon in the foreground.
    StartSync,
    /// Stop the daemon while preserving sessions.
    Stop,
    /// Show daemon status.
    Status,
    /// List sessions known by the daemon.
    List,
    /// Print the latest daemon log path.
    Logs,
    /// Install the daemon as a platform service.
    Install,
    /// Remove the platform daemon service.
    Uninstall,
    /// Stop one session.
    StopSession { session_id: String },
}

#[derive(Debug, Args, Default)]
pub struct NotifyArgs {
    /// Notification message.
    #[arg(short = 'p', long = "message")]
    pub message: Option<String>,
    /// Notification title.
    #[arg(short = 't', long)]
    pub title: Option<String>,
}

#[derive(Debug, Args, Default)]
pub struct ServerArgs {
    /// Port to listen on.
    #[arg(short = 'p', long, default_value_t = 3005)]
    pub port: u16,
    /// Host interface to bind.
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,
    /// Reset local server data before starting.
    #[arg(long)]
    pub reset: bool,
    /// Do not persist the local server URL.
    #[arg(long)]
    pub no_persist: bool,
    /// Explicit master secret for the local server.
    #[arg(long)]
    pub master_secret: Option<String>,
}
