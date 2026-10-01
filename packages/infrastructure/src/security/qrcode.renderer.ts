import type { QrCodeRenderer } from '@hellogram/domain';
import QRCode from 'qrcode';

export class QrCodeSvgRenderer implements QrCodeRenderer {
  svg(text: string): Promise<string> {
    return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0B0B14', light: '#FFFFFF' } });
  }
}
