import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { App } from './App';
import { checkAuth } from './components/Account';

checkAuth();
createRoot(document.getElementById('root')!).render(<App />);
