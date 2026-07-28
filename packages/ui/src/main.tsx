import { mountApp } from './mount';

// Web entry point. The desktop shell (packages/desktop) does NOT use this file;
// it installs its window.electronAPI shim first, then calls mountApp() itself.
mountApp(document.getElementById('root')!);
