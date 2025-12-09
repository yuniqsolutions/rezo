import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

function getPackageMetadata() {
  const libPackageJsonPath = path.resolve(__dirname, '../../lib/package.json');
  const rootPackageJsonPath = path.resolve(__dirname, '../../package.json');
  
  const packageJsonPath = fs.existsSync(libPackageJsonPath) ? libPackageJsonPath : rootPackageJsonPath;
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  
  const adaptersPath = path.resolve(__dirname, '../../src/adapters/entries');
  let adapterCount = 6;
  if (fs.existsSync(adaptersPath)) {
    adapterCount = fs.readdirSync(adaptersPath).filter(f => f.endsWith('.ts')).length;
  }
  
  const dependencies = Object.keys(packageJson.dependencies || {});
  const dependencyCount = dependencies.length;
  
  const runtimes = ['Node.js', 'Bun', 'Deno', 'Browser', 'Edge Workers', 'React Native'];

  return {
    version: packageJson.version || '1.0.0',
    adapterCount: adapterCount,
    dependencyCount: dependencyCount,
    runtimeCount: runtimes.length,
    description: packageJson.description || '',
    repository: packageJson.repository?.url?.replace('git+', '').replace('.git', '') || 'https://github.com/yuniqsolutions/rezo',
    license: packageJson.license || 'MIT',
    minNodeVersion: packageJson.engines?.node?.replace('>=', '') || '22.0.0',
    keywords: packageJson.keywords || [],
    author: packageJson.author || '',
  };
}

export default defineConfig(() => {
  const metadata = getPackageMetadata();
  
  return {
    plugins: [svelte(), tailwindcss()],
    define: {
      'import.meta.env.VITE_PACKAGE_VERSION': JSON.stringify(metadata.version),
      'import.meta.env.VITE_ADAPTER_COUNT': JSON.stringify(String(metadata.adapterCount)),
      'import.meta.env.VITE_DEPENDENCY_COUNT': JSON.stringify(String(metadata.dependencyCount)),
      'import.meta.env.VITE_RUNTIME_COUNT': JSON.stringify(String(metadata.runtimeCount)),
      'import.meta.env.VITE_DESCRIPTION': JSON.stringify(metadata.description),
      'import.meta.env.VITE_REPOSITORY': JSON.stringify(metadata.repository),
      'import.meta.env.VITE_LICENSE': JSON.stringify(metadata.license),
      'import.meta.env.VITE_MIN_NODE_VERSION': JSON.stringify(metadata.minNodeVersion),
    },
    server: {
      host: '0.0.0.0',
      port: 5000,
      allowedHosts: true as const
    },
    build: {
      outDir: '../app',
      emptyOutDir: true
    }
  };
});
