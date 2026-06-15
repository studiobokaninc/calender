// 操作ログ蓄積 (プライバシー: 許可リスト方式・入力値禁止)
const MAX_CHARS = 20000;
let _log = '';

export function appendLog(entry: string): void {
  const ts = new Date().toTimeString().slice(0, 8);
  _log += `${ts} ${entry}\n`;
  if (_log.length > MAX_CHARS) {
    _log = _log.slice(_log.length - MAX_CHARS);
  }
}

export function getLog(): string {
  return _log;
}

export function initOpLogListeners(): void {
  // クリック: input/textarea/select系は除外 (プライバシー)
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!t) return;
    if (t.closest('input,textarea,select,[type="password"]')) return;
    const label = t.getAttribute('aria-label')
      || t.textContent?.trim().slice(0, 30)
      || t.tagName.toLowerCase();
    appendLog(`[click] ${label}`);
  }, true);

  // グローバルエラー
  window.addEventListener('error', (e) => {
    appendLog(`[error] ${e.message}`);
  });
}
