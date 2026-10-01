import { Card, Switch } from '@hellogram/ui';
import { useEffect, useState } from 'react';
import { api } from '../../../core/http/client.js';
import { t } from '../../../i18n/t.js';

const urlBase64ToUint8Array = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Web Push opt-in. Works with the tab closed; on iOS only once installed to the home screen. */
export function NotificationsSection() {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported()) return;
    void navigator.serviceWorker.ready.then(async (reg) => setEnabled(Boolean(await reg.pushManager.getSubscription())));
  }, []);

  const toggle = async (on: boolean) => {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!on) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api('/v1/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } });
          await sub.unsubscribe();
        }
        setEnabled(false);
        return;
      }
      if ((await Notification.requestPermission()) !== 'granted') {
        setError(t('settings.pushDenied'));
        return;
      }
      const { publicKey } = await api<{ publicKey: string | null }>('/v1/push/key');
      if (!publicKey) throw new Error(t('settings.pushUnavailable'));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api('/v1/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } });
      setEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enable notifications');
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h2 className="text-sm font-semibold">{t('settings.push')}</h2>
          <p className="text-xs text-muted">{supported() ? t('settings.pushHint') : t('settings.pushUnsupported')}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => void toggle(v)} label={t('settings.push')} disabled={!supported()} />
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}
