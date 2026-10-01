import type { QrCodeRenderer } from '@hellogram/domain';
import QRCode from 'qrcode';

export class QrCodeSvgRenderer implements QrCodeRenderer {
  svg(text: string): Promise<string> {
    return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0B0B14', light: '#FFFFFF' } });
  }
}

/** A QR code drawn with text characters, for command-line tools (e.g. enrolling an authenticator app). */
export const terminalQr = (text: string): Promise<string> => QRCode.toString(text, { type: 'terminal', small: true, errorCorrectionLevel: 'L' });
