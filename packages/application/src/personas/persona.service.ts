import {
  DomainError,
  assertCanCreatePersona,
  isReadable,
  generateNumberCode,
  normalizeDisplayName,
  normalizeLabel,
  planSummary,
  type Actor,
  type Clock,
  type CryptoService,
  type EventPublisher,
  type Persona,
  type PersonaRepository,
  type PersonaSettingsPatch,
  type PlanSummary,
  type QrCodeRenderer,
  type StorageProvider,
} from '@hellogram/domain';
import { ErrorCode, type LabelKind, type Retention } from '@hellogram/shared';

export interface NewPersonaInput {
  displayName: string;
  labelKind: LabelKind;
  labelText?: string | null | undefined;
  allowCalls: boolean;
}

export interface CheckoutInfo {
  draftId: string;
  provider: 'razorpay' | 'dev';
  /** Provider-specific data the client needs to open the payment sheet. */
  payload: Record<string, unknown>;
}

/** Implemented by the billing module (Phase 9): starts payment for a paid slot. */
export interface PaidNumberCheckout {
  start(actor: Actor, input: NewPersonaInput & { labelText: string | null }): Promise<CheckoutInfo>;
}

export type CreatePersonaResult = { kind: 'created'; persona: Persona } | { kind: 'payment_required'; checkout: CheckoutInfo };

export interface PersonaDeps {
  personas: PersonaRepository;
  crypto: CryptoService;
  clock: Clock;
  events: EventPublisher;
  storage: StorageProvider;
  qr: QrCodeRenderer;
  publicBaseUrl: string;
  codeDigits: number;
  checkout?: PaidNumberCheckout;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 8;

const AVATAR_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': {
    ext: 'webp',
    magic: (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
  },
};
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Use cases for a user's own Hellogram numbers (rules 5–8). */
export class PersonaService {
  constructor(private readonly deps: PersonaDeps) {}

  /** Billing is wired after construction (it depends on this service too). */
  setCheckout(checkout: PaidNumberCheckout) {
    this.deps.checkout = checkout;
  }

  async list(actor: Actor): Promise<{ items: Persona[]; plan: PlanSummary }> {
    const items = await this.deps.personas.listByAccount(actor.accountId);
    return { items, plan: planSummary(items) };
  }

  async get(actor: Actor, id: string): Promise<Persona> {
    const persona = await this.deps.personas.findById(id);
    if (!persona || persona.accountId !== actor.accountId || persona.status === 'retired') {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Number not found');
    }
    return persona;
  }

  /** Changing, sharing or deleting a PIN-locked number needs this device's unlock (rule 25). */
  private async unlocked(actor: Actor, id: string): Promise<Persona> {
    const persona = await this.get(actor, id);
    if (!isReadable(persona, actor.unlockedPersonaIds)) {
      throw new DomainError(ErrorCode.PERSONA_LOCKED, 'Unlock this number first', { personaId: persona.id });
    }
    return persona;
  }

  async create(actor: Actor, input: NewPersonaInput): Promise<CreatePersonaResult> {
    const displayName = normalizeDisplayName(input.displayName);
    const label = normalizeLabel(input.labelKind, input.labelText);
    const existing = await this.deps.personas.listByAccount(actor.accountId);
    const since = new Date(this.deps.clock.now().getTime() - WEEK_MS);
    const { requiresPayment } = assertCanCreatePersona(
      existing,
      await this.deps.personas.countCreatedSince(actor.accountId, since),
    );

    if (requiresPayment) {
      if (!this.deps.checkout) {
        throw new DomainError(ErrorCode.PAYMENT_REQUIRED, 'Extra numbers need a ₹49/month plan');
      }
      const checkout = await this.deps.checkout.start(actor, { ...input, displayName, ...label });
      // An existing mandate can create the number straight away.
      const createdId = checkout.payload['personaId'];
      if (typeof createdId === 'string') {
        const persona = await this.deps.personas.findById(createdId);
        if (persona) return { kind: 'created', persona };
      }
      return { kind: 'payment_required', checkout };
    }

    const persona = await this.createWithUniqueCode({
      accountId: actor.accountId,
      displayName,
      ...label,
      allowCalls: input.allowCalls,
      isPaid: false,
    });
    await this.publishUpdated(persona);
    return { kind: 'created', persona };
  }

  /** Also used by billing once a paid slot is confirmed. */
  async createWithUniqueCode(input: {
    accountId: string;
    displayName: string;
    labelKind: LabelKind;
    labelText: string | null;
    allowCalls: boolean;
    isPaid: boolean;
  }): Promise<Persona> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateNumberCode((max) => this.deps.crypto.randomInt(max), this.deps.codeDigits);
      if (await this.deps.personas.codeTaken(code)) continue;
      const persona = await this.deps.personas.create({ ...input, code });
      if (persona) return persona;
    }
    throw new DomainError(ErrorCode.SERVICE_UNAVAILABLE, 'Could not allocate a number. Please try again.');
  }

  async update(
    actor: Actor,
    id: string,
    input: {
      displayName?: string | undefined;
      labelKind?: LabelKind | undefined;
      labelText?: string | null | undefined;
      acceptRequests?: boolean | undefined;
      allowCalls?: boolean | undefined;
      readReceipts?: boolean | undefined;
      dndUntil?: Date | null | undefined;
      defaultRetention?: Retention | undefined;
    },
  ): Promise<Persona> {
    const current = await this.unlocked(actor, id);
    const patch: PersonaSettingsPatch = {};
    if (input.displayName !== undefined) patch.displayName = normalizeDisplayName(input.displayName);
    if (input.labelKind !== undefined) Object.assign(patch, normalizeLabel(input.labelKind, input.labelText));
    for (const key of ['acceptRequests', 'allowCalls', 'readReceipts', 'defaultRetention'] as const) {
      if (input[key] !== undefined) Object.assign(patch, { [key]: input[key] });
    }
    if (input.dndUntil !== undefined) patch.dndUntil = input.dndUntil;
    const updated = await this.deps.personas.update(current.id, patch);
    await this.publishUpdated(updated);
    return updated;
  }

  async pause(actor: Actor, id: string): Promise<Persona> {
    const persona = await this.unlocked(actor, id);
    if (persona.status === 'paused') return persona;
    const updated = await this.deps.personas.setStatus(persona.id, 'paused', 'user');
    await this.publishUpdated(updated);
    return updated;
  }

  async resume(actor: Actor, id: string): Promise<Persona> {
    const persona = await this.unlocked(actor, id);
    if (persona.status === 'active') return persona;
    if (persona.pauseReason !== 'user') {
      throw new DomainError(ErrorCode.NUMBER_PAUSED, 'Renew your plan to resume this number');
    }
    const updated = await this.deps.personas.setStatus(persona.id, 'active', null);
    await this.publishUpdated(updated);
    return updated;
  }

  /** Rule 7: irreversible. The UI requires typing DELETE. */
  async retire(actor: Actor, id: string, confirm: string): Promise<void> {
    if (confirm !== 'DELETE') {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Type DELETE to confirm');
    }
    const persona = await this.unlocked(actor, id);
    await this.deps.personas.retire(persona.id, this.deps.clock.now());
    if (persona.avatarKey) await this.deps.storage.delete(persona.avatarKey).catch(() => undefined);
    await this.deps.events.publish({
      type: 'persona.retired',
      payload: { accountId: actor.accountId, personaId: persona.id, wasPaid: persona.isPaid },
      occurredAt: this.deps.clock.now(),
    });
  }

  async share(actor: Actor, id: string): Promise<{ code: string; url: string; qrSvg: string }> {
    const persona = await this.unlocked(actor, id);
    const url = `${this.deps.publicBaseUrl.replace(/\/$/, '')}/${persona.code}`;
    return { code: persona.code, url, qrSvg: await this.deps.qr.svg(url) };
  }

  /** Avatars get a random key with no account path, so URLs can't link numbers (rule 20). */
  async setAvatar(actor: Actor, id: string, body: Uint8Array, contentType: string): Promise<Persona> {
    const persona = await this.unlocked(actor, id);
    const type = AVATAR_TYPES[contentType];
    if (!type || !type.magic(body)) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Upload a JPEG, PNG or WebP image');
    }
    if (body.byteLength > AVATAR_MAX_BYTES) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Images must be 2 MB or smaller');
    }
    const key = `avatars/${this.deps.crypto.randomToken(18)}.${type.ext}`;
    await this.deps.storage.put(key, body, contentType);
    const updated = await this.deps.personas.update(persona.id, { avatarKey: key });
    if (persona.avatarKey) await this.deps.storage.delete(persona.avatarKey).catch(() => undefined);
    await this.publishUpdated(updated);
    return updated;
  }

  async removeAvatar(actor: Actor, id: string): Promise<Persona> {
    const persona = await this.unlocked(actor, id);
    const updated = await this.deps.personas.update(persona.id, { avatarKey: null });
    if (persona.avatarKey) await this.deps.storage.delete(persona.avatarKey).catch(() => undefined);
    await this.publishUpdated(updated);
    return updated;
  }

  avatarUrl(key: string | null): string | null {
    return key ? this.deps.storage.publicUrl(key) : null;
  }

  private publishUpdated(persona: Persona) {
    return this.deps.events.publish({
      type: 'persona.updated',
      payload: { accountId: persona.accountId, personaId: persona.id },
      occurredAt: this.deps.clock.now(),
    });
  }
}
