/**
 * A detached child requests an independent console on Windows. When Windows
 * Terminal is configured as the default console host, that console can become
 * a visible terminal window even when Node's `windowsHide` flag is set.
 *
 * Windows does not terminate ordinary child processes when their parent exits,
 * so terminal relays can remain attached to the daemon without losing the
 * existing "sessions survive daemon restart" behavior.
 */
export function shouldDetachSessionProcess(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32';
}
