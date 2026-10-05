import { Prisma } from '@hellogram/db';
import type {
  Conversation,
  ConversationMember,
  ConversationRepository,
  ConversationView,
  InboxFilter,
  InboxRow,
  InsertMessageResult,
  Message,
  NewMessage,
  Page,
  SystemPayload,
  VaultState,
} from '@hellogram/domain';
import type { Retention } from '@hellogram/shared';
import { decodeCursor, encodeCursor } from './cursor.js';
import { personaSelect, toPersona } from './mappers.js';
import type { Db } from './prisma-types.js';

const memberSelect = {
  personaId: true,
  nickname: true,
  clearedBefore: true,
  mutedUntil: true,
  lastReadMessageId: true,
  hiddenAt: true,
  counterpartMasked: true,
  vault: true,
  vaultSpaceId: true,
  persona: { select: personaSelect },
} as const;

const conversationSelect = {
  id: true,
  retention: true,
  retentionChangedById: true,
  retentionChangedAt: true,
  lastMessageAt: true,
  createdAt: true,
  closedAt: true,
  members: { select: memberSelect },
} as const;

const messageSelect = {
  id: true,
  conversationId: true,
  senderPersonaId: true,
  clientMessageId: true,
  type: true,
  body: true,
  systemPayload: true,
  suppressed: true,
  createdAt: true,
  deliveredAt: true,
  readAt: true,
  deletedForEveryoneAt: true,
  expiredAt: true,
  contentPurgedAt: true,
  attachment: { select: { id: true, kind: true, mimeType: true, fileName: true, sizeBytes: true, width: true, height: true } },
} as const;

type MessageRow = Omit<Message, 'systemPayload'> & { systemPayload: Prisma.JsonValue };
type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof conversationSelect }>;

const toMessage = (row: MessageRow): Message => ({
  ...row,
  systemPayload: (row.systemPayload as SystemPayload | null) ?? null,
});

function toView(row: ConversationRow, myPersonaId: string): ConversationView | null {
  const me = row.members.find((m) => m.personaId === myPersonaId);
  const other = row.members.find((m) => m.personaId !== myPersonaId);
  if (!me || !other) return null;
  const { members: _members, ...conversation } = row;
  const member = ({ persona: _p, ...m }: (typeof row.members)[number]): ConversationMember => m;
  return {
    conversation: conversation as Conversation,
    me: member(me),
    myPersona: toPersona(me.persona),
    other: member(other),
    otherPersona: toPersona(other.persona),
  };
}

/** Visibility of messages for one member (suppressed, cleared, hidden). */
const visibleTo = (personaId: string, clearedBefore: Date | null): Prisma.MessageWhereInput => ({
  OR: [{ suppressed: false }, { senderPersonaId: personaId }],
  ...(clearedBefore ? { createdAt: { gt: clearedBefore } } : {}),
  hiddenFor: { none: { personaId } },
});

export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly db: Db) {}

  async findView(conversationId: string, personaId: string): Promise<ConversationView | null> {
    const row = await this.db.conversation.findUnique({ where: { id: conversationId }, select: conversationSelect });
    return row ? toView(row, personaId) : null;
  }

  async findViewForAccount(conversationId: string, personaIds: string[]): Promise<ConversationView | null> {
    const row = await this.db.conversation.findUnique({ where: { id: conversationId }, select: conversationSelect });
    const mine = row?.members.find((m) => personaIds.includes(m.personaId));
    return row && mine ? toView(row, mine.personaId) : null;
  }

  async listInbox(filter: InboxFilter): Promise<Page<InboxRow>> {
    if (filter.personaIds.length === 0) return { items: [], nextCursor: null };
    const cursor = decodeCursor(filter.cursor ?? null);
    const q = filter.query?.trim() ? `%${filter.query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const folders = filter.folders ?? ['inbox'];
    const spaceIds = filter.spaceIds ?? [];

    const rows = await this.db.$queryRaw<{ conversationId: string; personaId: string; lastMessageId: string | null; sortAt: Date; unread: number }[]>`
      SELECT * FROM (
        SELECT cm."conversationId", cm."personaId", lm.id AS "lastMessageId",
               COALESCE(lm."createdAt", c."createdAt") AS "sortAt",
               (SELECT count(*)::int FROM messages u
                 WHERE u."conversationId" = cm."conversationId"
                   AND u."senderPersonaId" <> cm."personaId"
                   AND u.suppressed = false AND u.type = 'text' AND u."deletedForEveryoneAt" IS NULL
                   AND (cm."clearedBefore" IS NULL OR u."createdAt" > cm."clearedBefore")
                   AND (cm."lastReadMessageId" IS NULL
                        OR u."createdAt" > (SELECT r."createdAt" FROM messages r WHERE r.id = cm."lastReadMessageId"))
               ) AS unread
        FROM conversation_members cm
        JOIN conversations c ON c.id = cm."conversationId"
        JOIN conversation_members om ON om."conversationId" = cm."conversationId" AND om."personaId" <> cm."personaId"
        JOIN personas mp ON mp.id = cm."personaId"
        JOIN personas op ON op.id = om."personaId"
        LEFT JOIN LATERAL (
          SELECT m.id, m."createdAt" FROM messages m
          WHERE m."conversationId" = cm."conversationId"
            AND (m.suppressed = false OR m."senderPersonaId" = cm."personaId")
            AND (cm."clearedBefore" IS NULL OR m."createdAt" > cm."clearedBefore")
            AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h."messageId" = m.id AND h."personaId" = cm."personaId")
          ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1
        ) lm ON true
        WHERE cm."personaId" = ANY(${filter.personaIds}::uuid[])
          AND cm."hiddenAt" IS NULL
          AND ((cm.vault IS NULL AND 'inbox' = ANY(${folders}::text[]))
               OR (cm.vault::text = ANY(${folders}::text[])
                   AND (cm.vault <> 'hidden' OR cm."vaultSpaceId" = ANY(${spaceIds}::uuid[]))))
          AND (${filter.label ?? null}::text IS NULL OR lower(mp."labelName") = lower(${filter.label ?? null}::text))
          AND (${q}::text IS NULL OR cm.nickname ILIKE ${q}::text
               OR (NOT cm."counterpartMasked" AND op."displayName" ILIKE ${q}::text))
      ) x
      WHERE (${filter.unreadOnly ?? false}::boolean = false OR x.unread > 0)
        AND (${cursor?.createdAt ?? null}::timestamptz IS NULL
             OR (x."sortAt", x."conversationId") < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      ORDER BY x."sortAt" DESC, x."conversationId" DESC
      LIMIT ${filter.limit + 1}
    `;

    const pageRows = rows.slice(0, filter.limit);
    const [conversations, messages] = await Promise.all([
      this.db.conversation.findMany({
        where: { id: { in: pageRows.map((r) => r.conversationId) } },
        select: conversationSelect,
      }),
      this.db.message.findMany({
        where: { id: { in: pageRows.flatMap((r) => (r.lastMessageId ? [r.lastMessageId] : [])) } },
        select: messageSelect,
      }),
    ]);
    const byId = new Map(conversations.map((c) => [c.id, c]));
    const messageById = new Map(messages.map((m) => [m.id, toMessage(m)]));

    const items = pageRows.flatMap((r) => {
      const conversation = byId.get(r.conversationId);
      const view = conversation && toView(conversation, r.personaId);
      if (!view) return [];
      return [{ ...view, lastMessage: r.lastMessageId ? (messageById.get(r.lastMessageId) ?? null) : null, unread: r.unread }];
    });
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor: rows.length > filter.limit && last ? encodeCursor(new Date(last.sortAt), last.conversationId) : null,
    };
  }

  async listMessages(conversationId: string, personaId: string, cursor: string | null, limit: number): Promise<Page<Message>> {
    const member = await this.db.conversationMember.findUnique({
      where: { conversationId_personaId: { conversationId, personaId } },
      select: { clearedBefore: true },
    });
    if (!member) return { items: [], nextCursor: null };
    const c = decodeCursor(cursor);
    const rows = await this.db.message.findMany({
      where: {
        conversationId,
        AND: [
          visibleTo(personaId, member.clearedBefore),
          c ? { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] } : {},
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: messageSelect,
    });
    const items = rows.slice(0, limit).map(toMessage);
    const lastItem = items.at(-1);
    return { items, nextCursor: rows.length > limit && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null };
  }

  async insertMessage(message: NewMessage): Promise<InsertMessageResult> {
    const data: Prisma.MessageUncheckedCreateInput = {
      conversationId: message.conversationId,
      senderPersonaId: message.senderPersonaId,
      clientMessageId: message.clientMessageId,
      type: message.type,
      body: message.body,
      systemPayload: message.systemPayload ?? Prisma.JsonNull,
      suppressed: message.suppressed,
    };
    if (message.attachmentId) {
      // One statement: the message only exists if the upload is the sender's, from this chat, and unsent.
      data.attachment = {
        connect: {
          id: message.attachmentId,
          AND: [{ messageId: null }],
          uploaderPersonaId: message.senderPersonaId,
          conversationId: message.conversationId,
        },
      };
    }
    try {
      const row = await this.db.message.create({
        data,
        select: messageSelect,
      });
      if (!message.suppressed) {
        await this.db.conversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: row.createdAt } });
      }
      return { message: toMessage(row), created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.db.message.findUnique({
          where: {
            senderPersonaId_clientMessageId: {
              senderPersonaId: message.senderPersonaId,
              clientMessageId: message.clientMessageId,
            },
          },
          select: messageSelect,
        });
        if (existing) return { message: toMessage(existing), created: false };
      }
      if (message.attachmentId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return { attachmentRejected: true };
      }
      throw error;
    }
  }

  async findMessage(id: string): Promise<Message | null> {
    const row = await this.db.message.findUnique({ where: { id }, select: messageSelect });
    return row && toMessage(row);
  }

  async findVisibleMessage(id: string, personaId: string): Promise<Message | null> {
    const message = await this.db.message.findUnique({ where: { id }, select: { conversationId: true } });
    if (!message) return null;
    const member = await this.db.conversationMember.findUnique({
      where: { conversationId_personaId: { conversationId: message.conversationId, personaId } },
      select: { clearedBefore: true },
    });
    if (!member) return null;
    const row = await this.db.message.findFirst({
      where: { id, AND: [visibleTo(personaId, member.clearedBefore)] },
      select: messageSelect,
    });
    return row && toMessage(row);
  }

  async markDelivered(readerPersonaId: string, messageIds: string[], at: Date) {
    if (messageIds.length === 0) return [];
    const rows = await this.db.message.findMany({
      where: {
        id: { in: messageIds },
        deliveredAt: null,
        suppressed: false,
        senderPersonaId: { not: readerPersonaId },
        conversation: { members: { some: { personaId: readerPersonaId } } },
      },
      select: { id: true, conversationId: true, senderPersonaId: true },
    });
    if (rows.length === 0) return [];
    await this.db.message.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deliveredAt: at } });
    const groups = new Map<string, { conversationId: string; senderPersonaId: string; messageIds: string[] }>();
    for (const r of rows) {
      const key = `${r.conversationId}:${r.senderPersonaId}`;
      const group = groups.get(key) ?? { conversationId: r.conversationId, senderPersonaId: r.senderPersonaId, messageIds: [] };
      group.messageIds.push(r.id);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  async markRead(conversationId: string, readerPersonaId: string, upToMessageId: string, stampReadAt: boolean, at: Date) {
    const upTo = await this.db.message.findFirst({
      where: { id: upToMessageId, conversationId },
      select: { id: true, createdAt: true },
    });
    const member = await this.db.conversationMember.findUnique({
      where: { conversationId_personaId: { conversationId, personaId: readerPersonaId } },
      select: { lastReadMessageId: true },
    });
    if (!upTo || !member) return { changed: false };
    if (member.lastReadMessageId) {
      const current = await this.db.message.findUnique({ where: { id: member.lastReadMessageId }, select: { createdAt: true } });
      if (current && current.createdAt >= upTo.createdAt) return { changed: false };
    }
    await this.db.conversationMember.update({
      where: { conversationId_personaId: { conversationId, personaId: readerPersonaId } },
      data: { lastReadMessageId: upTo.id },
    });
    const fromOthers = {
      conversationId,
      senderPersonaId: { not: readerPersonaId },
      suppressed: false,
      createdAt: { lte: upTo.createdAt },
    };
    await this.db.message.updateMany({ where: { ...fromOthers, deliveredAt: null }, data: { deliveredAt: at } });
    if (stampReadAt) {
      await this.db.message.updateMany({ where: { ...fromOthers, readAt: null }, data: { readAt: at } });
    }
    return { changed: true };
  }

  async hideMessage(messageId: string, personaId: string): Promise<void> {
    await this.db.messageHide.upsert({
      where: { messageId_personaId: { messageId, personaId } },
      create: { messageId, personaId },
      update: {},
    });
  }

  async deleteForEveryone(messageId: string, at: Date): Promise<void> {
    // Soft delete: the text stays (admins can see it in reports) until eraseDeletedContent.
    await this.db.message.update({ where: { id: messageId }, data: { deletedForEveryoneAt: at } });
  }

  async updateMember(
    conversationId: string,
    personaId: string,
    patch: { nickname?: string | null; mutedUntil?: Date | null; clearedBefore?: Date },
  ): Promise<void> {
    await this.db.conversationMember.update({
      where: { conversationId_personaId: { conversationId, personaId } },
      data: patch,
    });
  }

  async setRetention(conversationId: string, retention: Retention, byPersonaId: string, at: Date): Promise<void> {
    await this.db.conversation.update({
      where: { id: conversationId },
      data: { retention, retentionChangedById: byPersonaId, retentionChangedAt: at },
    });
  }

  async applyBlock(conversationId: string, blockerPersonaId: string, blockedPersonaId: string, at: Date): Promise<void> {
    await this.db.conversationMember.update({
      where: { conversationId_personaId: { conversationId, personaId: blockerPersonaId } },
      data: { hiddenAt: at },
    });
    await this.db.conversationMember.update({
      where: { conversationId_personaId: { conversationId, personaId: blockedPersonaId } },
      data: { counterpartMasked: true },
    });
  }

  async removeBlock(conversationId: string): Promise<void> {
    await this.db.conversationMember.updateMany({
      where: { conversationId },
      data: { hiddenAt: null, counterpartMasked: false },
    });
  }

  async countUnreadConversations(personaIds: string[], folders: (VaultState | 'inbox')[]): Promise<number> {
    const page = await this.listInbox({ personaIds, folders, unreadOnly: true, limit: 500 });
    return page.items.length;
  }
}
