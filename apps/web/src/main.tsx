import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import './features/auth/model/auth-store.js';
import './features/pin/model/unlock-tokens.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
