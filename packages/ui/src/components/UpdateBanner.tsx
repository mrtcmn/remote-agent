import { useState, useEffect } from 'react';
import { X, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useVersion } from '@/hooks/useVersion';

const DISMISSED_KEY = 'update-banner-dismissed';

export function UpdateBanner() {
  const { version, isLoading } = useVersion();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (version?.updateAvailable && version.latest) {
      // Check if this specific version was already dismissed
      const dismissedVersion = localStorage.getItem(DISMISSED_KEY);
      if (dismissedVersion !== version.latest) {
        setDismissed(false);
      }
    }
  }, [version]);

  const handleDismiss = () => {
    if (version?.latest) {
      localStorage.setItem(DISMISSED_KEY, version.latest);
    }
    setDismissed(true);
  };

  if (isLoading || dismissed || !version?.updateAvailable) {
    return null;
  }

  return (
    <div className="bg-primary/10 border-b border-primary/20 px-4 py-2">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <RefreshCw className="h-4 w-4 text-primary" />
          <span>
            <strong>Update available:</strong> {version.latest}
          </span>
          <span className="text-muted-foreground hidden sm:inline">
            Run <code className="bg-muted px-1 py-0.5 rounded text-xs">./upgrade.sh</code> to update
          </span>
        </div>

        <div className="flex items-center gap-2">
          {version.releaseUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              asChild
            >
              <a href={version.releaseUrl} target="_blank" rel="noopener noreferrer">
                View Release
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
