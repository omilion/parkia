import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { DataProvider } from './app/DataProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider><App /></DataProvider>
  </StrictMode>,
);
