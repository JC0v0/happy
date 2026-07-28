export interface TerminalViewport {
  cols: number;
  rows: number;
}

/**
 * Tracks physical viewport capacity per device and selects one shared PTY
 * grid. Resizing a passive viewer never disturbs the running TUI; the device
 * that most recently sends input takes control and applies its latest size.
 */
export class TerminalGridController {
  private readonly viewports = new Map<string, TerminalViewport>();
  private controllerTerminalId: string | undefined;

  constructor(
    private readonly apply: (
      viewport: TerminalViewport,
      controllerTerminalId: string,
    ) => void,
  ) {}

  reportViewport(terminalId: string, viewport: TerminalViewport): void {
    this.viewports.set(terminalId, viewport);
    if (!this.controllerTerminalId) {
      this.controllerTerminalId = terminalId;
    }
    if (this.controllerTerminalId === terminalId) {
      this.apply(viewport, terminalId);
    }
  }

  activate(terminalId: string): void {
    this.controllerTerminalId = terminalId;
    const viewport = this.viewports.get(terminalId);
    if (viewport) {
      this.apply(viewport, terminalId);
    }
  }

  get activeTerminalId(): string | undefined {
    return this.controllerTerminalId;
  }
}
