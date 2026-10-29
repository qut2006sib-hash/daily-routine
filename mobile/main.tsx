import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RoutineApp } from '@/components/routine/routine-app';
import '@/styles.css';
createRoot(document.getElementById('root')!).render(<StrictMode><RoutineApp /></StrictMode>);
