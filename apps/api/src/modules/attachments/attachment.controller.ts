import type { AttachmentService } from '@hellogram/application';
import { DomainError } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf } from '../../plugins/auth.js';
import { toAttachmentDto } from '../chat/chat.mapper.js';

type IdParams = { Params: { id: string } };

function fileNameOf(request: FastifyRequest): string {
  const raw = request.headers['x-file-name'];
  if (typeof raw !== 'string' || raw.length > 1000) return 'file';
  try {
    return decodeURIComponent(raw);
  } catch {
    return 'file';
  }
}

/** RFC 5987 file name for Content-Disposition (the name was already cleaned on upload). */
const disposition = (type: 'inline' | 'attachment', fileName: string) =>
  `${type}; filename="${fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

export class AttachmentController {
  constructor(private readonly attachments: AttachmentService) {}

  upload = async (request: FastifyRequest<IdParams>, reply: FastifyReply) => {
    if (!Buffer.isBuffer(request.body)) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Send the file as application/octet-stream');
    }
    const attachment = await this.attachments.upload(actorOf(request), request.params.id, {
      bytes: request.body,
      fileName: fileNameOf(request),
    });
    return reply.status(201).send(toAttachmentDto(attachment));
  };

  download = async (request: FastifyRequest<IdParams>, reply: FastifyReply) => {
    const { attachment, bytes } = await this.attachments.download(actorOf(request), request.params.id);
    const image = attachment.kind === 'image';
    return (
      reply
        // Only images are ever labelled as something a browser would render.
        .type(image ? attachment.mimeType : 'application/octet-stream')
        .header('Content-Disposition', disposition(image ? 'inline' : 'attachment', attachment.fileName))
        .header('Content-Length', bytes.byteLength)
        // Never written to a browser, proxy or CDN cache.
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        // Opened directly, the response can't run scripts or load anything.
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Cross-Origin-Resource-Policy', 'same-origin')
        .header('X-Robots-Tag', 'noindex')
        .send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    );
  };
}
