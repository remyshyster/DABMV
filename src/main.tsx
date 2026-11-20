import React from 'react';
import ReactDOM from 'react-dom/client';
import { MatchCoordinator } from './components/MatchCoordinator';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <MatchCoordinator />
  </React.StrictMode>
);
