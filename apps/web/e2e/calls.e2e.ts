import { expect, test } from '@playwright/test';
import { pair } from './helpers.js';

/** Needs coturn: `docker compose -f infra/docker-compose.yml --profile calls up -d coturn`. */
test('two browsers call each other through the TURN relay', async ({ browser }) => {
  const { owner, visitor, close } = await pair(browser);
  // Count Web Audio oscillators so we can tell the ringtone / ringback actually play.
  const countTones = () => {
    const w = window as unknown as { __hgTones: number };
    w.__hgTones = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.__hgTones += 1;
      return create.call(this);
    };
  };
  const tones = (page: typeof owner) => page.evaluate(() => (window as unknown as { __hgTones: number }).__hgTones);
  await owner.addInitScript(countTones);
  await visitor.addInitScript(countTones);
  await owner.reload();
  await visitor.goto('/inbox');
  await visitor.getByRole('link', { name: /Rahul Deals/ }).click();

  await visitor.getByRole('button', { name: 'Voice call' }).first().click();
  await expect(visitor.getByText('Calling…')).toBeVisible();

  // Owner gets the incoming call screen.
  await expect(owner.getByText('Incoming voice call')).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Amit Kumar' })).toBeVisible();
  await expect(owner.getByText('Your number and location stay hidden')).toBeVisible();
  await expect.poll(() => tones(owner)).toBeGreaterThan(0); // ringtone
  expect(await tones(visitor)).toBeGreaterThan(0); // ringback
  await owner.getByRole('button', { name: 'Accept' }).click();

  // Both sides reach an active call (timer shows mm:ss) over relay-only ICE.
  await expect(visitor.getByText(/^\d\d:\d\d$/)).toBeVisible({ timeout: 20_000 });
  await expect(owner.getByText(/^\d\d:\d\d$/)).toBeVisible({ timeout: 20_000 });

  // Ringing stops once the call is up (a ring repeats every ≤ 3 s).
  const [ownerTones, visitorTones] = [await tones(owner), await tones(visitor)];
  await owner.waitForTimeout(3500);
  expect(await tones(owner)).toBe(ownerTones);
  expect(await tones(visitor)).toBe(visitorTones);

  // Verify the selected candidate pair is a relay on both sides.
  for (const page of [owner, visitor]) {
    await expect.poll(async () => page.evaluate(() => ((window as unknown as { __hgPeers?: RTCPeerConnection[] }).__hgPeers ?? []).some((pc) => pc.connectionState === 'connected'))).toBe(true);
    const relayed = await page.evaluate(async () => {
      const pcs = ((window as unknown as { __hgPeers?: RTCPeerConnection[] }).__hgPeers ?? []).filter(
        (pc) => pc.connectionState === 'connected',
      );
      for (const pc of pcs) {
        const stats = await pc.getStats();
        for (const s of stats.values()) {
          // The pair actually carrying media (nominated + succeeded).
          if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) {
            return stats.get(s.localCandidateId)?.candidateType ?? null;
          }
        }
      }
      return null;
    });
    expect(relayed).toBe('relay');
  }

  // Audio panel: noise cancellation (RNNoise) is on and really running, and switching it keeps audio flowing.
  // (Packets, not bytes: RNNoise removes the fake microphone's beeps, and silence packs very small.)
  const packetsSent = () =>
    visitor.evaluate(async () => {
      const pc = ((window as unknown as { __hgPeers?: RTCPeerConnection[] }).__hgPeers ?? []).find((p) => p.connectionState === 'connected');
      let sent = 0;
      for (const s of (await pc?.getStats())?.values() ?? []) if (s.type === 'outbound-rtp') sent += s.packetsSent as number;
      return sent;
    });
  await visitor.getByRole('button', { name: 'Audio' }).click();
  const panel = visitor.getByRole('dialog', { name: 'Audio' });
  const noiseSwitch = panel.getByRole('switch', { name: 'Noise cancellation' });
  await expect(noiseSwitch).toBeChecked();
  await expect(panel.getByText(/Filters out traffic/)).toBeVisible();
  await expect(panel.getByRole('radio', { name: 'System default' }).first()).toBeChecked();
  await noiseSwitch.click();
  await expect(noiseSwitch).not.toBeChecked();
  await noiseSwitch.click();
  await expect(noiseSwitch).toBeChecked();
  await expect(panel.getByText(/Filters out traffic/)).toBeVisible();
  const before = await packetsSent();
  await expect.poll(packetsSent, { timeout: 5000 }).toBeGreaterThan(before + 50);
  await panel.getByRole('button', { name: 'Close audio settings' }).click();
  await expect(panel).toBeHidden();

  await visitor.getByRole('button', { name: 'End call' }).click();
  await expect(owner.getByText('Call ended')).toBeVisible();

  await owner.goto('/calls');
  await expect(owner.getByText('Answered')).toBeVisible();
  await close();
});

/**
 * One-way audio regression: when the answering side's microphone is slow to open (noise filter
 * loading, a permission prompt), the caller's offer must wait for it — both sides must hear audio.
 */
for (const slow of ['callee', 'caller'] as const) {
test(`audio flows both ways even when the ${slow}'s microphone is slow to open`, async ({ browser }) => {
  const { owner, visitor, close } = await pair(browser);
  await (slow === 'callee' ? owner : visitor).addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return original(constraints);
    };
  });
  await owner.reload();
  await visitor.goto('/inbox');
  await visitor.getByRole('link', { name: /Rahul Deals/ }).click();
  await visitor.getByRole('button', { name: 'Voice call' }).first().click();
  // Answer at once — before a slow caller's microphone is ready.
  await owner.getByRole('button', { name: 'Accept' }).click();
  await expect(visitor.getByText(/^\d\d:\d\d$/)).toBeVisible({ timeout: 20_000 });
  await expect(owner.getByText(/^\d\d:\d\d$/)).toBeVisible({ timeout: 20_000 });

  const packetsReceived = (page: typeof owner) =>
    page.evaluate(async () => {
      const pc = ((window as unknown as { __hgPeers?: RTCPeerConnection[] }).__hgPeers ?? []).find((p) => p.connectionState === 'connected');
      let received = 0;
      for (const s of (await pc?.getStats())?.values() ?? []) if (s.type === 'inbound-rtp') received += s.packetsReceived as number;
      return received;
    });
  await expect.poll(() => packetsReceived(visitor), { timeout: 8000, message: 'caller hears the callee' }).toBeGreaterThan(50);
  await expect.poll(() => packetsReceived(owner), { timeout: 8000, message: 'callee hears the caller' }).toBeGreaterThan(50);

  await visitor.getByRole('button', { name: 'End call' }).click();
  await close();
});
}
