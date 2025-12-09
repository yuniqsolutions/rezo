import { writable } from 'svelte/store';

function createThemeStore() {
  const stored = typeof window !== 'undefined' ? localStorage.getItem('theme') : null;
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initial = stored || (prefersDark ? 'dark' : 'light');
  
  const { subscribe, set, update } = writable<'light' | 'dark'>(initial as 'light' | 'dark');
  
  return {
    subscribe,
    toggle: () => {
      update(current => {
        const next = current === 'light' ? 'dark' : 'light';
        if (typeof window !== 'undefined') {
          localStorage.setItem('theme', next);
          document.documentElement.classList.toggle('dark', next === 'dark');
        }
        return next;
      });
    },
    set: (value: 'light' | 'dark') => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('theme', value);
        document.documentElement.classList.toggle('dark', value === 'dark');
      }
      set(value);
    },
    init: () => {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = stored || (prefersDark ? 'dark' : 'light');
        document.documentElement.classList.toggle('dark', theme === 'dark');
        set(theme as 'light' | 'dark');
      }
    }
  };
}

export const theme = createThemeStore();
