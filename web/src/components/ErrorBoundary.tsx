import React from 'react';

/** Send a front-end error to the server log (logs/server.log) so it can be diagnosed. */
export function reportClientError(kind: string, message: string, stack?: string) {
  try {
    navigator.sendBeacon?.('/api/client-error', new Blob([JSON.stringify({ kind, message, stack, url: location.href, ua: navigator.userAgent })], { type: 'application/json' }));
  } catch { /* ignore */ }
}

window.addEventListener('error', (e) => reportClientError('error', String(e.message), e.error?.stack));
window.addEventListener('unhandledrejection', (e) => reportClientError('promise', String((e.reason as Error)?.message || e.reason), (e.reason as Error)?.stack));

/** Instead of a white screen: show what broke and offer a reload. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportClientError(`render${this.props.label ? `:${this.props.label}` : ''}`, error.message, `${error.stack}\n${info.componentStack}`);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <b>Giao diện gặp lỗi{this.props.label ? ` (${this.props.label})` : ''}</b>
        <code>{this.state.error.message}</code>
        <div className="row gap">
          <button className="btn primary" onClick={() => location.reload()}>Tải lại trang</button>
          <button className="btn" onClick={() => this.setState({ error: null })}>Thử tiếp</button>
        </div>
        <span className="muted small">Lỗi đã được ghi lại để sửa. Dữ liệu dự án không bị ảnh hưởng (đã lưu trên server).</span>
      </div>
    );
  }
}
