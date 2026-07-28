/**
 * xterm 6's custom viewport handles mouse-wheel and scrollbar input, but it
 * does not turn a drag over the terminal content into scrollback movement.
 * Native WebViews therefore need a small touch bridge. Normal-buffer drags
 * move xterm scrollback. Alternate-buffer/TUI drags request the local Blocks
 * record view instead of emitting PTY input, so viewport browsing on one
 * client never changes the shared TUI state on every connected client.
 *
 * This is kept as plain JavaScript because it is injected into the isolated
 * WebView document. The tests execute the same source against lightweight
 * mocks so the gesture direction and tap/drag distinction stay covered.
 */
export const TERMINAL_TOUCH_SCROLL_SCRIPT = `
  var touchStartX = null;
  var touchStartY = null;
  var touchLastY = null;
  var touchRemainderY = 0;
  var touchIsScrolling = false;
  var touchRequestedLocalRecords = false;
  var touchContainer = document.getElementById('term-container');
  var touchThreshold = 6;

  function isInteractiveTerminalBuffer(){
    var activeBuffer = term.buffer && term.buffer.active;
    var mouseMode = term.modes && term.modes.mouseTrackingMode;
    return (activeBuffer && activeBuffer.type === 'alternate')
      || (mouseMode && mouseMode !== 'none');
  }

  function openLocalRecords(lines){
    if (!touchRequestedLocalRecords && typeof post === 'function') {
      touchRequestedLocalRecords = true;
      post({ type: 'local-records', deltaLines: lines });
    }
  }

  function tapIsNearCursor(clientY){
    var activeBuffer = term.buffer && term.buffer.active;
    if (!activeBuffer || typeof activeBuffer.cursorY !== 'number') { return true; }
    var cellHeight = touchContainer.clientHeight / Math.max(term.rows, 1);
    if (!isFinite(cellHeight) || cellHeight <= 0) { return true; }
    var bounds = touchContainer.getBoundingClientRect
      ? touchContainer.getBoundingClientRect()
      : { top: 0 };
    var tappedRow = Math.max(0, Math.min(term.rows - 1, Math.floor((clientY - bounds.top) / cellHeight)));
    var inputHitSlopRows = Math.max(3, Math.ceil(48 / cellHeight));
    return Math.abs(tappedRow - activeBuffer.cursorY) <= inputHitSlopRows;
  }

  function dismissTerminalKeyboard(){
    if (typeof term.blur === 'function') { term.blur(); }
    if (typeof post === 'function') { post({ type: 'keyboard-dismiss' }); }
  }

  function resetTouchScroll(){
    touchStartX = null;
    touchStartY = null;
    touchLastY = null;
    touchRemainderY = 0;
    touchIsScrolling = false;
    touchRequestedLocalRecords = false;
  }

  touchContainer.addEventListener('touchstart', function(event){
    if (event.touches.length !== 1) {
      resetTouchScroll();
      return;
    }
    var touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchLastY = touch.clientY;
    touchRemainderY = 0;
    touchIsScrolling = false;
  }, { passive: true });

  touchContainer.addEventListener('touchmove', function(event){
    if (touchLastY === null || event.touches.length !== 1) { return; }
    var touch = event.touches[0];
    var totalX = Math.abs(touch.clientX - touchStartX);
    var totalY = Math.abs(touch.clientY - touchStartY);

    if (!touchIsScrolling) {
      if (totalY < touchThreshold || totalY <= totalX) { return; }
      touchIsScrolling = true;
    }

    event.preventDefault();
    touchRemainderY += touchLastY - touch.clientY;
    touchLastY = touch.clientY;

    var cellHeight = touchContainer.clientHeight / Math.max(term.rows, 1);
    if (!isFinite(cellHeight) || cellHeight <= 0) { return; }
    var lines = touchRemainderY > 0
      ? Math.floor(touchRemainderY / cellHeight)
      : Math.ceil(touchRemainderY / cellHeight);
    if (lines !== 0) {
      if (isInteractiveTerminalBuffer()) {
        openLocalRecords(lines);
      } else {
        term.scrollLines(lines);
      }
      touchRemainderY -= lines * cellHeight;
    }
  }, { passive: false });

  touchContainer.addEventListener('touchend', function(event){
    var wasScrolling = touchIsScrolling;
    var tapY = touchLastY;
    var interactive = isInteractiveTerminalBuffer();
    if (interactive) { event.preventDefault(); }
    resetTouchScroll();
    if (wasScrolling || tapY === null) { return; }
    if (interactive && !tapIsNearCursor(tapY)) {
      dismissTerminalKeyboard();
      return;
    }
    // Keep focus inside the trusted touchend event. Deferring it to a timer
    // loses iOS user activation and can make the keyboard require many taps.
    term.focus();
  }, { passive: false });
  touchContainer.addEventListener('touchcancel', resetTouchScroll);
`;
