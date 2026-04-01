import { useState } from 'react';
import { getElectronAPI } from '../lib/electron';
import { useApiConfig } from '../lib/api-config';

export function SetupScreen() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'error' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { setApiUrl } = useApiConfig();

  const handleConnect = async () => {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed) {
      setErrorMessage('Please enter a URL');
      setStatus('error');
      return;
    }

    setStatus('checking');
    setErrorMessage('');

    const electronAPI = getElectronAPI();
    if (!electronAPI) return;

    const result = await electronAPI.checkConnection(trimmed);

    if (result.ok) {
      setStatus('success');
      await electronAPI.setApiUrl(trimmed);
      setApiUrl(trimmed);
    } else {
      setStatus('error');
      setErrorMessage(result.error || 'Could not connect to server');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && status !== 'checking') {
      handleConnect();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 app-drag">
      <div className="frosted-card w-full max-w-md p-8 rounded-2xl space-y-6 app-no-drag">
        {/* Logo / Title */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="text-primary">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Remote Agent</h1>
          <p className="text-sm text-muted-foreground">
            Connect to your Remote Agent server
          </p>
        </div>

        {/* URL Input */}
        <div className="space-y-2">
          <label htmlFor="api-url" className="text-sm font-medium text-foreground">
            Server URL
          </label>
          <input
            id="api-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://your-server.example.com"
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10
              text-foreground placeholder:text-muted-foreground
              focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50
              transition-all duration-200"
            disabled={status === 'checking'}
            autoFocus
          />
        </div>

        {/* Error Message */}
        {status === 'error' && errorMessage && (
          <div className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        {/* Success Message */}
        {status === 'success' && (
          <div className="px-4 py-3 rounded-xl bg-primary/10 border border-primary/20 text-sm text-primary">
            Connected successfully! Loading...
          </div>
        )}

        {/* Connect Button */}
        <button
          onClick={handleConnect}
          disabled={status === 'checking' || status === 'success'}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all duration-200
            bg-primary text-primary-foreground hover:bg-primary/90
            disabled:opacity-50 disabled:cursor-not-allowed
            flex items-center justify-center gap-2"
        >
          {status === 'checking' ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground" />
              Connecting...
            </>
          ) : status === 'success' ? (
            'Connected'
          ) : (
            'Connect'
          )}
        </button>

        <p className="text-xs text-center text-muted-foreground">
          Enter the URL where your Remote Agent API is running
        </p>
      </div>
    </div>
  );
}
