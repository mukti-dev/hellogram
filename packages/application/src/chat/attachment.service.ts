import {
  DomainError,
  hasContent,
  inspectFile,
  normalizeWaveform,
  type AttachmentPurpose,
  type InspectedFile,
  isClosed,
  mediaAllowed,
  type Actor,
  type Attachment,
  type AttachmentRepository,
  type BlobStore,
  type ConversationRepository,
  type CryptoService,
  type FileCipher,
  type RateLimiter,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import { mediaOff, type ChatService } from './chat.service.js';

export interface AttachmentDeps {
  attachments: AttachmentRepository;
  blobs: BlobStore;
  cipher: FileCipher;
  conversations: ConversationRepository;
  chat: ChatService;
  crypto: CryptoService;
  limiter: RateLimiter;
}

const UPLOADS_PER_10_MIN = 20;
const UPLOADS_PER_DAY = 200;
const DOWNLOADS_PER_5_MIN = 300;

const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'File not found');

/** Destroys the stored file first, then its record — a failed storage delete is retried by the worker. */
export async function discardAttachment(
  deps: Pick<AttachmentDeps, 'attachments' | 'blobs'>,
  attachment: Pick<Attachment, 'id' | 'storageKey'>,
): Promise<void> {
  await deps.blobs.delete(attachment.storageKey);
  await deps.attachments.delete(attachment.id);
}

/**
 * Files and images in chats.
 * Stored encrypted under a random name; read back only through `download`, which re-checks
 * on every request that the person asking may still see the message the file belongs to.
 */
export class AttachmentService {
  constructor(private readonly deps: AttachmentDeps) {}

  /** Step 1 of sending a file: store it. It becomes visible to the other side only once sent as a message. */
  async upload(
    actor: Actor,
    conversationId: string,
    input: { bytes: Uint8Array; fileName: string; purpose?: AttachmentPurpose | undefined; waveform?: unknown },
  ): Promise<Attachment> {
    const view = await this.deps.chat.view(actor, conversationId);
    if (isClosed(view)) throw new DomainError(ErrorCode.CONVERSATION_CLOSED, 'This chat is closed');
    if (!mediaAllowed(view)) throw mediaOff();
    const file = inspectFile(input.bytes, input.fileName, input.purpose);
    return this.store(view.myPersona.id, conversationId, file, file.kind === 'voice' ? normalizeWaveform(input.waveform) : null);
  }

  /** Checks the per-number limits, then stores the (already inspected) file encrypted. */
  async store(persona: string, conversationId: string, file: InspectedFile, waveform: number[] | null = null): Promise<Attachment> {
    const allowed =
      (await this.deps.limiter.hit(`upload:${persona}`, UPLOADS_PER_10_MIN, 600)) &&
      (await this.deps.limiter.hit(`upload-day:${persona}`, UPLOADS_PER_DAY, 86_400));
    if (!allowed) throw new DomainError(ErrorCode.RATE_LIMITED, 'You’re sending files too fast. Try again in a few minutes.');

    // A random name: nothing in storage says whose file it is or which chat it belongs to.
    const storageKey = `att/${this.deps.crypto.randomToken(24)}`;
    const attachment = await this.deps.attachments.create({
      conversationId,
      uploaderPersonaId: persona,
      kind: file.kind,
      mimeType: file.mimeType,
      fileName: file.fileName,
      sizeBytes: file.bytes.byteLength,
      width: file.width,
      height: file.height,
      durationMs: file.durationMs,
      waveform,
      storageKey,
    });
    try {
      await this.deps.blobs.put(storageKey, this.deps.cipher.seal(file.bytes, storageKey));
    } catch (error) {
      await this.deps.attachments.delete(attachment.id).catch(() => undefined);
      throw error;
    }
    return attachment;
  }

  /**
   * The decrypted file, for a member of the chat who can still see its message.
   * Every "no" looks the same (not found), so the endpoint can't be used to probe for files, blocks or deletions.
   */
  async download(actor: Actor, attachmentId: string): Promise<{ attachment: Attachment; bytes: Uint8Array }> {
    const attachment = await this.deps.attachments.findById(attachmentId);
    if (!attachment?.messageId) throw notFound();

    // Membership, hidden chats, the number PIN and the chat lock.
    const view = await this.deps.chat.view(actor, attachment.conversationId).catch((error: unknown) => {
      if (error instanceof DomainError && (error.code === ErrorCode.PERSONA_LOCKED || error.code === ErrorCode.CHAT_LOCKED)) throw error;
      throw notFound();
    });
    // Blocked (suppressed), deleted for me, cleared, deleted for everyone, or expired.
    const message = await this.deps.conversations.findVisibleMessage(attachment.messageId, view.myPersona.id);
    if (!message || !hasContent(message) || message.attachment?.id !== attachment.id) throw notFound();

    if (!(await this.deps.limiter.hit(`download:${actor.accountId}`, DOWNLOADS_PER_5_MIN, 300))) {
      throw new DomainError(ErrorCode.RATE_LIMITED, 'Too many downloads. Try again in a few minutes.');
    }

    const sealed = await this.deps.blobs.get(attachment.storageKey);
    if (!sealed) throw notFound();
    return { attachment, bytes: this.deps.cipher.open(sealed, attachment.storageKey) };
  }
}
