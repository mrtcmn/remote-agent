import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Github } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useGitHubOAuthStatus } from '@/hooks/useGitHubApps';
import { getApiBase } from '@/lib/api-config';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const { data: oauthStatus } = useGitHubOAuthStatus();

  // Show error from OAuth callback redirect
  const oauthError = searchParams.get('error');

  const handleGitHubLogin = () => {
    const base = getApiBase();
    if (oauthStatus?.enabled) {
      // Use GitHub App OAuth flow
      window.location.href = `${base}/api/github-app/oauth/login`;
    } else if (oauthStatus?.legacyOAuth) {
      // Fall back to Better Auth's built-in GitHub OAuth
      window.location.href = `${base}/api/auth/sign-in/social?provider=github`;
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${getApiBase()}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Login failed');
      }

      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const showGitHubButton = oauthStatus?.enabled || oauthStatus?.legacyOAuth;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img src="/logo.png" alt="Remote Agent" className="mx-auto h-16 w-16 mb-4 rounded-xl" />
          <CardTitle className="text-2xl">Remote Agent</CardTitle>
          <CardDescription>
            Run Claude Code from anywhere. Control your development environment from any device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleEmailLogin} className="space-y-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {(error || oauthError) && (
              <p className="text-sm text-destructive">{error || oauthError}</p>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          {showGitHubButton && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <Button onClick={handleGitHubLogin} variant="outline" className="w-full gap-2" size="lg">
                <Github className="h-5 w-5" />
                Continue with GitHub
              </Button>
            </>
          )}

          <p className="text-center text-xs text-muted-foreground">
            By continuing, you agree to our terms of service and privacy policy.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
