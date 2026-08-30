import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PriceCheckOverlay from './components/PriceCheckOverlay';
import './styles.css';

// The price-check window loads this same bundle at `?overlay=1` rather than a
// separate entry point, so it shares the origin -- and with it, localStorage
// and the cached item list -- with the main window.
const isOverlay = new URLSearchParams(window.location.search).get('overlay') === '1';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isOverlay ? <PriceCheckOverlay /> : <App />}
  </React.StrictMode>,
);
