import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { DataProvider } from './app/DataProvider';
import { PwaUpdatePrompt } from './app/PwaUpdatePrompt';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider><App /><PwaUpdatePrompt /></DataProvider>
  </StrictMode>,
);
