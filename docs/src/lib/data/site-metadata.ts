export interface SiteMetadata {
  version: string;
  adapterCount: number;
  dependencyCount: number;
  typesCoverage: string;
  runtimeCount: number;
  description: string;
  repository: string;
  npmUrl: string;
  license: string;
  minNodeVersion: string;
}

const getEnvVar = (key: string, fallback: string): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return (import.meta.env as Record<string, string | undefined>)[key] || fallback;
  }
  return fallback;
};

export const siteMetadata: SiteMetadata = {
  version: getEnvVar('VITE_PACKAGE_VERSION', '1.0.0'),
  adapterCount: parseInt(getEnvVar('VITE_ADAPTER_COUNT', '6'), 10),
  dependencyCount: parseInt(getEnvVar('VITE_DEPENDENCY_COUNT', '0'), 10),
  typesCoverage: '100%',
  runtimeCount: parseInt(getEnvVar('VITE_RUNTIME_COUNT', '6'), 10),
  description: getEnvVar('VITE_DESCRIPTION', 'Enterprise-grade HTTP client for JavaScript'),
  repository: getEnvVar('VITE_REPOSITORY', 'https://github.com/yuniqsolutions/rezo'),
  npmUrl: 'https://www.npmjs.com/package/rezo',
  license: getEnvVar('VITE_LICENSE', 'MIT'),
  minNodeVersion: getEnvVar('VITE_MIN_NODE_VERSION', '22.0.0'),
};
