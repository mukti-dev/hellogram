import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router';
import { RealtimeProvider } from '../core/realtime/RealtimeProvider.js';
import '../features/calls/model/realtime.js';
import '../features/chat/model/realtime.js';
import { unlockAudioOnFirstGesture } from '../core/sound/tones.js';
import { router } from './router.js';
import { startThemeSync } from './theme/theme-store.js';

export function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );

  useEffect(() => startThemeSync(), []);
  useEffect(() => unlockAudioOnFirstGesture(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>
        <RouterProvider router={router} />
      </RealtimeProvider>
    </QueryClientProvider>
  );
}
