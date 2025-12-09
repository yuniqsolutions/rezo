import { writable, get } from 'svelte/store';

function createRouter() {
  const getPath = () => {
    if (typeof window === 'undefined') return '/';
    const hash = window.location.hash;
    if (!hash || hash === '#' || hash === '#/') return '/';
    return hash.startsWith('#/') ? hash.slice(1) : hash.slice(1) || '/';
  };
  
  const { subscribe, set } = writable(getPath());
  
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => {
      set(getPath());
    });
    
    window.addEventListener('load', () => {
      set(getPath());
    });
  }
  
  return {
    subscribe,
    navigate: (path: string) => {
      if (typeof window !== 'undefined') {
        const normalizedPath = path.startsWith('/') ? path : '/' + path;
        window.location.hash = '#' + normalizedPath;
        set(normalizedPath);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };
}

export const router = createRouter();

export function navigate(path: string) {
  router.navigate(path);
}
