import { ToastProvider } from './core/Toast';
import { LineupPlanner } from './screens/lineup/LineupPlanner';

export function App() {
  return (
    <ToastProvider>
      <LineupPlanner />
    </ToastProvider>
  );
}
