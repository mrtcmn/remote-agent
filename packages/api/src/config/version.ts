// One version for every install method — desktop client, Docker, host: the root
// package.json. It changes only when that file changes; no env var or image tag
// can hide it (installed compose files set APP_VERSION=${IMAGE_TAG:-latest}).
import pkg from '../../../../package.json';

export const APP_VERSION: string = pkg.version;
