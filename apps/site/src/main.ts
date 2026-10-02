import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';

// Mobile menu.
const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const menu = document.querySelector<HTMLElement>('[data-menu]');
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!open));
  menu?.classList.toggle('hidden', open);
});
menu?.querySelectorAll('a').forEach((a) =>
  a.addEventListener('click', () => {
    toggle?.setAttribute('aria-expanded', 'false');
    menu.classList.add('hidden');
  }),
);

const year = document.querySelector('[data-year]');
if (year) year.textContent = String(new Date().getFullYear());
